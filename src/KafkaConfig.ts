import { Logger } from "./types/Logger";

const defaultLogger: Logger = {
  info: (msg, ctx) => console.log(`[INFO] ${msg}`, ctx || ""),
  error: (msg, ctx) => console.error(`[ERROR] ${msg}`, ctx || ""),
  warn: (msg, ctx) => console.warn(`[WARN] ${msg}`, ctx || ""),
};

class KafkaConfig {
  private _logger: Logger = defaultLogger;

  constructor() {}

  public setLogger(logger: Logger) {
    this._logger = logger;
  }

  public get logger(): Logger {
    return this._logger;
  }
}

export const kafkaConfig = new KafkaConfig();
