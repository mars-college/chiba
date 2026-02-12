import { PARAM_LOG_LEVEL } from "../constants/params";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const STORAGE_KEY = "chiba:log";

const parseLevel = (value?: string | null): LogLevel | null => {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "debug" ||
    normalized === "info" ||
    normalized === "warn" ||
    normalized === "error"
  ) {
    return normalized;
  }
  if (normalized === "1" || normalized === "true" || normalized === "on") {
    return "debug";
  }
  if (normalized === "off" || normalized === "0" || normalized === "false") {
    return null;
  }
  return null;
};

const getLogLevel = (): LogLevel | null => {
  if (typeof window === "undefined") {
    return import.meta.env.DEV ? "debug" : "warn";
  }
  const params = new URLSearchParams(window.location.search);
  const paramLevel = parseLevel(params.get(PARAM_LOG_LEVEL));
  if (paramLevel !== null) return paramLevel;
  try {
    const stored = parseLevel(window.localStorage.getItem(STORAGE_KEY));
    if (stored !== null) return stored;
  } catch {
    // ignore storage errors
  }
  return import.meta.env.DEV ? "debug" : "warn";
};

export type Logger = {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  event: (name: string, detail?: Record<string, unknown>) => void;
};

export const createLogger = (scope: string): Logger => {
  const level = getLogLevel();
  if (!level) {
    const noop = () => {};
    return {
      debug: noop,
      info: noop,
      warn: noop,
      error: noop,
      event: noop,
    };
  }
  const minRank = LEVEL_RANK[level];
  const prefix = `[${scope}]`;

  const canLog = (lvl: LogLevel) => LEVEL_RANK[lvl] >= minRank;

  return {
    debug: (...args) => {
      if (canLog("debug")) console.debug(prefix, ...args);
    },
    info: (...args) => {
      if (canLog("info")) console.info(prefix, ...args);
    },
    warn: (...args) => {
      if (canLog("warn")) console.warn(prefix, ...args);
    },
    error: (...args) => {
      if (canLog("error")) console.error(prefix, ...args);
    },
    event: (name, detail) => {
      if (canLog("info")) {
        const payload = detail ? { ...detail } : undefined;
        console.info(prefix, name, payload ?? "");
      }
    },
  };
};
