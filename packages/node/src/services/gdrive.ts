/**
 * Google Drive download service using gdown.
 * Downloads files from public Google Drive links.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createLogger } from '@chiba/shared';
import type { Content, ContentMetadata } from '@chiba/shared';
import { getDatabase, generateId } from '../db/index.js';
import { getMediaDir, detectContentType } from './content-cache.js';

const logger = createLogger('node', 'gdrive');

/**
 * Check if a URL is a Google Drive URL.
 */
export function isGoogleDriveUrl(url: string): boolean {
  return /^https?:\/\/(drive|docs)\.google\.com\//.test(url);
}

/**
 * Extract FILE_ID from various Google Drive URL formats.
 * Returns null if URL is not a valid Google Drive file URL.
 *
 * Supported formats:
 * - https://drive.google.com/file/d/FILE_ID/view?usp=sharing
 * - https://drive.google.com/file/d/FILE_ID/view
 * - https://drive.google.com/file/d/FILE_ID/preview
 * - https://drive.google.com/file/d/FILE_ID/edit
 * - https://drive.google.com/uc?id=FILE_ID
 * - https://drive.google.com/uc?export=download&id=FILE_ID
 * - https://drive.google.com/open?id=FILE_ID
 * - https://docs.google.com/file/d/FILE_ID/...
 */
export function parseGoogleDriveFileId(url: string): string | null {
  // Pattern 1: /file/d/FILE_ID/...
  const fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch && fileMatch[1]) return fileMatch[1];

  // Pattern 2: ?id=FILE_ID or &id=FILE_ID
  const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (idMatch && idMatch[1]) return idMatch[1];

  return null;
}

export interface GDriveResult {
  content: Content;
  alreadyCached: boolean;
}

export interface GDriveProgress {
  hash: string;
  progress: number;
  status: 'downloading' | 'processing' | 'complete' | 'error';
  message?: string;
}

export type GDriveProgressCallback = (progress: GDriveProgress) => void;

/**
 * Download a file from Google Drive using gdown.
 * Files are cached by FILE_ID hash to avoid re-downloads.
 */
export async function downloadGoogleDrive(
  url: string,
  options?: { metadata?: ContentMetadata; name?: string; onProgress?: GDriveProgressCallback }
): Promise<GDriveResult> {
  const { metadata, name, onProgress } = options || {};
  return new Promise(async (resolve, reject) => {
    const mediaDir = getMediaDir();

    // Extract file ID from URL
    const fileId = parseGoogleDriveFileId(url);
    if (!fileId) {
      const error = new Error('Could not extract file ID from Google Drive URL');
      onProgress?.({
        hash: '',
        progress: 0,
        status: 'error',
        message: error.message,
      });
      reject(error);
      return;
    }

    // Generate hash from file ID for consistent naming across URL formats
    const fileIdHash = crypto.createHash('md5').update(fileId).digest('hex');

    logger.info('Starting Google Drive download', { url, fileId, hash: fileIdHash });

    // Check if already cached
    const existingFiles = fs.readdirSync(mediaDir).filter(f => f.startsWith(fileIdHash));
    if (existingFiles.length > 0) {
      const filename = existingFiles[0];
      if (!filename) {
        reject(new Error('Unexpected empty filename'));
        return;
      }
      logger.info('Google Drive file already cached', { filename });

      // Get from database or create entry
      const db = getDatabase();
      const row = db.prepare('SELECT * FROM cached_content WHERE hash = ?').get(fileIdHash) as {
        hash: string;
        filename: string;
        name: string | null;
        content_type: string;
        size_bytes: number;
        metadata: string | null;
        cached_at: number;
      } | undefined;

      if (row) {
        resolve({
          content: {
            id: row.hash,
            hash: row.hash,
            filename: row.filename,
            name: row.name ?? undefined,
            originalUrl: url,
            source: { type: 'gdrive', url, fileId },
            type: row.content_type as 'video' | 'image',
            sizeBytes: row.size_bytes,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
            createdAt: row.cached_at,
          },
          alreadyCached: true,
        });
      } else {
        // File exists but not in DB - add it
        const filePath = path.join(mediaDir, filename);
        const stats = fs.statSync(filePath);
        const contentType = detectContentTypeFromFile(filePath);
        if (!contentType) {
          reject(new Error('Cached file has unknown content type'));
          return;
        }
        const content: Content = {
          id: generateId(),
          hash: fileIdHash,
          filename,
          name,
          originalUrl: url,
          source: { type: 'gdrive', url, fileId },
          type: contentType,
          sizeBytes: stats.size,
          metadata,
          createdAt: Date.now(),
        };

        db.prepare(`
          INSERT INTO cached_content (hash, filename, name, original_url, source_type, source_data, content_type, size_bytes, metadata, cached_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          content.hash,
          content.filename,
          content.name ?? null,
          url,
          'gdrive',
          JSON.stringify({ type: 'gdrive', url, fileId }),
          contentType,
          content.sizeBytes,
          metadata ? JSON.stringify(metadata) : null,
          content.createdAt
        );

        resolve({ content, alreadyCached: true });
      }
      return;
    }

    onProgress?.({
      hash: fileIdHash,
      progress: 0,
      status: 'downloading',
      message: 'Starting download...',
    });

    // Download to a temp file first, then rename based on detected type
    const tempFilename = `_temp_${fileIdHash}`;
    const tempPath = path.join(mediaDir, tempFilename);

    // gdown arguments: --fuzzy handles large file confirmations
    const args = [
      '--fuzzy',
      '-O', tempPath,
      url
    ];

    logger.info('Spawning gdown', { args: args.join(' '), tempPath });
    const gdown = spawn('gdown', args);
    logger.info('gdown process spawned', { pid: gdown.pid, hash: fileIdHash });

    let stderr = '';
    let lastProgress = 0;
    let lastLogTime = Date.now();

    // gdown outputs progress to stderr
    gdown.stderr.on('data', (data) => {
      const output = data.toString();
      stderr += output;
      const now = Date.now();

      // Log periodically (every 5 seconds) or if it's not progress
      if (now - lastLogTime > 5000 || !output.includes('%')) {
        logger.debug('gdown stderr', { hash: fileIdHash, output: output.slice(0, 300) });
        lastLogTime = now;
      }

      // Parse progress: gdown outputs "XX%|" or "XX.X%" in progress bar
      const percentMatch = output.match(/(\d+(?:\.\d+)?)\s*%/);
      if (percentMatch && percentMatch[1]) {
        const progress = parseFloat(percentMatch[1]);
        if (progress !== lastProgress) {
          lastProgress = progress;
          logger.debug('Google Drive progress', { hash: fileIdHash, progress });
          onProgress?.({
            hash: fileIdHash,
            progress,
            status: 'downloading',
            message: `Downloading: ${progress.toFixed(1)}%`,
          });
        }
      }
    });

    gdown.stdout.on('data', (data) => {
      const output = data.toString();
      logger.debug('gdown stdout', { hash: fileIdHash, output: output.slice(0, 300) });
    });

    gdown.on('close', (code) => {
      logger.info('gdown process closed', { pid: gdown.pid, code, hash: fileIdHash, stderrLen: stderr.length });

      if (code !== 0) {
        // Clean up temp file if exists
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }

        // Parse common error messages
        let errorMsg = 'Download failed';
        if (stderr.includes('Access denied') || stderr.includes('Permission denied')) {
          errorMsg = 'Access denied - file may be private or restricted';
        } else if (stderr.includes('quota') || stderr.includes('Too many')) {
          errorMsg = 'Download quota exceeded - try again later';
        } else if (stderr.includes('not found') || stderr.includes('404')) {
          errorMsg = 'File not found - check the URL';
        } else if (stderr) {
          errorMsg = stderr.slice(0, 200);
        }

        logger.error('gdown failed', new Error(errorMsg), { url, stderr: stderr.slice(0, 500) });
        onProgress?.({
          hash: fileIdHash,
          progress: 0,
          status: 'error',
          message: errorMsg,
        });
        reject(new Error(`gdown failed: ${errorMsg}`));
        return;
      }

      // Verify temp file exists
      if (!fs.existsSync(tempPath)) {
        reject(new Error('Download completed but file not found'));
        return;
      }

      // Detect content type from file
      const contentType = detectContentTypeFromFile(tempPath);
      if (!contentType) {
        fs.unlinkSync(tempPath);
        const error = new Error('Downloaded file is not a valid video or image');
        onProgress?.({
          hash: fileIdHash,
          progress: 0,
          status: 'error',
          message: error.message,
        });
        reject(error);
        return;
      }

      // Determine extension based on content type and magic bytes
      const ext = getExtensionFromFile(tempPath, contentType);
      const filename = `${fileIdHash}${ext}`;
      const finalPath = path.join(mediaDir, filename);

      // Rename temp file to final filename
      fs.renameSync(tempPath, finalPath);

      const stats = fs.statSync(finalPath);

      const content: Content = {
        id: generateId(),
        hash: fileIdHash,
        filename,
        name,
        originalUrl: url,
        source: { type: 'gdrive', url, fileId },
        type: contentType,
        sizeBytes: stats.size,
        metadata,
        createdAt: Date.now(),
      };

      // Save to database
      const db = getDatabase();
      db.prepare(`
        INSERT INTO cached_content (hash, filename, name, original_url, source_type, source_data, content_type, size_bytes, metadata, cached_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        content.hash,
        content.filename,
        content.name ?? null,
        url,
        'gdrive',
        JSON.stringify({ type: 'gdrive', url, fileId }),
        contentType,
        content.sizeBytes,
        metadata ? JSON.stringify(metadata) : null,
        content.createdAt
      );

      logger.info('Google Drive file cached', { filename, hash: fileIdHash, size: stats.size });
      onProgress?.({
        hash: fileIdHash,
        progress: 100,
        status: 'complete',
        message: 'Download complete',
      });

      resolve({ content, alreadyCached: false });
    });

    gdown.on('error', (err) => {
      // Clean up temp file if exists
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }

      logger.error('Failed to start gdown', err);
      onProgress?.({
        hash: fileIdHash,
        progress: 0,
        status: 'error',
        message: `Failed to start gdown: ${err.message}. Is gdown installed? (pip install gdown)`,
      });
      reject(new Error(`Failed to start gdown: ${err.message}. Is gdown installed? (pip install gdown)`));
    });
  });
}

/**
 * Detect content type from file using magic bytes.
 */
function detectContentTypeFromFile(filePath: string): 'video' | 'image' | null {
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(12);
  fs.readSync(fd, buffer, 0, 12, 0);
  fs.closeSync(fd);

  return detectContentType(buffer);
}

/**
 * Get file extension based on magic bytes.
 */
function getExtensionFromFile(filePath: string, contentType: 'video' | 'image'): string {
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(12);
  fs.readSync(fd, buffer, 0, 12, 0);
  fs.closeSync(fd);

  // Video signatures
  if (contentType === 'video') {
    // MP4/MOV: starts with ftyp
    if (buffer.slice(4, 8).toString() === 'ftyp') {
      const brand = buffer.slice(8, 12).toString();
      if (brand.startsWith('qt')) return '.mov';
      return '.mp4';
    }
    // WebM/MKV
    if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
      return '.webm';
    }
    // AVI
    if (buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'AVI ') {
      return '.avi';
    }
    return '.mp4'; // Default video extension
  }

  // Image signatures
  if (contentType === 'image') {
    // JPEG
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return '.jpg';
    }
    // PNG
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
      return '.png';
    }
    // GIF
    if (buffer.slice(0, 6).toString() === 'GIF87a' || buffer.slice(0, 6).toString() === 'GIF89a') {
      return '.gif';
    }
    // WebP
    if (buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WEBP') {
      return '.webp';
    }
    // BMP
    if (buffer[0] === 0x42 && buffer[1] === 0x4d) {
      return '.bmp';
    }
    return '.jpg'; // Default image extension
  }

  return '.bin';
}
