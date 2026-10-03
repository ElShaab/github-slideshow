/* Minimal structured logger. Never logs request bodies, receipts or photo bytes. */

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[(process.env.LOG_LEVEL as Level) ?? 'info'] ?? LEVELS.info;

function emit(level: Level, message: string, meta?: unknown): void {
  if (LEVELS[level] < threshold) return;
  const line = {
    time: new Date().toISOString(),
    level,
    message,
    ...(meta !== undefined ? { meta: serialise(meta) } : {}),
  };
  const output = JSON.stringify(line);
  if (level === 'error') process.stderr.write(`${output}\n`);
  else process.stdout.write(`${output}\n`);
}

function serialise(meta: unknown): unknown {
  if (meta instanceof Error) {
    return { name: meta.name, message: meta.message, stack: meta.stack };
  }
  return meta;
}

export const logger = {
  debug: (message: string, meta?: unknown) => emit('debug', message, meta),
  info: (message: string, meta?: unknown) => emit('info', message, meta),
  warn: (message: string, meta?: unknown) => emit('warn', message, meta),
  error: (message: string, meta?: unknown) => emit('error', message, meta),
};
