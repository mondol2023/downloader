import type { Tier } from '@media/shared';

/** Identity resolved by `attachIdentity`, present on every request. */
export interface RequestIdentity {
  /** Authenticated user id, or null for anonymous callers. */
  userId: string | null;
  /** Stable anonymous id from the guest cookie. Always present. */
  guestKey: string;
  /** Quota/rate-limit subject: `user:<id>` or `guest:<uuid>`. */
  subject: string;
  tier: Tier;
  email: string | null;
  /** Coarse IP identity used as a secondary anti-abuse key for guests. */
  ipHash: string;
}

declare global {
  namespace Express {
    interface Request {
      identity: RequestIdentity;
      requestId: string;
      /** Set by `requireRole` after reading the role from the database. */
      adminRole?: import('@prisma/client').Role;
    }
  }
}

export {};
