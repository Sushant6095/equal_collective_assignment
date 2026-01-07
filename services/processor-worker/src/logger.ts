/**
 * Structured logging for processor worker
 */

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
}

export interface LogContext {
  [key: string]: unknown;
}

/**
 * Simple structured logger
 */
export class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = LogLevel.INFO) {
    this.level = level;
  }

  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    return levels.indexOf(level) >= levels.indexOf(this.level);
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      service: 'processor-worker',
      ...context,
    };

    switch (level) {
      case LogLevel.DEBUG:
        console.debug(JSON.stringify(logEntry));
        break;
      case LogLevel.INFO:
        console.info(JSON.stringify(logEntry));
        break;
      case LogLevel.WARN:
        console.warn(JSON.stringify(logEntry));
        break;
      case LogLevel.ERROR:
        console.error(JSON.stringify(logEntry));
        break;
    }
  }

  debug(message: string, context?: LogContext): void {
    this.log(LogLevel.DEBUG, message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log(LogLevel.INFO, message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log(LogLevel.WARN, message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log(LogLevel.ERROR, message, context);
  }
}

export const logger = new Logger(
  (process.env.LOG_LEVEL as LogLevel) || LogLevel.INFO
);

