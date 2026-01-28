import { IHeaders } from "kafkajs";

interface Message {
  key: string;
  value: string;
  headers?: IHeaders;
}

export { Message };
