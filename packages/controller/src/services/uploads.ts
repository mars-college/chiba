/**
 * Upload handling service for Chiba controller.
 * Streams files to disk with MD5 hashing for deduplication.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import Busboy from 'busboy';
import { createLogger } from '@chiba/shared';

const logger = createLogger('controller', 'uploads');

// Uploads directory (relative to project root)
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? path.resolve(process.cwd(), 'uploads');

export interface UploadResult {
  hash: string;
  filename: string;
  originalName: string;
  contentType: 'video' | 'image';
  sizeBytes: number;
  mimeType: string;
  description?: string;
  author?: string;
}

// Allowed MIME types
const ALLOWED_MIME_TYPES: Record<string, 'video' | 'image'> = {
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/quicktime': 'video',
  'video/x-matroska': 'video',
  'video/x-msvideo': 'video',
  'video/x-m4v': 'video',
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
};

// Get extension from MIME type
function getExtensionFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'video/quicktime': '.mov',
    'video/x-matroska': '.mkv',
    'video/x-msvideo': '.avi',
    'video/x-m4v': '.m4v',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
  };
  return map[mimeType] || '.bin';
}

export function getUploadsDir(): string {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    logger.info('Created uploads directory', { path: UPLOADS_DIR });
  }
  return UPLOADS_DIR;
}

export function handleUpload(req: http.IncomingMessage): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'];
    if (!contentType?.startsWith('multipart/form-data')) {
      reject(new Error('Content-Type must be multipart/form-data'));
      return;
    }

    const uploadsDir = getUploadsDir();
    const busboy = Busboy({ headers: req.headers });

    let rejected = false;
    let nameFromField: string | null = null;
    let descriptionFromField: string | null = null;
    let authorFromField: string | null = null;
    let fileProcessingPromise: Promise<UploadResult> | null = null;

    busboy.on('field', (fieldname, val) => {
      if (fieldname === 'name') {
        nameFromField = val.trim() || null;
      } else if (fieldname === 'description') {
        descriptionFromField = val.trim() || null;
      } else if (fieldname === 'author') {
        authorFromField = val.trim() || null;
      }
    });

    busboy.on('file', (_fieldname, file, info) => {
      if (rejected) {
        file.resume();
        return;
      }

      const { filename: originalName, mimeType } = info;

      // Validate MIME type
      const detectedType = ALLOWED_MIME_TYPES[mimeType];
      if (!detectedType) {
        rejected = true;
        file.resume(); // Drain the stream
        reject(new Error(`Unsupported file type: ${mimeType}. Allowed: video/mp4, video/webm, video/quicktime, image/jpeg, image/png, image/gif, image/webp`));
        return;
      }

      // Create a promise for this file's processing
      fileProcessingPromise = new Promise<UploadResult>((resolveFile, rejectFile) => {
        // Create temp file and hash stream
        const tempPath = path.join(uploadsDir, `_upload_${Date.now()}_${Math.random().toString(36).slice(2)}`);
        const writeStream = fs.createWriteStream(tempPath);
        const hash = crypto.createHash('md5');
        let sizeBytes = 0;

        file.on('data', (chunk: Buffer) => {
          hash.update(chunk);
          sizeBytes += chunk.length;
        });

        file.pipe(writeStream);

        file.on('error', (err) => {
          rejected = true;
          writeStream.close();
          fs.unlink(tempPath, () => {});
          rejectFile(err);
        });

        writeStream.on('error', (err) => {
          rejected = true;
          fs.unlink(tempPath, () => {});
          rejectFile(err);
        });

        writeStream.on('finish', () => {
          if (rejected) return;

          const md5 = hash.digest('hex');
          const ext = getExtensionFromMime(mimeType);
          const finalFilename = `${md5}${ext}`;
          const finalPath = path.join(uploadsDir, finalFilename);

          // Check if file with same hash exists
          if (fs.existsSync(finalPath)) {
            // Delete temp file, use existing
            fs.unlinkSync(tempPath);
            logger.info('Upload deduplicated', { hash: md5, filename: finalFilename });
          } else {
            // Rename temp to final
            fs.renameSync(tempPath, finalPath);
            logger.info('Upload saved', { hash: md5, filename: finalFilename, size: sizeBytes });
          }

          resolveFile({
            hash: md5,
            filename: finalFilename,
            originalName: nameFromField || originalName || finalFilename,
            contentType: detectedType,
            sizeBytes,
            mimeType,
            description: descriptionFromField || undefined,
            author: authorFromField || undefined,
          });
        });
      });
    });

    busboy.on('finish', async () => {
      if (rejected) return;

      if (fileProcessingPromise) {
        try {
          const result = await fileProcessingPromise;
          resolve(result);
        } catch (err) {
          reject(err);
        }
      } else {
        reject(new Error('No file uploaded'));
      }
    });

    busboy.on('error', (err) => {
      rejected = true;
      reject(err);
    });

    req.pipe(busboy);
  });
}

export function getUploadPath(filename: string): string | null {
  const uploadsDir = getUploadsDir();
  // Security: only allow the basename to prevent path traversal
  const safeFilename = path.basename(filename);
  const filePath = path.join(uploadsDir, safeFilename);

  // Double-check: ensure path is within uploads dir
  if (!filePath.startsWith(uploadsDir)) {
    return null;
  }

  if (!fs.existsSync(filePath)) {
    return null;
  }

  return filePath;
}

/**
 * Delete an uploaded file by filename.
 */
export function deleteUpload(filename: string): boolean {
  const filePath = getUploadPath(filename);
  if (!filePath) return false;

  try {
    fs.unlinkSync(filePath);
    logger.info('Upload deleted', { filename });
    return true;
  } catch {
    return false;
  }
}
