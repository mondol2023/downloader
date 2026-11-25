import type { Request } from 'express';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';

export const PAGE_SIZE = 25;

/** `?cursor=` is the id of the last row of the previous page; `?limit=` is capped at 100. */
export const pageQuery = z.object({
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(PAGE_SIZE),
});

/** Prisma args for keyset pagination over a (createdAt desc, id desc) ordering: stable under inserts. */
export function pageArgs(page: { cursor?: string | undefined; limit: number }) {
  return {
    take: page.limit + 1,
    ...(page.cursor ? { cursor: { id: page.cursor }, skip: 1 } : {}),
  };
}

/** Trims the extra row fetched by `pageArgs` and derives `nextCursor`. */
export function toPage<T extends { id: string }>(rows: T[], limit: number): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null };
}

export function actorId(req: Request): string {
  const id = req.identity?.userId;
  if (!id) throw AppError.unauthorized();
  return id;
}
