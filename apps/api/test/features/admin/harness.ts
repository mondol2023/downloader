import type { AddressInfo } from 'node:net';
import express, { type ErrorRequestHandler, type Router } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../../../src/lib/errors.js';
import { auditMutations } from '../../../src/features/admin/audit.js';

/**
 * Mounts one admin router the way adminRouter does (identity → audit → router) without the
 * role guard, which require-role.test.ts covers. `x-user` stands in for the JWT identity.
 */
export function makeApp(router: Router) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { identity: unknown }).identity = { userId: req.header('x-user') ?? 'admin' };
    next();
  });
  app.use(auditMutations);
  app.use('/', router);
  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof AppError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    } else if (err instanceof ZodError) {
      res.status(422).json({ error: { code: 'UNPROCESSABLE', details: err.issues } });
    } else {
      res.status(500).json({ error: { code: 'INTERNAL', message: String(err) } });
    }
  };
  app.use(onError);
  return app;
}

export interface Reply {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export async function call(
  router: Router,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  user?: string,
): Promise<Reply> {
  // fetch refuses a handful of ports (6000, 6665-6669, ...); a random listen(0) can land on one.
  for (let attempt = 0; ; attempt++) {
    const server = makeApp(router).listen(0);
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...(user ? { 'x-user': user } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      // The audit row is written on `finish`; give that microtask a turn.
      await new Promise((r) => setTimeout(r, 5));
      return { status: res.status, body: await res.json() };
    } catch (err) {
      if (attempt < 5 && String((err as Error).cause ?? err).includes('bad port')) continue;
      throw err;
    } finally {
      server.close();
    }
  }
}

/** Stand-ins for the modules every admin router reaches (env, logger, rate limit never mounted). */
export const envMock = { env: { REGION: 'test', NODE_ENV: 'test' }, isProd: false };
export const loggerMock = { logger: { warn: () => undefined, info: () => undefined, error: () => undefined } };
