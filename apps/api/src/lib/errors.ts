import type { Tier } from '@media/shared';

/**
 * Every failure the client is allowed to see goes through AppError. Anything
 * else reaching the error handler is treated as an unexpected 500 and its
 * message is withheld — internal detail must not leak through the API surface.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requiredTier?: Tier;
  readonly retryAfterSeconds?: number;
  readonly details?: unknown;
  readonly expose = true;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { requiredTier?: Tier; retryAfterSeconds?: number; details?: unknown; cause?: unknown } = {},
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (options.requiredTier) this.requiredTier = options.requiredTier;
    if (options.retryAfterSeconds != null) this.retryAfterSeconds = options.retryAfterSeconds;
    if (options.details !== undefined) this.details = options.details;
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(400, 'BAD_REQUEST', message, { details });
  }
  static unauthorized(message = 'Authentication required'): AppError {
    return new AppError(401, 'UNAUTHORIZED', message);
  }
  static forbidden(message: string, requiredTier?: Tier): AppError {
    return new AppError(403, 'FORBIDDEN', message, { requiredTier });
  }
  static notFound(message = 'Resource not found'): AppError {
    return new AppError(404, 'NOT_FOUND', message);
  }
  static conflict(message: string): AppError {
    return new AppError(409, 'CONFLICT', message);
  }
  static payloadTooLarge(message: string, requiredTier?: Tier): AppError {
    return new AppError(413, 'PAYLOAD_TOO_LARGE', message, { requiredTier });
  }
  static tooManyRequests(message: string, retryAfterSeconds: number, requiredTier?: Tier): AppError {
    return new AppError(429, 'TOO_MANY_REQUESTS', message, { retryAfterSeconds, requiredTier });
  }
  static unprocessable(message: string, details?: unknown): AppError {
    return new AppError(422, 'UNPROCESSABLE', message, { details });
  }
  static upstream(message: string, details?: unknown): AppError {
    return new AppError(502, 'UPSTREAM_FAILED', message, { details });
  }
  static unavailable(message: string): AppError {
    return new AppError(503, 'SERVICE_UNAVAILABLE', message);
  }
  static timeout(message: string): AppError {
    return new AppError(504, 'TIMEOUT', message);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
