import {
  ConsumerGroupConfigs,
  MessageHandler,
  TopicConfig,
  TopicDetail,
} from "./types/ConsumerGroup";
import { Consumer } from "./Consumer";
import { LoggerProxy } from "./LoggerProxy";

export class ConsumerGroup<TMeta = {}> {
  private logger: LoggerProxy;
  private consumers: Consumer<TMeta>[] = [];
  private topics: Map<string, TopicDetail<TMeta>>;
  private readonly config: Omit<ConsumerGroupConfigs<TMeta>, "topics">;
  private connected = false;
  constructor(configs: ConsumerGroupConfigs<TMeta>) {
    this.logger = new LoggerProxy("ConsumerGroup");
    this.config = {
      groupId: configs.groupId,
      totalConsumers: configs.totalConsumers,
      consumerConfig: configs.consumerConfig,
      producer: configs.producer,
      kafkaClient: configs.kafkaClient,
    };
    this.topics = new Map(
      configs.topics.map((t) => [t.topic, t as TopicDetail<TMeta>]),
    );
  }

  public async connect() {
    if (this.connected) return;
    await this.setConsumers(this.config.totalConsumers);
    this.logger.info(
      `All consumers for group '${this.config.groupId}' are connected.`,
    );
    this.connected = true;
  }

  public async disconnect() {
    if (!this.connected) return;

    await Promise.all(this.consumers.map((c) => c.disconnect()));
    this.logger.info(
      `All consumers for group '${this.config.groupId}' are disconnected.`,
    );
    this.consumers = [];
    this.connected = false;
  }

  public subscribe(topic: string, handler: MessageHandler<TMeta>) {
    const existing = this.topics.get(topic);
    if (!existing)
      throw new Error(`Topic ${topic} not found in initial configs.`);
    this.topics.set(topic, { ...existing, handler });
  }

  private async setConsumers(desiredConsumers: number) {
    const configProvider = (
      incomingTopic: string,
    ): TopicConfig<TMeta> | undefined => {
      if (this.topics.has(incomingTopic))
        return {
          type: "topic",
          config: this.topics.get(incomingTopic)!,
        };

      for (const config of this.topics.values()) {
        if (config.retries?.retrialTopic === incomingTopic)
          return {
            type: "retry",
            config,
          };
      }

      return undefined;
    };

    const consumers = Array.from(
      { length: desiredConsumers },
      () =>
        new Consumer(
          this.config.groupId,
          this.config.consumerConfig,
          this.config.producer,
          this.config.kafkaClient,
        ),
    );

    const subscriptionList = Array.from(this.topics.values()).reduce<string[]>(
      (acc, config) => {
        acc.push(config.topic);
        if (config.retries?.retrialTopic) {
          acc.push(config.retries.retrialTopic);
        }
        return acc;
      },
      [],
    );
    await Promise.all(
      consumers.map(async (consumer) => {
        await consumer.connect();
        await consumer.subscribe(subscriptionList);
        await consumer.run(configProvider);
      }),
    );
    this.consumers.push(...consumers);
  }
}
