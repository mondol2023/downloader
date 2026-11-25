import { renderHtml, type JSONContent } from '@media/rich-text';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';

/** Where `<img src>` is allowed to point; everything else is dropped by the sanitiser. */
export function assetOrigin(): string {
  return (env.CMS_ASSET_ORIGIN ?? `${env.API_PUBLIC_URL}/api/v1/cms/assets`).replace(/\/+$/, '');
}

/** A Tiptap document. Node shapes are checked by the schema inside `renderHtml`. */
export const docSchema = z.object({ type: z.literal('doc'), content: z.array(z.unknown()).optional() }).passthrough();

/** Tiptap JSON → sanitised HTML. The editor never sends HTML; HTML only ever comes out of here. */
export function renderDoc(doc: unknown): string {
  const parsed = docSchema.parse(doc);
  try {
    return renderHtml(parsed as JSONContent, { assetOrigin: assetOrigin() });
  } catch {
    throw AppError.unprocessable('contentJson is not a valid document');
  }
}
