/**
 * Centralized Logging Service
 */

import chalk from 'chalk';
import { EventBus } from './event-bus';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4
}

export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  context: string;
  message: string;
  data?: any;
  error?: Error;
}

export interface LoggerOptions {
  level?: LogLevel;
  context?: string;
  color?: any; // Chalk instance or color function
  eventBus?: EventBus;
}

export class Logger {
  private level: LogLevel;
  private context: string;
  private color: any; // Chalk instance or color function
  private eventBus?: EventBus;
  private static globalLevel: LogLevel = LogLevel.INFO;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? Logger.globalLevel;
    this.context = options.context || 'App';
    this.color = options.color || chalk;
    this.eventBus = options.eventBus;
  }

  /**
   * Set global log level
   */
  static setGlobalLevel(level: LogLevel): void {
    Logger.globalLevel = level;
  }

  /**
   * Create a child logger with specific context
   */
  child(context: string, color?: any): Logger {
    return new Logger({
      level: this.level,
      context: `${this.context}:${context}`,
      color: color || this.color,
      eventBus: this.eventBus
    });
  }

  /**
   * Debug level logging
   */
  debug(message: string, data?: any): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  /**
   * Info level logging
   */
  info(message: string, data?: any): void {
    this.log(LogLevel.INFO, message, data);
  }

  /**
   * Warning level logging
   */
  warn(message: string, data?: any): void {
    this.log(LogLevel.WARN, message, data);
  }

  /**
   * Error level logging
   */
  error(message: string, error?: Error | any, data?: any): void {
    if (error instanceof Error) {
      this.log(LogLevel.ERROR, message, { ...data, error: error.message, stack: error.stack }, error);
    } else {
      this.log(LogLevel.ERROR, message, { ...data, error });
    }
  }

  /**
   * Log with specific level
   */
  private log(level: LogLevel, message: string, data?: any, error?: Error): void {
    if (level < this.level) return;

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      context: this.context,
      message,
      data,
      error
    };

    // Format and output
    this.output(entry);

    // Emit to event bus if available
    if (this.eventBus) {
      this.eventBus.emit('log', entry);
    }
  }

  /**
   * Format and output log entry
   */
  private output(entry: LogEntry): void {
    const timestamp = entry.timestamp.toISOString();
    const levelStr = LogLevel[entry.level].padEnd(5);
    const contextStr = `[${entry.context}]`;

    let output = '';
    
    switch (entry.level) {
      case LogLevel.DEBUG:
        output = chalk.gray(`${timestamp} ${levelStr} ${contextStr} ${entry.message}`);
        break;
      case LogLevel.INFO:
        output = this.color(`${timestamp} ${levelStr} ${contextStr} ${entry.message}`);
        break;
      case LogLevel.WARN:
        output = chalk.yellow(`${timestamp} ${levelStr} ${contextStr} ${entry.message}`);
        break;
      case LogLevel.ERROR:
        output = chalk.red(`${timestamp} ${levelStr} ${contextStr} ${entry.message}`);
        break;
    }

    console.log(output);

    if (entry.data && Object.keys(entry.data).length > 0) {
      // Custom replacer to handle BigInt serialization
      const replacer = (_key: string, value: any) => {
        if (typeof value === 'bigint') {
          return value.toString();
        }
        return value;
      };
      console.log(chalk.gray(JSON.stringify(entry.data, replacer, 2)));
    }

    if (entry.error && entry.error.stack) {
      console.error(chalk.red(entry.error.stack));
    }
  }

  /**
   * Log a progress update (same line)
   */
  progress(message: string): void {
    if (this.level > LogLevel.INFO) return;
    process.stdout.write(`\r${this.color(message)}`);
  }

  /**
   * Clear progress line
   */
  clearProgress(): void {
    process.stdout.write('\r\x1b[K');
  }

  /**
   * Log a formatted table
   */
  table(data: any[], columns?: string[]): void {
    if (this.level > LogLevel.INFO) return;
    console.table(data, columns);
  }

  /**
   * Log a horizontal line
   */
  line(char: string = '═', length: number = 50): void {
    if (this.level > LogLevel.INFO) return;
    console.log(this.color(char.repeat(length)));
  }

  /**
   * Log a box with title
   */
  box(title: string, content: Record<string, any>): void {
    if (this.level > LogLevel.INFO) return;
    
    const maxKeyLength = Math.max(...Object.keys(content).map(k => k.length));
    const boxWidth = Math.max(title.length, maxKeyLength + 20) + 4;
    
    this.line('═', boxWidth);
    console.log(this.color(`║ ${title.padEnd(boxWidth - 4)} ║`));
    this.line('═', boxWidth);
    
    for (const [key, value] of Object.entries(content)) {
      const keyStr = key.padEnd(maxKeyLength);
      const valueStr = String(value);
      console.log(this.color(`║ ${keyStr} : ${valueStr.padEnd(boxWidth - maxKeyLength - 7)} ║`));
    }
    
    this.line('═', boxWidth);
  }
}

// Factory functions for creating loggers
export function createLogger(context: string, options?: Omit<LoggerOptions, 'context'>): Logger {
  return new Logger({ ...options, context });
}

// Pre-configured loggers
export const loggers = {
  monitor: (name: string, color?: any) => createLogger(`Monitor:${name}`, { color }),
  service: (name: string) => createLogger(`Service:${name}`),
  parser: (name: string) => createLogger(`Parser:${name}`),
  handler: (name: string) => createLogger(`Handler:${name}`),
  api: (name: string) => createLogger(`API:${name}`),
  websocket: (name: string) => createLogger(`WebSocket:${name}`),
  database: (name: string) => createLogger(`Database:${name}`),
};