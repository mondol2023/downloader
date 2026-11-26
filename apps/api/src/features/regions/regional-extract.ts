import { AppError } from '../../lib/errors.js';
import type { NormalisedSource } from '../../lib/source-url.js';
import type { ExtractionRecord } from '../../services/extraction.service.js';
import { pickRegionalQueue, type RegionCode, type RegionConfig } from './region.js';

export const REGIONAL_TIMEOUT_MS = 25_000;

export interface RegionalDeps {
  cfg: Pick<RegionConfig, 'REGION' | 'WORKER_REGIONS'>;
  /** Extraction in this deployment's own region. */
  local: () => Promise<ExtractionRecord>;
  /** Runs the extraction on the named regional queue and resolves with its record. */
  regional: (queue: string, source: NormalisedSource) => Promise<ExtractionRecord>;
  timeoutMs?: number;
}

/**
 * Extract locally; only when the source is geo-blocked here AND a worker exists in the user's OWN
 * region, retry there. Any other error, or no regional worker, is surfaced unchanged (451).
 */
export async function extractWithRegionalFallback(
  source: NormalisedSource,
  userRegion: RegionCode | null,
  deps: RegionalDeps,
): Promise<ExtractionRecord> {
  try {
    return await deps.local();
  } catch (err) {
    if (!(err instanceof AppError) || err.code !== 'SOURCE_GEOBLOCKED') throw err;
    const queue = pickRegionalQueue(userRegion, deps.cfg);
    if (!queue) throw err;

    const ms = deps.timeoutMs ?? REGIONAL_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new AppError(504, 'SOURCE_TIMEOUT', 'The regional extraction took too long.')),
        ms,
      );
    });
    try {
      return await Promise.race([deps.regional(queue, source), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
