<h1 align="center">kafkakit</h1>
<p align="center">
  <a href="https://www.npmjs.com/package/kafkakit">
    <img src="https://img.shields.io/npm/v/kafkakit.svg" alt="NPM Version">
  </a>
  <a href="https://www.npmjs.com/package/kafkakit">
    <img src="https://img.shields.io/npm/dt/kafkakit.svg" alt="Downloads">
  </a>
  <img src="https://img.shields.io/bundlephobia/minzip/kafkakit" alt="Bundle Size">
  <img src="https://img.shields.io/github/license/tjn20/kafkakit" alt="License">
</p>

## Introduction

A Node.js/TypeScript toolkit for Kafka with exactly-once semantics (EOS), transactional and idempotent producers, dynamic consumer groups, retry and dead-letter pipelines, producer pool management, multi-cluster support, and graceful shutdown. Fully typed and event-driven, with all internal complexity hidden. Designed to support Saga-based workflows and orchestration patterns for building reliable distributed systems.

## Key Features

- ### Dual-Mode EOS Message Handling
  - Supports transactional producers for EOS.
  - Can also work in exactly-once mode without full Kafka transactions, using idempotent producers.
  - Manages offsets automatically for transactional and non-transactional consumption.
- ### The Transactional Guarantee (EOS)
  - Every partition is assigned to a stable producer identity.
  - Maintains a pool of Kafka producers for transactional sends.
  - Ensures transactional producers are not shared mid-transaction.
  - Constraint: Producer pool size and transactional id should remain stable across pod restarts to mantain EOS guarantees.
- ### The Recovery Pipeline (Retry & DLQ)
  - Messages that fail are automatically moved to "Retry Topics" with the required metadata attached to the headers whether its a transtional or a non-transactional message.
  - Once retries are exhausted or no retries specified, messages are safely moved to a DLQ for manual inspection, ensuring your main processing loop never gets blocked by a "poison pill" message.
- ### Consumer Groups
  - Graceful shutdown support for in-flight message processing.
  - Supports different configs per topic.
  - Built-in retry and dead-letter pipelines.
- ### Multi-cluster Support
  - Run multiple independent Kafka clusters (e.g., Finance and Analytics) within a single server instance. All internal state, producer pools, and configurations are strictly isolated.
- ### Event-Driven Routing
  - Subscribe to typed events by message event.
  - Each topic can have multiple event handlers.
  - Handles JSON parsing, metadata injection, and transactional context automatically.
- ### Internal Metadata Support
  - Each consumer can have custom metadata (consumer ID, custom context such as pod region) injected automatically.
  - Useful for tracking and dynamic routing of messages.

## Consumer Retries

![Image](https://github.com/user-attachments/assets/a66d55a0-c07e-4545-b417-46b2332fbd3a)

## Installation

Install from NPM

```
npm i kafkakit
```

## Usage

### Setting a logger (optional)

```js
import { kafkaConfig } from "kafkakit";

kafkaConfig.setLogger(logger); // Your customized logger
```

### Initialize your Kafka client to pass in

```js
import { Kafka } from "kafkajs";
kafkaClient = new Kafka({
  clientId: "example",
  brokers: [],
});
```

### Producer

- ### Functions Available
  - The `connect()` function allows you to connect your non-transactional producer. Regarding transational ones, they're automatically created by the consumers.
  - The `disconnect()` allows you to gracefully shut down your producers by waiting for each to finish its jobs, ensuring that no in-flight messages are dropped and all internal buffers are flushed before the process exits.
  - The `reset()` mechanism is specifically designed for Kafka rebalances. It "drains" the current promise queues for transactional producers, allowing pending sends to complete before clearing the pool. This prevents "Zombie Producers" from hanging around after partition ownership has shifted.

    Note: This is an internal safeguard and is not intended for direct use.

  - The `send()` method publishes messages using a shared idempotent producer and is intended for non-transactional flows. It ensures durability with `acks: -1` but does not tie message production to consumer offset commits.
  - The `runInTransaction()` method enables exactly-once semantics by wrapping message production and offset commits inside a single Kafka transaction. If the task succeeds, both the produced messages and the offset commit are finalized atomically; if it fails, the transaction is aborted and no offsets are advanced.

    Note: This is typically used within consumers and is already configured for you in the consumer examples below, as the package handles the setup automatically.

- ### Example

  ```js
  import { Producer, ProducerConfig } from "kafkakit";


  /*
  * transactionalIdPrefix & maxPoolSize => Must remain stable across pod restarts to avoid transactional fencing and PID invalidation
  */

  const config: ProducerConfig = {
  transactionalIdPrefix: env.POD_NAME,
  createPartitioner?: ICustomPartitioner
  retry?: RetryOptions
  metadataMaxAge?: number
  allowAutoTopicCreation?: boolean
  transactionTimeout?: number
  maxInFlightRequests?: number
  }

  const maxPoolSize = 5

  const producer = new Producer(kafkaClient,config,maxPoolSize);

  await producer.connect()
  await producer.disconnect()
  await producer.reset() // Not meant for manual usage

  await producer.send("topic",[{
    key: "test",
    value: JSON.stringify({
      event: "OrderCreated",
      data: {
        name: "example"
      }
    })
  }])


  // Either both topics get the messages or none do.
  // This is meant for consume -> process -> produce -> commit offset atomically (can't be used manually).
  await producer.runInTransaction(async (send)=> {
    // Any processing
    const result = await db.findById(exampleId)
    // If you want to send a message to another topic
    await send("topic-1",[
      {
       event: "OrderCreated",
        data: {
          result
        }
      }
    ])

     await send("topic-2",[
      {
       event: "OrderCreated",
        data: {
          result
        }
      }
    ])
  },{
    groupId: "example-group",
    topic,
    partition,
    offset: (BigInt(message.offset) + 1n).toString(),
  })
  ```

### Consumer Group

- ### Functions Available
  - The `connect()` function connects and starts the consumers belonging to their group.
  - The `disconnect()` function gracefully shuts down the consumers in the group by waiting for all in-flight messages to finish processing before shutting down.
  - The `subscribe()` function registers consumers in a group to a specific topic and attaches the corresponding event handlers.

### Topic Events

- ### Properties & Functions Available
  - The `topic` property returns the topic name.
  - The `on<EventDataType>()` function registers an event handler for a specific event within a topic.
  - The `getSubscription()` function returns the topic along with its registered event handlers, ready to be subscribed by a consumer group.

### Consumer Group + Topic Events Example

- Everyone might have their own way of writing the code and initializing things, but here is an illustrative example.

```js
import { ConsumerGroup, TopicEvents, ConsumerGroupConfigs, ConsumerConfigs } from "kafkakit";

interface OrderCreated {
  products: string[]
}

const setupOrdersTopic = async () => {
  /*
   * const db = db client (for example);
   */
  const topicEvents = new TopicEvents("orders");

  topicEvents.on<OrderCreated>("OrderCreated",async({
    key, // if no key was set on the message its undefined
    data, // data object without the event
    ctx: {
      producedAt, // timestamp when message was produced
      receivedAt, // timestamp when consumer started processing
      headers, // message header -> might be undefined if no header was set
      metadata: { // additional context
        consumerId, groupId, isLeader, // base metadata of the consumer -> might be undefined before the consumer joins the group
        // context provided by you
        region
      },
      send // Sends messages either transactionally or non-transactionally, depending on the topic configuration
    }
  })=> {
     // Example: Only the leader consumer performs certain actions
  if (isLeader)
    console.log("I am the leader, performing leader-only logic...");

  // Example: Store the region that processed the actions
  db.store(region)

  await send("Payment",[{
    key: "example",
    headers: {
      source: "example-service"
    },
    value: JSON.stringify({
      event: "OrderCreated",
      data: {
        orderId: key
      }
    })
  }])
  })
  return topicEvents
};

const topicsHandlerSetupMap: Record<
  string,
  () => Promise<TopicEvents<any>>
> = {
  orders: setupOrdersTopic
}

// Consumer Group

const consumerConfig: ConsumerConfigs<TMeta> = {
  dlqTopic: "dead-letter-queue";
  sessionTimeout?: number;
  heartbeatInterval?: number;
  rebalanceTimeout?: number;
  partitionsConsumedConcurrently?: number;
  /*
  * Additional context that will be passed to consumers.
  * This will run on each message.
  * For best practices, avoid making database or external API calls here to prevent delays during message processing.
  */
  meta?: ()=> ({
    region: env.POD_REGION
  })
}

const consumerGroupConfig:ConsumerGroupConfigs<TMeta> = {
  groupId: "example",
  totalConsumers: 3,
  producer: // Producer cluster instance we created
  kafkaClient // kafka client
  consumerConfig:consumerConfig,
  topics: [
    {
      topic: "orders",
      useTransaction: true,
      retries: {
        count: 3,
        retrialTopic: "orders-retry"
      }
    },
    {
      topic: "payment",
      useTransaction: false,
      // retries is optional
    }
  ]
}

const consumerGroup = new ConsumerGroup<TMeta>(consumerGroupConfig)
await Promise.all(consumerGroupConfig.topics.map(async ({topic})=> {
  const setupFn = topicsHandlerSetupMap[topic]
  if(!setupFn) return

  const topicEvents = await setupFn();
  const subscription = topicEvents.getSubscription();

  consumerGroup.subscribe(topic, subscription.handler);
}))

await consumerGroup.connect()

await consumerGroup.disconnect()

```
