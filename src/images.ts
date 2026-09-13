import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { CodexError, type Image } from './types.js';
const MAX_BYTES = 20 * 1024 * 1024;
export async function decodeImage(item: Record<string, any>, allowedRoots: string[]): Promise<Image> {
  if (item.status !== 'completed' || item.failure) throw new CodexError('Native image generation failed', 'IMAGE_FAILED');
  let bytes: Buffer;
  if (typeof item.result === 'string' && item.result.length > 0) {
    const encoded = item.result.replace(/^data:image\/(png|jpeg|webp);base64,/, '');
    if (encoded.length > Math.ceil(MAX_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new CodexError('Invalid image data', 'INVALID_IMAGE');
    bytes = Buffer.from(encoded, 'base64');
  } else {
    if (typeof item.savedPath !== 'string' || !path.isAbsolute(item.savedPath)) throw new CodexError('No native image data', 'INVALID_IMAGE');
    const file = await realpath(item.savedPath);
    const roots = await Promise.all(allowedRoots.map(root => realpath(root).catch(() => '')));
    if (!roots.some(root => { const relative = path.relative(root, file); return root && relative && !relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative); })) throw new CodexError('Image is outside allowed roots', 'IMAGE_PATH_DENIED');
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > MAX_BYTES) throw new CodexError('Image exceeds limit', 'INVALID_IMAGE');
      bytes = Buffer.alloc(stat.size);
      const read = await handle.read(bytes, 0, bytes.length, 0);
      if (read.bytesRead !== stat.size) throw new CodexError('Incomplete image file', 'INVALID_IMAGE');
    } finally { await handle.close(); }
  }
  if (!bytes.length || bytes.length > MAX_BYTES) throw new CodexError('Invalid image size', 'INVALID_IMAGE');
  const mimeType = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png'
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? 'image/jpeg'
    : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP' ? 'image/webp' : null;
  if (!mimeType) throw new CodexError('Unsupported image format', 'INVALID_IMAGE');
  return { itemId: item.id, mimeType, dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}` };
}
