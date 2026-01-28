import { IHeaders } from "kafkajs";
import { BaseConsumerMeta } from "./ConsumerMeta";

interface Event<TData, TMeta = {}> {
  data: TData;
  key?: string;
  ctx: {
    send: (
      topic: string,
      messages: {
        key: string;
        value: string;
        headers?: Record<string, Buffer>;
      }[],
    ) => Promise<void>;
    metadata: BaseConsumerMeta & TMeta;
    headers?: IHeaders;
    producedAt: string;
    receivedAt: string;
  };
}

type TypedHandler<TData, TMeta> = (event: Event<TData, TMeta>) => Promise<void>;

export { TypedHandler, Event };
