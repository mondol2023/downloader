import { INELIGIBLE_COPY, type IneligibleCode } from '@media/shared';
import { AppError } from '../../lib/errors.js';

/** The typed error for an eligibility refusal. Geoblocks are 451, everything else 403. */
export function refusalError(code: IneligibleCode): AppError {
  return new AppError(code === 'SOURCE_GEOBLOCKED' ? 451 : 403, code, INELIGIBLE_COPY[code].body);
}
