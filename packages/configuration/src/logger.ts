/**
 * Structured JSON logger: one JSON object per line on stdout/stderr.
 * Level comes from LOG_LEVEL (debug | info | warn | error, default info).
 * Never log passwords, tokens, cookies or full request bodies.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  /** A logger that adds `fields` to every line. */
  child(fields: Record<string, unknown>): Logger;
}

export type LogSink = (line: string, level: LogLevel) => void;

const defaultSink: LogSink = (line, level) => {
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
};

function currentLevel(): LogLevel {
  const v = process.env.LOG_LEVEL;
  return v === 'debug' || v === 'info' || v === 'warn' || v === 'error' ? v : 'info';
}

function serialise(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

export function createLogger(
  base: Record<string, unknown> = {},
  sink: LogSink = defaultSink,
): Logger {
  const write = (level: LogLevel, message: string, fields?: Record<string, unknown>) => {
    if (ORDER[level] < ORDER[currentLevel()]) return;
    const entry: Record<string, unknown> = {
      time: new Date().toISOString(),
      level,
      msg: message,
      ...base,
    };
    for (const [k, v] of Object.entries(fields ?? {})) entry[k] = serialise(v);
    let line: string;
    try {
      line = JSON.stringify(entry);
    } catch {
      line = JSON.stringify({
        time: entry.time,
        level,
        msg: message,
        note: 'unserialisable fields dropped',
      });
    }
    sink(line, level);
  };
  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
    child: (fields) => createLogger({ ...base, ...fields }, sink),
  };
}
