import { EachMessagePayload, Kafka } from "kafkajs";
import { BaseConsumerMeta, MetaFactory } from "./ConsumerMeta";
import { Producer } from "../Producer";

type MessageHandler<TMeta = {}> = (
  payload: EachMessagePayload & {
    ctx: {
      metadata: BaseConsumerMeta & TMeta;
      receivedAt: string;
      send: (topic: string, messages: any[]) => Promise<void>;
    };
  },
) => Promise<void>;

interface ConsumerConfigs<TMeta = {}> {
  meta?: MetaFactory<TMeta>;
  dlqTopic: string;
  sessionTimeout?: number;
  heartbeatInterval?: number;
  rebalanceTimeout?: number;
  partitionsConsumedConcurrently?: number;
}

interface ConsumerOffset {
  groupId: string;
  topic: string;
  partition: number;
  offset: string;
}

type TopicConfig<TMeta> = {
  type: "topic" | "retry";
  config: TopicDetail<TMeta>;
};

interface ConsumerTopic<TMeta> {
  topic: string;
  handler: MessageHandler<TMeta>;
}

interface TopicDetail<TMeta> {
  topic: string;
  handler?: MessageHandler<TMeta>;
  useTransaction: boolean;
  retries?: {
    retrialTopic: string;
    count: number;
  };
}

interface ConsumerGroupConfigs<TMeta> {
  groupId: string;
  topics: Omit<TopicDetail<TMeta>, "handler" | "type">[];
  totalConsumers: number;
  consumerConfig: ConsumerConfigs<TMeta>;
  producer: Producer;
  kafkaClient: Kafka;
}

export {
  MessageHandler,
  ConsumerTopic,
  TopicDetail,
  ConsumerGroupConfigs,
  ConsumerConfigs,
  ConsumerOffset,
  TopicConfig,
};
