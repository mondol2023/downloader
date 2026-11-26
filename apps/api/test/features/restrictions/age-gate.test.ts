import { describe, expect, it } from 'vitest';
import { ageOn, assertAdultConfirmed, parseBirthdate } from '../../../src/features/restrictions/age-gate.js';

const NOW = new Date('2026-11-26T12:00:00Z');

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected a throw');
}

describe('parseBirthdate', () => {
  it('accepts a real YYYY-MM-DD date and nothing else', () => {
    expect(parseBirthdate('2000-02-29', NOW)).toEqual({ year: 2000, month: 2, day: 29 });
    for (const bad of ['', '2000-2-9', '09/02/2000', '2001-02-29', '2000-13-01', '2000-00-10', '1899-12-31', ' 2000-01-01']) {
      expect(parseBirthdate(bad, NOW)).toBeNull();
    }
  });

  it('rejects a date in the future, accepts today', () => {
    expect(parseBirthdate('2026-11-27', NOW)).toBeNull();
    expect(parseBirthdate('2026-11-26', NOW)).not.toBeNull();
  });
});

describe('ageOn', () => {
  it('turns 18 on the birthday itself, not the day before', () => {
    expect(ageOn({ year: 2008, month: 11, day: 26 }, NOW)).toBe(18);
    expect(ageOn({ year: 2008, month: 11, day: 27 }, NOW)).toBe(17);
    expect(ageOn({ year: 2008, month: 12, day: 31 }, NOW)).toBe(17);
  });

  it('a Feb 29 birthday turns a year older on Mar 1 in a common year', () => {
    const born = { year: 2008, month: 2, day: 29 };
    expect(ageOn(born, new Date('2026-02-28T00:00:00Z'))).toBe(17);
    expect(ageOn(born, new Date('2026-03-01T00:00:00Z'))).toBe(18);
  });
});

describe('assertAdultConfirmed', () => {
  it('does nothing for media that is not 18+, whatever was sent', () => {
    expect(() => assertAdultConfirmed(0, undefined, NOW)).not.toThrow();
    expect(() => assertAdultConfirmed(17, 'garbage', NOW)).not.toThrow();
  });

  it('asks for a birthdate when 18+ media arrives without one', () => {
    for (const missing of [undefined, null, '']) {
      expect(thrown(() => assertAdultConfirmed(18, missing, NOW))).toMatchObject({
        status: 403,
        code: 'AGE_CONFIRMATION_REQUIRED',
      });
    }
  });

  it('refuses an unparseable birthdate as a bad request', () => {
    expect(thrown(() => assertAdultConfirmed(18, '26/11/2000', NOW))).toMatchObject({
      status: 400,
      code: 'INVALID_BIRTHDATE',
    });
  });

  it('refuses under 18 and passes 18 and over', () => {
    expect(thrown(() => assertAdultConfirmed(18, '2008-11-27', NOW))).toMatchObject({ status: 403, code: 'AGE_UNDER_18' });
    expect(() => assertAdultConfirmed(18, '2008-11-26', NOW)).not.toThrow();
    expect(() => assertAdultConfirmed(21, '1980-05-05', NOW)).not.toThrow();
  });

  it('never echoes the birthdate back in an error', () => {
    const err = thrown(() => assertAdultConfirmed(18, '2015-01-01', NOW)) as Error;
    expect(JSON.stringify(err)).not.toContain('2015');
    expect(err.message).not.toContain('2015');
  });
});
