interface BaseConsumerMeta {
  consumerId?: string;
  groupId?: string;
  isLeader?: boolean;
}

type MetaFactory<TMeta> = () => TMeta | Promise<TMeta>;

export { BaseConsumerMeta, MetaFactory };
