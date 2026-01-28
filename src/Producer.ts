import { Kafka, Producer as KafkaProducer, RecordMetadata } from "kafkajs";
import { Message } from "./types/Message";
import { ConsumerOffset } from "./types/ConsumerGroup";
import { ProducerConfig, ProducerSlot } from "./types/Producer";

export class Producer {
  private noneTxProducer: KafkaProducer;
  private txSlots = new Map<string, ProducerSlot>();
  private isConnected = false;

  constructor(
    private readonly kafkaClient: Kafka,
    private readonly config: ProducerConfig,
    private readonly maxProducers: number = 20,
  ) {
    this.noneTxProducer = this.kafkaClient.producer({
      ...config,
      idempotent: true,
      transactionalId: undefined,
    });
  }

  public async connect() {
    if (this.isConnected) return;
    await this.noneTxProducer.connect();
    this.isConnected = true;
  }

  public async disconnect() {
    await Promise.all([this.noneTxProducer.disconnect(), this.reset()]);
    this.isConnected = false;
  }

  public async send(topic: string, messages: Message[]) {
    if (!this.isConnected) throw new Error("Pool not connected");
    return this.noneTxProducer.send({ topic, messages, acks: -1 });
  }

  public async runInTransaction(
    task: (
      send: (topic: string, messages: Message[]) => Promise<void>,
    ) => Promise<void>,
    offset: ConsumerOffset,
  ): Promise<void> {
    if (!this.isConnected) throw new Error("Pool not connected");
    const slotIndex = offset.partition % this.maxProducers;
    const txId = `${this.config.transactionalIdPrefix}-slot-${slotIndex}`;
    const slot = await this.getOrCreateSlot(txId);
    return new Promise((resolve, reject) => {
      slot.queue = slot.queue.then(async () => {
        try {
          await this.execute(slot.producer, task, offset);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  private async getOrCreateSlot(txId: string) {
    let slot = this.txSlots.get(txId);
    if (!slot) {
      const producer = this.kafkaClient.producer({
        ...this.config,
        transactionalId: txId,
        idempotent: true,
        maxInFlightRequests: 1,
      });
      await producer.connect();
      slot = {
        producer,
        queue: Promise.resolve(),
      };
      this.txSlots.set(txId, slot);
    }
    return slot;
  }

  private async execute(
    producer: KafkaProducer,
    task: any,
    offset: ConsumerOffset,
  ) {
    const transaction = await producer.transaction();
    let txStep: Promise<void | RecordMetadata[]> = Promise.resolve();
    try {
      const txSend = async (topic: string, messages: Message[]) => {
        txStep = txStep.then(() => transaction.send({ topic, messages }));
        return txStep;
      };
      await task(txSend);
      await txStep;
      await transaction.sendOffsets({
        consumerGroupId: offset.groupId,
        topics: [
          {
            topic: offset.topic,
            partitions: [
              { partition: offset.partition, offset: offset.offset },
            ],
          },
        ],
      });
      await transaction.commit();
    } catch (err) {
      await txStep.catch(() => {});
      await transaction.abort();
      throw err;
    }
  }

  async reset() {
    const disconnects = Array.from(this.txSlots.values()).map(async (slot) => {
      try {
        await slot.queue.catch(() => {});
        await slot.producer.disconnect();
      } catch (_) {}
    });
    await Promise.all(disconnects);
    this.txSlots.clear();
  }
}
