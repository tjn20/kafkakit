import { Producer, ProducerConfig as Config } from "kafkajs";

interface ProducerConfig extends Omit<
  Config,
  "transactionalId" | "idempotent"
> {
  transactionalIdPrefix: string;
}

interface ProducerSlot {
  producer: Producer;
  queue: Promise<void>;
}

export { ProducerConfig, ProducerSlot };
