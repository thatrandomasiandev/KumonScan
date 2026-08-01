import pino from 'pino';

/**
 * Structured JSON logger for the whole server.
 *
 * Usage: `logger.error({ err, route, studentId }, 'check-in failed')` — pass
 * context as the first (object) argument, message second. JSON lines feed
 * straight into Vercel's log aggregation; no transport config needed there.
 *
 * Level via LOG_LEVEL (default `info`; `silent` under NODE_ENV=test so test
 * output stays readable).
 */

function defaultLevel() {
  if (process.env.LOG_LEVEL) return process.env.LOG_LEVEL;
  return process.env.NODE_ENV === 'test' ? 'silent' : 'info';
}

export const logger = pino({
  level: defaultLevel(),
  // Drop pid/hostname noise; serverless hosts attach their own instance metadata.
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  serializers: {
    err: pino.stdSerializers.err,
  },
});

/** Child logger with fixed bindings (e.g. `createLogger({ module: 'billing' })`). */
export function createLogger(bindings = {}) {
  return logger.child(bindings);
}

export default logger;
