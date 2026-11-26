import pino from 'pino';
import { env, isDev } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  // Never let a token or password reach the log sink.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-birthdate"]',
      'res.headers["set-cookie"]',
      'password',
      'passwordHash',
      '*.password',
      '*.token',
      '*.refreshToken',
      '*.accessToken',
      'body.password',
    ],
    censor: '[redacted]',
  },
  transport: isDev
    ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } }
    : undefined,
});

export type Logger = typeof logger;
