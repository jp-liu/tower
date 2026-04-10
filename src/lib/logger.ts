type LogLevel = "info" | "warn" | "error";

function formatMessage(level: LogLevel, context: string, message: string, meta?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] ${level.toUpperCase()} [${context}] ${message}`;
  if (meta && Object.keys(meta).length > 0) {
    return `${base} ${JSON.stringify(meta)}`;
  }
  return base;
}

function createLogger(context: string) {
  return {
    info(message: string, meta?: Record<string, unknown>) {
      console.log(formatMessage("info", context, message, meta));
    },
    warn(message: string, meta?: Record<string, unknown>) {
      console.warn(formatMessage("warn", context, message, meta));
    },
    error(message: string, error?: unknown, meta?: Record<string, unknown>) {
      const errMeta = error instanceof Error
        ? { ...meta, error: error.message, stack: error.stack }
        : { ...meta, error: String(error) };
      console.error(formatMessage("error", context, message, errMeta));
    },
  };
}

export const logger = {
  /** Create a scoped logger for a module/component */
  create: createLogger,

  // Convenience top-level methods
  info(message: string, meta?: Record<string, unknown>) {
    console.log(formatMessage("info", "app", message, meta));
  },
  warn(message: string, meta?: Record<string, unknown>) {
    console.warn(formatMessage("warn", "app", message, meta));
  },
  error(message: string, error?: unknown, meta?: Record<string, unknown>) {
    const errMeta = error instanceof Error
      ? { ...meta, error: error.message, stack: error.stack }
      : { ...meta, error: String(error) };
    console.error(formatMessage("error", "app", message, errMeta));
  },
};
