/**
 * Content caching service for Chiba node.
 * Downloads and caches content with MD5 hash-based naming for deduplication.
 */

import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createLogger, MEDIA_DIR, VIDEO_EXTENSIONS, IMAGE_EXTENSIONS } from '@chiba/shared';
import type { Content, ContentType, ContentSource, ContentMetadata } from '@chiba/shared';
import { getDatabase, generateId } from '../db/index.js';

const logger = createLogger('node', 'cache');

/**
 * Callback invoked when new content is cached.
 * Used to notify controller about new content in the library.
 */
type ContentCachedCallback = (content: Content) => void;
let contentCachedCallback: ContentCachedCallback | null = null;

/**
 * Set callback for when new content is cached.
 * @param callback Function to call with the newly cached content
 */
export function setContentCachedCallback(callback: ContentCachedCallback | null): void {
  contentCachedCallback = callback;
}

/**
 * Notify about newly cached content. Called by other services (e.g., eden.ts)
 * after they cache content directly.
 */
export function notifyContentCached(content: Content): void {
  if (contentCachedCallback) {
    try {
      contentCachedCallback(content);
    } catch (err) {
      logger.error('Content cached callback error', err as Error);
    }
  }
}

/**
 * Video magic byte signatures for validation.
 */
const VIDEO_SIGNATURES = [
  // MP4/M4V (ftyp at offset 4)
  { bytes: [0x00, 0x00, 0x00], offset: 0, check: (buf: Buffer) => buf.length > 11 && buf.toString('ascii', 4, 8) === 'ftyp' },
  // WebM/MKV
  { bytes: [0x1A, 0x45, 0xDF, 0xA3], offset: 0 },
  // MOV variants
  { bytes: [0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70], offset: 0 },
  { bytes: [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70], offset: 0 },
  // AVI
  { bytes: [0x52, 0x49, 0x46, 0x46], offset: 0, check: (buf: Buffer) => buf.length > 11 && buf.toString('ascii', 8, 11) === 'AVI' },
];

/**
 * Image magic byte signatures.
 */
const IMAGE_SIGNATURES = [
  // JPEG
  { bytes: [0xFF, 0xD8, 0xFF], offset: 0 },
  // PNG
  { bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], offset: 0 },
  // GIF
  { bytes: [0x47, 0x49, 0x46, 0x38], offset: 0 },
  // WebP
  { bytes: [0x52, 0x49, 0x46, 0x46], offset: 0, check: (buf: Buffer) => buf.length > 11 && buf.toString('ascii', 8, 12) === 'WEBP' },
  // BMP
  { bytes: [0x42, 0x4D], offset: 0 },
];

interface SignatureCheck {
  bytes: number[];
  offset: number;
  check?: (buf: Buffer) => boolean;
}

/**
 * Check if buffer matches any signature in the list.
 */
function matchesSignature(buffer: Buffer, signatures: SignatureCheck[]): boolean {
  for (const sig of signatures) {
    if (sig.check) {
      if (sig.check(buffer)) return true;
    } else {
      let match = true;
      for (let i = 0; i < sig.bytes.length; i++) {
        if (buffer[sig.offset + i] !== sig.bytes[i]) {
          match = false;
          break;
        }
      }
      if (match) return true;
    }
  }
  return false;
}

/**
 * Check if buffer is a video file based on magic bytes.
 */
export function isVideoFile(buffer: Buffer): boolean {
  return matchesSignature(buffer, VIDEO_SIGNATURES);
}

/**
 * Check if buffer is an image file based on magic bytes.
 */
export function isImageFile(buffer: Buffer): boolean {
  return matchesSignature(buffer, IMAGE_SIGNATURES);
}

/**
 * Detect content type from buffer.
 */
export function detectContentType(buffer: Buffer): ContentType | null {
  if (isVideoFile(buffer)) return 'video';
  if (isImageFile(buffer)) return 'image';
  return null;
}

/**
 * Get the media directory path.
 */
export function getMediaDir(): string {
  const mediaDir = process.env.MEDIA_DIR ?? path.join(process.cwd(), MEDIA_DIR);
  if (!fs.existsSync(mediaDir)) {
    fs.mkdirSync(mediaDir, { recursive: true });
    logger.info('Created media directory', { path: mediaDir });
  }
  return mediaDir;
}

/**
 * Get extension from URL or default based on content type.
 */
function getExtensionFromUrl(url: string, contentType: ContentType): string {
  const urlPath = new URL(url).pathname;
  let ext = path.extname(urlPath).toLowerCase();

  const validExts = contentType === 'video'
    ? VIDEO_EXTENSIONS as unknown as string[]
    : IMAGE_EXTENSIONS as unknown as string[];

  if (!validExts.includes(ext)) {
    ext = contentType === 'video' ? '.mp4' : '.jpg';
  }

  return ext;
}

/**
 * Get content by filename (extracts hash from filename like "abc123.mp4").
 */
export function getContentByFilename(filename: string): Content | null {
  // Extract hash from filename (format: {hash}.{ext})
  const hash = filename.split('.')[0];
  if (!hash) return null;
  return getExistingContent(hash);
}

/**
 * Check if content with this original URL already exists.
 * Used to avoid re-downloading the same URL.
 */
export function getContentByOriginalUrl(url: string): Content | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM cached_content WHERE original_url = ?
  `).get(url) as {
    hash: string;
    filename: string;
    name: string | null;
    original_url: string | null;
    source_type: string;
    source_data: string | null;
    content_type: string;
    size_bytes: number;
    duration: number | null;
    width: number | null;
    height: number | null;
    metadata: string | null;
    cached_at: number;
    last_played_at: number | null;
  } | undefined;

  if (!row) return null;

  const source: ContentSource = JSON.parse(row.source_data ?? '{}');

  return {
    id: row.hash,
    hash: row.hash,
    filename: row.filename,
    name: row.name ?? undefined,
    originalUrl: row.original_url ?? undefined,
    source,
    type: row.content_type as ContentType,
    sizeBytes: row.size_bytes,
    duration: row.duration ?? undefined,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.cached_at,
    lastPlayedAt: row.last_played_at ?? undefined,
  };
}

/**
 * Check if content with this hash already exists.
 */
export function getExistingContent(hash: string): Content | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM cached_content WHERE hash = ?
  `).get(hash) as {
    hash: string;
    filename: string;
    name: string | null;
    original_url: string | null;
    source_type: string;
    source_data: string | null;
    content_type: string;
    size_bytes: number;
    duration: number | null;
    width: number | null;
    height: number | null;
    metadata: string | null;
    cached_at: number;
    last_played_at: number | null;
  } | undefined;

  if (!row) return null;

  const source: ContentSource = JSON.parse(row.source_data ?? '{}');

  return {
    id: row.hash,
    hash: row.hash,
    filename: row.filename,
    name: row.name ?? undefined,
    originalUrl: row.original_url ?? undefined,
    source,
    type: row.content_type as ContentType,
    sizeBytes: row.size_bytes,
    duration: row.duration ?? undefined,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.cached_at,
    lastPlayedAt: row.last_played_at ?? undefined,
  };
}

/**
 * Save content metadata to database and notify callback.
 */
function saveContent(content: Content, isNew = true): void {
  const db = getDatabase();
  db.prepare(`
    INSERT OR REPLACE INTO cached_content (
      hash, filename, name, original_url, source_type, source_data,
      content_type, size_bytes, duration, width, height, metadata, cached_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    content.hash,
    content.filename,
    content.name ?? null,
    content.originalUrl ?? null,
    content.source.type,
    JSON.stringify(content.source),
    content.type,
    content.sizeBytes,
    content.duration ?? null,
    content.width ?? null,
    content.height ?? null,
    content.metadata ? JSON.stringify(content.metadata) : null,
    content.createdAt
  );

  // Notify callback for new content (not already cached)
  if (isNew && contentCachedCallback) {
    try {
      contentCachedCallback(content);
    } catch (err) {
      logger.error('Content cached callback error', err as Error);
    }
  }
}

export interface CacheResult {
  content: Content;
  alreadyCached: boolean;
}

export interface DownloadProgress {
  hash: string;
  progress: number;
  downloadedBytes: number;
  totalBytes?: number;
}

export type ProgressCallback = (progress: DownloadProgress) => void;

/**
 * Download and cache content from a URL.
 * Returns the cached content with MD5 hash-based filename.
 */
export async function downloadAndCache(
  url: string,
  options?: { metadata?: ContentMetadata; name?: string; onProgress?: ProgressCallback }
): Promise<CacheResult> {
  const { metadata, name, onProgress } = options || {};

  // Check if URL is already cached before downloading
  const existingByUrl = getContentByOriginalUrl(url);
  if (existingByUrl) {
    const mediaDir = getMediaDir();
    const filePath = path.join(mediaDir, existingByUrl.filename);
    if (fs.existsSync(filePath)) {
      logger.info('URL already cached, skipping download', { url, filename: existingByUrl.filename });
      return { content: existingByUrl, alreadyCached: true };
    }
  }

  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const mediaDir = getMediaDir();

    logger.info('Starting download', { url });
    const done = logger.time('Download', { url });

    // Temp file while downloading
    const tempPath = path.join(mediaDir, `_temp_${Date.now()}`);
    const fileStream = fs.createWriteStream(tempPath);
    const hash = crypto.createHash('md5');

    const request = protocol.get(url, {
      headers: { 'User-Agent': 'Chiba/2.0' },
      timeout: 60000
    }, (response) => {
      // Handle redirects
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        fileStream.close();
        fs.unlinkSync(tempPath);
        logger.debug('Following redirect', { location: response.headers.location });
        downloadAndCache(response.headers.location, { metadata, name, onProgress }).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        fileStream.close();
        fs.unlinkSync(tempPath);
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const totalBytes = parseInt(response.headers['content-length'] ?? '0', 10);
      let downloadedBytes = 0;
      let contentType: ContentType | null = null;
      let headerChecked = false;

      response.on('data', (chunk: Buffer) => {
        // Validate content type from first chunk
        if (!headerChecked) {
          headerChecked = true;
          contentType = detectContentType(chunk);
          if (!contentType) {
            logger.warn('Unknown content type', { url });
            response.destroy();
            fileStream.close();
            fs.unlink(tempPath, () => {});
            reject(new Error('Unknown content type - not a valid video or image'));
            return;
          }
        }

        hash.update(chunk);
        fileStream.write(chunk);
        downloadedBytes += chunk.length;

        if (onProgress && contentType) {
          onProgress({
            hash: '', // Not known yet
            progress: totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0,
            downloadedBytes,
            totalBytes: totalBytes || undefined,
          });
        }
      });

      response.on('end', () => {
        fileStream.end(() => {
          if (!contentType) {
            fs.unlink(tempPath, () => {});
            reject(new Error('Content type not detected'));
            return;
          }

          const md5 = hash.digest('hex');
          const ext = getExtensionFromUrl(url, contentType);
          const filename = `${md5}${ext}`;
          const finalPath = path.join(mediaDir, filename);

          // Check if already cached
          const existing = getExistingContent(md5);
          if (existing && fs.existsSync(finalPath)) {
            fs.unlinkSync(tempPath);
            done();
            logger.info('Already cached', { filename, hash: md5 });
            resolve({ content: existing, alreadyCached: true });
            return;
          }

          // Get file size
          const stats = fs.statSync(tempPath);

          // Rename temp file to final
          fs.rename(tempPath, finalPath, (err) => {
            if (err) {
              fs.unlink(tempPath, () => {});
              reject(err);
              return;
            }

            // We already checked contentType above, so we know it's not null
            const finalType = contentType!;

            const content: Content = {
              id: generateId(),
              hash: md5,
              filename,
              name,
              originalUrl: url,
              source: { type: 'url', url },
              type: finalType,
              sizeBytes: stats.size,
              metadata,
              createdAt: Date.now(),
            };

            saveContent(content);
            done();
            logger.info('Cached', { filename, hash: md5, size: stats.size });
            resolve({ content, alreadyCached: false });
          });
        });
      });

      response.on('error', (err) => {
        fileStream.close();
        fs.unlink(tempPath, () => {});
        reject(err);
      });
    });

    request.on('error', (err) => {
      fileStream.close();
      fs.unlink(tempPath, () => {});
      reject(err);
    });

    request.on('timeout', () => {
      request.destroy();
      fileStream.close();
      fs.unlink(tempPath, () => {});
      reject(new Error('Download timeout'));
    });
  });
}

/**
 * List all cached content.
 */
export function listCachedContent(): Content[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM cached_content ORDER BY cached_at DESC
  `).all() as Array<{
    hash: string;
    filename: string;
    name: string | null;
    original_url: string | null;
    source_type: string;
    source_data: string | null;
    content_type: string;
    size_bytes: number;
    duration: number | null;
    width: number | null;
    height: number | null;
    metadata: string | null;
    cached_at: number;
    last_played_at: number | null;
  }>;

  return rows.map(row => ({
    id: row.hash,
    hash: row.hash,
    filename: row.filename,
    name: row.name ?? undefined,
    originalUrl: row.original_url ?? undefined,
    source: JSON.parse(row.source_data ?? '{}'),
    type: row.content_type as ContentType,
    sizeBytes: row.size_bytes,
    duration: row.duration ?? undefined,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.cached_at,
    lastPlayedAt: row.last_played_at ?? undefined,
  }));
}

/**
 * Get total size of cached content.
 */
export function getCacheSize(): number {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT COALESCE(SUM(size_bytes), 0) as total FROM cached_content
  `).get() as { total: number };
  return row.total;
}

/**
 * Delete cached content by hash.
 */
export function deleteContent(hash: string): boolean {
  const db = getDatabase();
  const content = getExistingContent(hash);
  if (!content) return false;

  const mediaDir = getMediaDir();
  const filePath = path.join(mediaDir, content.filename);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  db.prepare('DELETE FROM cached_content WHERE hash = ?').run(hash);
  logger.info('Deleted content', { hash, filename: content.filename });
  return true;
}

/**
 * Update last played timestamp.
 */
export function markAsPlayed(hash: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE cached_content SET last_played_at = ? WHERE hash = ?
  `).run(Date.now(), hash);
}

/**
 * Clear all cached content - deletes all files and database entries.
 */
export function clearAllCache(): { deletedCount: number; freedBytes: number } {
  const db = getDatabase();
  const mediaDir = getMediaDir();

  // Get all cached content for stats
  const content = listCachedContent();
  const freedBytes = content.reduce((sum, c) => sum + c.sizeBytes, 0);

  // Delete all files
  let deletedCount = 0;
  for (const item of content) {
    const filePath = path.join(mediaDir, item.filename);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        deletedCount++;
      }
    } catch (err) {
      logger.warn('Failed to delete file', { filename: item.filename, error: (err as Error).message });
    }
  }

  // Clear database
  db.prepare('DELETE FROM cached_content').run();

  logger.info('Cleared all cache', { deletedCount, freedBytes });
  return { deletedCount, freedBytes };
}
