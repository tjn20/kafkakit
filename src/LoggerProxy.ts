import { kafkaConfig } from "./KafkaConfig";

export class LoggerProxy {
  constructor(private component: string) {}

  private get log() {
    return kafkaConfig.logger;
  }

  public format({
    topic,
    partition,
    offset,
    key,
  }: {
    topic: string;
    partition?: number;
    offset?: string;
    key?: string;
  }) {
    const parts = [
      `topic=${topic}`,
      partition !== undefined && `partition=${partition}`,
      offset !== undefined && `offset=${offset}`,
      key && `key=${key}`,
    ].filter(Boolean);

    return `[${this.component}] [${parts.join(" | ")}]`;
  }

  info(msg: string, ctx?: any) {
    this.log.info(msg, ctx);
  }
  warn(msg: string, ctx?: any) {
    this.log.warn(msg, ctx);
  }
  error(msg: string, ctx?: any) {
    this.log.error(msg, ctx);
  }
}
