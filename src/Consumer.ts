import {
  Consumer as KafkaConsumer,
  EachMessagePayload,
  IHeaders,
  Kafka,
} from "kafkajs";
import { BaseConsumerMeta } from "./types/ConsumerMeta";
import { Message } from "./types/Message";
import {
  ConsumerConfigs,
  ConsumerOffset,
  TopicConfig,
} from "./types/ConsumerGroup";
import { Producer } from "./Producer";
import { LoggerProxy } from "./LoggerProxy";

export class Consumer<TMeta = {}> {
  private logger: LoggerProxy;
  private consumer?: KafkaConsumer;
  private metaData: BaseConsumerMeta = {};
  constructor(
    private readonly GROUP_ID: string,
    private readonly config: ConsumerConfigs<TMeta>,
    private readonly producer: Producer,
    kafkaClient: Kafka,
  ) {
    this.logger = new LoggerProxy("Consumer");
    this.consumer = kafkaClient.consumer({
      groupId: GROUP_ID,
      readUncommitted: false,
      sessionTimeout: config.sessionTimeout || 30000,
      heartbeatInterval: config.heartbeatInterval || 400,
      rebalanceTimeout: config.rebalanceTimeout || 60000,
    });

    this.consumer.on(this.consumer.events.GROUP_JOIN, (event) => {
      this.metaData = {
        ...this.metaData,
        consumerId: event.payload.memberId,
        isLeader: event.payload.isLeader,
      };
    });

    this.consumer.on(this.consumer.events.REBALANCING, () => {
      this.metaData.isLeader = false;
      this.producer.reset();
    });
  }

  public async connect() {
    if (!this.consumer) throw new Error("Consumer is not initialized.");
    await this.consumer.connect();
  }

  public async disconnect() {
    if (!this.consumer) throw new Error("Consumer is not initialized.");
    await this.consumer.stop();
    await this.consumer.disconnect();
  }

  async subscribe(topics: string[]) {
    if (!this.consumer)
      throw new Error("Consumer is not initialized/connected.");
    await this.consumer.subscribe({ topics: topics, fromBeginning: false });
  }

  async run(topicConfig: (topic: string) => TopicConfig<TMeta> | undefined) {
    if (!this.consumer)
      throw new Error("Consumer is not initialized/connected.");

    await this.consumer.run({
      autoCommit: false,
      partitionsConsumedConcurrently:
        this.config.partitionsConsumedConcurrently || 1,
      eachMessage: async (payload: EachMessagePayload) => {
        const receivedAt = Date.now().toString();
        const { topic, partition, message } = payload;

        const topicDetails = topicConfig(topic);
        if (!topicDetails || !topicDetails.config.handler) return;

        const nextOffset = (BigInt(message.offset) + 1n).toString();
        const offsetMetadata: ConsumerOffset = {
          groupId: this.GROUP_ID,
          topic,
          partition,
          offset: nextOffset,
        };

        const userMeta =
          (this.config.meta && (await this.config.meta())) ?? ({} as any);
        const metadata = {
          ...this.metaData,
          ...userMeta,
        };

        const executeLogic = async (
          sendFn?: (t: string, m: Message[]) => Promise<void>,
        ) => {
          const handler = topicDetails.config.handler;
          if (!handler) return;
          await handler({
            ...payload,
            ctx: {
              receivedAt,
              metadata,
              send:
                sendFn ??
                (async (t, m) => {
                  await this.producer.send(t, m);
                }),
            },
          });
        };

        try {
          if (topicDetails.config.useTransaction) {
            await this.producer.runInTransaction(async (send) => {
              await executeLogic(send);
            }, offsetMetadata);
          } else {
            await executeLogic();
            await this.consumer!.commitOffsets([offsetMetadata]);
          }
        } catch (error) {
          const logPrefix = this.logger.format({
            topic,
          });
          this.logger.error(
            `${logPrefix} Processing failed. Attempting recovery.`,
            error,
          );
          await this.handleFailedMessage(
            payload,
            error,
            offsetMetadata,
            topicDetails,
          );
        }
      },
    });
  }

  private async handleFailedMessage(
    payload: EachMessagePayload,
    error: any,
    offsetMetadata: ConsumerOffset,
    topicConfig: TopicConfig<TMeta>,
  ) {
    const logPrefix = this.logger.format({
      topic: topicConfig.config.topic,
    });
    if (!topicConfig.config.handler) {
      this.logger.error(
        `${logPrefix} No handler for failure recovery on topic.`,
      );
      return;
    }

    const { partition, message } = payload;
    const { type, config } = topicConfig;
    const retries = config.retries;

    const retryHeader = message.headers?.["retry-count"];
    const currentRetryCount =
      type === "retry" && retryHeader ? parseInt(retryHeader.toString()) : 0;
    const isRetryAvailable = !!retries && currentRetryCount < retries.count;

    const targetTopic = isRetryAvailable
      ? retries.retrialTopic
      : this.config.dlqTopic;

    const headers = this.prepareFailureHeaders(message.headers, error, {
      isRetryAvailable,
      currentRetryCount,
      config,
      partition,
      type,
    });

    const messageToSend = {
      key: message.key?.toString() || "unknown-key",
      value: message.value?.toString() || "",
      headers,
    };

    try {
      await this.producer.send(targetTopic, [messageToSend]);
      await this.consumer!.commitOffsets([offsetMetadata]);
    } catch (error) {
      this.logger.error(
        `${logPrefix} Recovery failed. Message could not be moved to ${targetTopic}`,
        error,
      );
    }
  }

  private prepareFailureHeaders(
    originalHeaders: IHeaders | undefined,
    error: any,
    ctx: any,
  ): Record<string, Buffer> {
    const { isRetryAvailable, currentRetryCount, config, partition, type } =
      ctx;

    const baseHeaders = { ...originalHeaders };
    if (!isRetryAvailable) {
      delete baseHeaders["retry-count"];
      delete baseHeaders["last-error"];
    }

    return {
      ...baseHeaders,
      ...(isRetryAvailable
        ? {
            "retry-count": Buffer.from((currentRetryCount + 1).toString()),
            "last-error": Buffer.from(error.message || "Processing error"),
          }
        : {
            "original-topic": Buffer.from(config.topic),
            "failed-at": Buffer.from(new Date().toISOString()),
            "error-reason": Buffer.from(error.message || "Unknown Error"),
            ...(type === "retry" && config.retries?.retrialTopic
              ? {
                  "retry-topic": Buffer.from(config.retries.retrialTopic),
                  "retry-partition": Buffer.from(partition.toString()),
                }
              : {
                  "original-partition": Buffer.from(partition.toString()),
                }),
          }),
    };
  }
}
