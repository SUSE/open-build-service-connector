import { Logger } from "pino";

/** Base class for components that should have access to the logger */
export class LoggingBase {
  constructor(protected readonly logger: Logger) {}
}
