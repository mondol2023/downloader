/** `GET /admin/stats` payload (last 24 h unless noted). */
export interface AdminStats {
  jobsToday: Record<string, number>;
  extractsByPlatform: Record<string, number>;
  refusalsByCode: Record<string, number>;
  queueDepth: { waiting: number; active: number; delayed: number; failed: number };
  health: { status: string; db: unknown; redis: unknown; tools: unknown; region: string };
  windowHours: number;
}
