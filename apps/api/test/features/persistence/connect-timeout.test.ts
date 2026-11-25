import { describe, expect, it } from 'vitest';
import { withConnectTimeout } from '../../../src/features/persistence/index.js';

describe('withConnectTimeout', () => {
  it('adds connect_timeout=5 when missing', () => {
    const url = withConnectTimeout('postgresql://media:media@localhost:5432/media_engine?schema=public');
    expect(new URL(url).searchParams.get('connect_timeout')).toBe('5');
    expect(new URL(url).searchParams.get('schema')).toBe('public');
  });

  it('adds it when there is no query string', () => {
    const url = withConnectTimeout('postgresql://media:media@localhost:5432/media_engine');
    expect(new URL(url).searchParams.get('connect_timeout')).toBe('5');
  });

  it('keeps an explicit value', () => {
    const url = withConnectTimeout('postgresql://u:p@h:5432/d?connect_timeout=30');
    expect(new URL(url).searchParams.get('connect_timeout')).toBe('30');
  });
});
