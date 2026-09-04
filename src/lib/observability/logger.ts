import { stripSecrets } from "@/lib/offline/secrets";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

const SENSITIVE_STRING_RE =
  /(password|secret|token|authorization|api[_-]?key|bearer|cookie|private[_-]?key)/i;

function redactString(value: string): string {
  if (value.length > 512) return `${value.slice(0, 512)}…[truncated]`;
  if (SENSITIVE_STRING_RE.test(value) && value.length > 24) {
    return "[redacted]";
  }
  return value;
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean" || value == null) {
    return value;
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
    };
  }
  return stripSecrets(value);
}

function sanitizeFields(fields?: LogFields): LogFields | undefined {
  if (!fields) return undefined;
  const cleaned: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE_STRING_RE.test(key) && !key.toLowerCase().includes("mutation")) {
      continue;
    }
    cleaned[key] = sanitizeValue(value);
  }
  return cleaned;
}

export type StructuredLogger = {
  child: (fields: LogFields) => StructuredLogger;
  debug: (message: string, fields?: LogFields) => void;
  info: (message: string, fields?: LogFields) => void;
  warn: (message: string, fields?: LogFields) => void;
  error: (message: string, fields?: LogFields) => void;
};

function emit(level: LogLevel, message: string, fields?: LogFields): void {
  if (process.env.NODE_ENV === "test" && level === "debug") return;

  const payload = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...sanitizeFields(fields),
  };

  const line = JSON.stringify(payload);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.info(line);
}

export function createLogger(base: LogFields = {}): StructuredLogger {
  const write = (level: LogLevel, message: string, fields?: LogFields) => {
    emit(level, message, { ...base, ...fields });
  };

  return {
    child(fields) {
      return createLogger({ ...base, ...sanitizeFields(fields) });
    },
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  };
}

export const rootLogger = createLogger({ service: "nexgestaovendas" });
