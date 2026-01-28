import { Event, TypedHandler } from "./types/Event";
import { ConsumerTopic, MessageHandler } from "./types/ConsumerGroup";
import { LoggerProxy } from "./LoggerProxy";

export class TopicEvents<TMeta extends {} = {}> {
  private logger: LoggerProxy;
  private handlers: Map<string, TypedHandler<any, TMeta>> = new Map();
  public readonly topic: string;

  constructor(topicName: string) {
    this.logger = new LoggerProxy("TopicEvents");
    this.topic = topicName;
  }

  public on<TData>(
    eventName: string,
    handler: TypedHandler<TData, TMeta>,
  ): void {
    if (this.handlers.has(eventName)) {
      this.logger.warn(
        `${this.topic} Overwriting existing handler for event: "${eventName}". Ensure this is intentional.`,
      );
    }
    this.handlers.set(eventName, handler);
  }

  public getSubscription(): ConsumerTopic<TMeta> {
    return {
      topic: this.topic,
      handler: this.runHandler(),
    };
  }

  private async execute(
    eventName: string,
    topic: string,
    event: Event<any, TMeta>,
  ): Promise<void> {
    const handler = this.handlers.get(eventName);
    if (!handler) {
      const logPrefix = this.logger.format({
        topic,
        key: eventName,
      });
      this.logger.warn(
        `${logPrefix} No handler for event. Message will be skipped.`,
      );

      return;
    }
    await handler(event);
  }

  private runHandler(): MessageHandler<TMeta> {
    return async ({ message, ctx: { metadata, send, receivedAt } }) => {
      const key = message.key?.toString();
      const value = message.value?.toString();
      const logPrefix = this.logger.format({
        topic: this.topic,
        key,
      });

      if (!value) {
        throw new Error(`${logPrefix} Received empty body.`);
      }
      try {
        const parsed = JSON.parse(value);
        const eventName = parsed.event;
        if (!eventName) {
          throw new Error(
            `Missing message event on topic ${this.topic} with key ${key}`,
          );
        }
        const data = parsed.data;
        if (!data) {
          throw new Error(`${logPrefix} Received no data object.`);
        }
        await this.execute(eventName, this.topic, {
          key,
          data,
          ctx: {
            send,
            metadata,
            headers: message.headers,
            producedAt: message.timestamp,
            receivedAt,
          },
        });
      } catch (error) {
        this.logger.error(
          `${logPrefix} Execution failed: ${(error as Error).message}`,
          {
            stack: (error as Error).stack,
          },
        );
        throw error;
      }
    };
  }
}
