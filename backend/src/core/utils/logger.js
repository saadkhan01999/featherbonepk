/**
 * Structured logger.
 * ---------------------------------------------------------------------------
 * Development gets colourised, human-scannable lines. Production emits
 * single-line JSON, because log aggregators (CloudWatch, Loki, Datadog) parse
 * JSON and cannot reliably parse prettified multi-line output.
 *
 * Deliberately dependency-free — a logger is imported by nearly every module,
 * and this keeps the dependency graph (and the cold-start cost) small.
 */
import { env } from '../../config/env.config.js';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const ACTIVE_LEVEL = env.isProduction ? LEVELS.info : LEVELS.debug;

const COLOUR = {
  error: '\x1b[31m',
  warn: '\x1b[33m',
  info: '\x1b[36m',
  debug: '\x1b[90m',
  reset: '\x1b[0m',
  dim: '\x1b[2m',
};

/*
 * Reserved keys (level, time, message) always keep the log's own values. A
 * meta key that collides — `{ message: error.message }` is common — is kept as
 * `meta_<key>` instead of overwriting the line's message.
 */
const RESERVED = new Set(['level', 'time', 'message']);

function serialise(level, message, meta) {
  const line = { level, time: new Date().toISOString(), message };
  for (const [key, value] of Object.entries(meta ?? {})) {
    line[RESERVED.has(key) ? `meta_${key}` : key] = value;
  }
  return JSON.stringify(line);
}

function emit(level, message, meta) {
  if (LEVELS[level] > ACTIVE_LEVEL) return;

  if (env.isProduction) {
    // One line, machine-parseable. `meta` is flattened so fields are queryable
    // rather than buried in a nested object.
    console[level === 'debug' ? 'log' : level](serialise(level, message, meta));
    return;
  }

  const time = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const tag = `${COLOUR[level]}${level.toUpperCase().padEnd(5)}${COLOUR.reset}`;
  const extra =
    meta && Object.keys(meta).length ? ` ${COLOUR.dim}${JSON.stringify(meta)}${COLOUR.reset}` : '';
  console[level === 'debug' ? 'log' : level](`${COLOUR.dim}${time}${COLOUR.reset} ${tag} ${message}${extra}`);
}

export const logger = {
  error: (message, meta) => emit('error', message, meta),
  warn: (message, meta) => emit('warn', message, meta),
  info: (message, meta) => emit('info', message, meta),
  debug: (message, meta) => emit('debug', message, meta),

  /** Boot banner — prints the resolved runtime configuration once at startup. */
  banner: (lines) => {
    if (env.isProduction) {
      logger.info('Service started', lines);
      return;
    }
    const width = 62;
    console.log(`\n${COLOUR.info}┌${'─'.repeat(width)}┐${COLOUR.reset}`);
    for (const [key, value] of Object.entries(lines)) {
      const text = `  ${key.padEnd(14)} ${value}`;
      console.log(`${COLOUR.info}│${COLOUR.reset}${text.padEnd(width)}${COLOUR.info}│${COLOUR.reset}`);
    }
    console.log(`${COLOUR.info}└${'─'.repeat(width)}┘${COLOUR.reset}\n`);
  },
};

export default logger;
