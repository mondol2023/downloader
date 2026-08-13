/**
 * Subtitle normalisation.
 *
 * `<track>` in every browser accepts WebVTT and nothing else, while extractors
 * hand back SRT, TTML/DFXP and JSON3 depending on the platform. Converting here
 * keeps the player component free of format branching.
 */

export function toWebVtt(body: string, ext: string): string {
  const trimmed = body.replace(/^﻿/, '').trim();
  if (!trimmed) return 'WEBVTT\n\n';

  switch (ext.toLowerCase()) {
    case 'vtt':
      return trimmed.startsWith('WEBVTT') ? trimmed : `WEBVTT\n\n${trimmed}`;
    case 'srt':
      return srtToVtt(trimmed);
    case 'json3':
    case 'srv3':
    case 'json':
      return json3ToVtt(trimmed);
    case 'ttml':
    case 'dfxp':
    case 'xml':
      return ttmlToVtt(trimmed);
    default:
      // Unknown but probably cue-shaped; SRT conversion is the safest guess.
      return srtToVtt(trimmed);
  }
}

function srtToVtt(body: string): string {
  const converted = body
    .replace(/\r\n|\r/g, '\n')
    // SRT uses a comma before milliseconds, VTT a dot.
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
    // Drop the numeric counter lines; VTT cue ids are optional and free-form.
    .replace(/^\d+\n(?=\d{2}:\d{2}:\d{2}\.\d{3} -->)/gm, '');

  return `WEBVTT\n\n${converted}`;
}

function json3ToVtt(body: string): string {
  interface Json3Event {
    tStartMs?: number;
    dDurationMs?: number;
    segs?: Array<{ utf8?: string }>;
  }
  let events: Json3Event[];
  try {
    events = (JSON.parse(body) as { events?: Json3Event[] }).events ?? [];
  } catch {
    return 'WEBVTT\n\n';
  }

  const cues: string[] = [];
  for (const event of events) {
    const text = (event.segs ?? [])
      .map((seg) => seg.utf8 ?? '')
      .join('')
      .trim();
    if (!text || event.tStartMs == null) continue;
    const start = event.tStartMs;
    const end = start + (event.dDurationMs ?? 2000);
    cues.push(`${msToTimestamp(start)} --> ${msToTimestamp(end)}\n${text}`);
  }

  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

function ttmlToVtt(body: string): string {
  const cues: string[] = [];
  const pattern = /<p\b[^>]*\bbegin="([^"]+)"[^>]*\bend="([^"]+)"[^>]*>([\s\S]*?)<\/p>/gi;

  for (const match of body.matchAll(pattern)) {
    const [, begin, end, inner] = match;
    if (!begin || !end) continue;
    const text = (inner ?? '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;|&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .trim();
    if (!text) continue;
    cues.push(`${normaliseTtmlTime(begin)} --> ${normaliseTtmlTime(end)}\n${text}`);
  }

  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

function normaliseTtmlTime(value: string): string {
  // TTML allows "12.5s" as well as clock time.
  const seconds = /^([\d.]+)s$/.exec(value.trim());
  if (seconds?.[1]) return msToTimestamp(Number(seconds[1]) * 1000);

  const parts = value.trim().replace(',', '.').split(':');
  if (parts.length === 2) parts.unshift('00');
  const [h = '00', m = '00', s = '00'] = parts;
  const [sec = '00', frac = '000'] = s.split('.');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${sec.padStart(2, '0')}.${frac.padEnd(3, '0').slice(0, 3)}`;
}

function msToTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}
