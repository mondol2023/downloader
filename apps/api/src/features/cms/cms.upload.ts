import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RequestHandler } from 'express';
import multer from 'multer';
import sharp, { type OutputInfo } from 'sharp';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';

export type ImageKind = 'png' | 'jpeg' | 'webp' | 'gif' | 'avif';

export const assetDir = () => path.resolve(env.STORAGE_DIR, 'cms');

/** The bytes decide, never the filename or the client's Content-Type. */
export function detectImage(b: Buffer): ImageKind | null {
  if (b.length < 12) return null;
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  const head = b.subarray(0, 6).toString('latin1');
  if (head === 'GIF87a' || head === 'GIF89a') return 'gif';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (b.subarray(4, 8).toString('latin1') === 'ftyp' && ['avif', 'avis'].includes(b.subarray(8, 12).toString('latin1'))) return 'avif';
  return null;
}

export interface StoredImage {
  key: string;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
}

/** Re-encodes (which drops EXIF and anything appended to the file) and writes under STORAGE_DIR/cms. */
export async function storeImage(input: Buffer): Promise<StoredImage> {
  const kind = detectImage(input);
  if (!kind) throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Only PNG, JPEG, WebP, GIF and AVIF images are accepted');
  const isGif = kind === 'gif';
  let out: { data: Buffer; info: OutputInfo };
  try {
    const img = sharp(input, { animated: isGif, failOn: 'error' }).rotate();
    out = await (isGif ? img.gif() : img.webp({ quality: 82 })).toBuffer({ resolveWithObject: true });
  } catch {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'That file is not a valid image');
  }
  const ext = isGif ? 'gif' : 'webp';
  const key = `${randomUUID()}.${ext}`;
  await mkdir(assetDir(), { recursive: true });
  await writeFile(path.join(assetDir(), key), out.data);
  return {
    key,
    mime: isGif ? 'image/gif' : 'image/webp',
    bytes: out.data.length,
    width: out.info.width ?? null,
    // Animated GIFs report every frame stacked in `height`; `pageHeight` is one frame.
    height: out.info.pageHeight ?? out.info.height ?? null,
  };
}

/** Multipart parser for one `file` field, held in memory (capped) so nothing unchecked touches disk. */
export const parseUpload: RequestHandler = (req, res, next) => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: Math.floor(env.CMS_MAX_UPLOAD_MB * 1024 * 1024), files: 1, fields: 5 },
  }).single('file');
  upload(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return next(AppError.payloadTooLarge(`Images may be at most ${env.CMS_MAX_UPLOAD_MB} MB`));
    }
    return next(AppError.badRequest('Invalid upload'));
  });
};
