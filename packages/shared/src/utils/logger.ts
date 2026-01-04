/**
 * Logging utility for Chiba digital signage system.
 * Provides structured, leveled logging with context support.
 */

import { LogLevel, ENV } from '../constants.js';

/**
 * Log entry structure.
 */
export interface LogEntry {
  /** ISO timestamp */
  timestamp: string;
  /** Log level */
  level: keyof typeof LogLevel;
  /** Component name (e.g., "controller", "node:living-room") */
  component: string;
  /** Module or subsystem (e.g., "cache", "playback", "ws") */
  module: string;
  /** Log message */
  message: string;
  /** Additional data */
  data?: Record<string, unknown>;
  /** Error if applicable */
  error?: Error;
}

/**
 * Format a log entry as a string.
 */
function formatLogEntry(entry: LogEntry): string {
  const { timestamp, level, component, module, message, data, error } = entry;

  let line = `[${timestamp}] [${level}] [${component}] [${module}] ${message}`;

  if (data && Object.keys(data).length > 0) {
    line += ` ${JSON.stringify(data)}`;
  }

  if (error) {
    line += `\n  Error: ${error.message}`;
    if (error.stack) {
      line += `\n  Stack: ${error.stack}`;
    }
  }

  return line;
}

/**
 * Get the current log level from environment.
 */
function getLogLevel(): LogLevel {
  const envLevel = process.env[ENV.LOG_LEVEL]?.toUpperCase();

  switch (envLevel) {
    case 'DEBUG':
      return LogLevel.DEBUG;
    case 'INFO':
      return LogLevel.INFO;
    case 'WARN':
      return LogLevel.WARN;
    case 'ERROR':
      return LogLevel.ERROR;
    default:
      return LogLevel.INFO;
  }
}

/**
 * Check if a log level should be output.
 */
function shouldLog(level: LogLevel): boolean {
  return level >= getLogLevel();
}

/**
 * Logger class for structured logging.
 */
export class Logger {
  private component: string;
  private module: string;

  /**
   * Create a new logger instance.
   * @param component - Component name (e.g., "controller", "node:living-room")
   * @param module - Module name (e.g., "cache", "playback")
   */
  constructor(component: string, module: string) {
    this.component = component;
    this.module = module;
  }

  /**
   * Create a child logger with a different module.
   */
  child(module: string): Logger {
    return new Logger(this.component, module);
  }

  /**
   * Log at DEBUG level.
   */
  debug(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, data);
  }

  /**
   * Log at INFO level.
   */
  info(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, data);
  }

  /**
   * Log at WARN level.
   */
  warn(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, data);
  }

  /**
   * Log at ERROR level.
   */
  error(message: string, error?: Error, data?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, data, error);
  }

  /**
   * Internal log method.
   */
  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
    error?: Error
  ): void {
    if (!shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel[level] as keyof typeof LogLevel,
      component: this.component,
      module: this.module,
      message,
      data,
      error,
    };

    const formatted = formatLogEntry(entry);

    switch (level) {
      case LogLevel.DEBUG:
      case LogLevel.INFO:
        console.log(formatted);
        break;
      case LogLevel.WARN:
        console.warn(formatted);
        break;
      case LogLevel.ERROR:
        console.error(formatted);
        break;
    }
  }

  /**
   * Log a state transition.
   */
  transition(from: string, to: string, data?: Record<string, unknown>): void {
    this.info(`State transition: ${from} → ${to}`, data);
  }

  /**
   * Log the start of an operation with timing.
   * Returns a function to call when the operation completes.
   */
  time(operation: string, data?: Record<string, unknown>): () => void {
    const start = Date.now();
    this.debug(`Starting: ${operation}`, data);

    return () => {
      const duration = Date.now() - start;
      this.info(`Completed: ${operation}`, { ...data, durationMs: duration });
    };
  }

  /**
   * Log an async operation with automatic timing.
   */
  async timed<T>(
    operation: string,
    fn: () => Promise<T>,
    data?: Record<string, unknown>
  ): Promise<T> {
    const done = this.time(operation, data);
    try {
      const result = await fn();
      done();
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.error(`Failed: ${operation}`, err, data);
      throw error;
    }
  }
}

/**
 * Create a logger for a component.
 * @param component - Component name (e.g., "controller", "node:living-room")
 * @param module - Default module name
 */
export function createLogger(component: string, module = 'main'): Logger {
  return new Logger(component, module);
}

/**
 * Pre-configured loggers for common components.
 */
export const loggers = {
  controller: (module = 'main') => createLogger('controller', module),
  node: (nodeName: string, module = 'main') =>
    createLogger(`node:${nodeName}`, module),
  player: (module = 'main') => createLogger('player', module),
  dashboard: (module = 'main') => createLogger('dashboard', module),
};
