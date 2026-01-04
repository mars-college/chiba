/**
 * YouTube download service using yt-dlp.
 * Downloads videos with quality capping at 1080p.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createLogger, YOUTUBE_MAX_HEIGHT } from '@chiba/shared';
import type { Content, ContentMetadata } from '@chiba/shared';
import { getDatabase, generateId } from '../db/index.js';
import { getMediaDir } from './content-cache.js';

const logger = createLogger('node', 'youtube');

/**
 * Check if a URL is a YouTube URL.
 */
export function isYouTubeUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(url);
}

export interface YouTubeResult {
  content: Content;
  alreadyCached: boolean;
}

export interface YouTubeProgress {
  hash: string;
  progress: number;
  status: 'downloading' | 'processing' | 'complete' | 'error';
  message?: string;
}

export type YouTubeProgressCallback = (progress: YouTubeProgress) => void;

/**
 * Get video metadata from yt-dlp.
 */
export async function getVideoMetadata(url: string): Promise<{
  title?: string;
  author?: string;
  duration?: number;
}> {
  return new Promise((resolve) => {
    const args = [
      '--dump-json',
      '--no-warnings',
      '--no-playlist',
      url
    ];

    const ytdlp = spawn('yt-dlp', args);
    let stdout = '';
    let stderr = '';

    ytdlp.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ytdlp.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ytdlp.on('close', (code) => {
      if (code !== 0) {
        logger.debug('Failed to get YouTube metadata', { stderr });
        resolve({});
        return;
      }

      try {
        const info = JSON.parse(stdout);
        resolve({
          title: info.title,
          author: info.uploader || info.channel,
          duration: info.duration,
        });
      } catch {
        resolve({});
      }
    });

    ytdlp.on('error', () => {
      resolve({});
    });
  });
}

/**
 * Download a YouTube video using yt-dlp.
 * Videos are cached by URL hash to avoid re-downloads.
 */
export async function downloadYouTube(
  url: string,
  options?: { metadata?: ContentMetadata; name?: string; onProgress?: YouTubeProgressCallback }
): Promise<YouTubeResult> {
  const { metadata, name, onProgress } = options || {};
  return new Promise(async (resolve, reject) => {
    const mediaDir = getMediaDir();

    // Generate hash from URL for consistent naming
    const urlHash = crypto.createHash('md5').update(url).digest('hex');
    const outputTemplate = path.join(mediaDir, `${urlHash}.%(ext)s`);

    logger.info('Starting YouTube download', { url, hash: urlHash });

    // Check if already cached
    const existingFiles = fs.readdirSync(mediaDir).filter(f => f.startsWith(urlHash));
    if (existingFiles.length > 0) {
      const filename = existingFiles[0];
      if (!filename) {
        reject(new Error('Unexpected empty filename'));
        return;
      }
      logger.info('YouTube already cached', { filename });

      // Get from database or create entry
      const db = getDatabase();
      const row = db.prepare('SELECT * FROM cached_content WHERE hash = ?').get(urlHash) as {
        hash: string;
        filename: string;
        name: string | null;
        content_type: string;
        size_bytes: number;
        duration: number | null;
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
            source: { type: 'youtube', url },
            type: 'video',
            sizeBytes: row.size_bytes,
            duration: row.duration ?? undefined,
            metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
            createdAt: row.cached_at,
          },
          alreadyCached: true,
        });
      } else {
        // File exists but not in DB - add it
        const filePath = path.join(mediaDir, filename);
        const stats = fs.statSync(filePath);
        const content: Content = {
          id: generateId(),
          hash: urlHash,
          filename,
          name,
          originalUrl: url,
          source: { type: 'youtube', url },
          type: 'video',
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
          'youtube',
          JSON.stringify({ type: 'youtube', url }),
          'video',
          content.sizeBytes,
          metadata ? JSON.stringify(metadata) : null,
          content.createdAt
        );

        resolve({ content, alreadyCached: true });
      }
      return;
    }

    // Fetch metadata if not provided
    let finalMetadata = metadata;
    if (!metadata?.title || !metadata?.author) {
      const videoMeta = await getVideoMetadata(url);
      finalMetadata = {
        ...metadata,
        title: metadata?.title ?? videoMeta.title,
        author: metadata?.author ?? videoMeta.author,
      };
    }

    onProgress?.({
      hash: urlHash,
      progress: 0,
      status: 'downloading',
      message: 'Starting download...',
    });

    // yt-dlp arguments for best quality up to 1080p
    const args = [
      '-f', `bestvideo[height<=${YOUTUBE_MAX_HEIGHT}]+bestaudio/best[height<=${YOUTUBE_MAX_HEIGHT}]/best`,
      '--merge-output-format', 'mp4',
      '-o', outputTemplate,
      '--no-playlist',
      '--no-warnings',
      '--progress',
      url
    ];

    const ytdlp = spawn('yt-dlp', args);
    let stderr = '';
    let lastProgress = 0;

    ytdlp.stdout.on('data', (data) => {
      const output = data.toString();
      // Parse progress updates
      if (output.includes('%')) {
        const match = output.match(/(\d+\.?\d*)%/);
        if (match && match[1]) {
          const progress = parseFloat(match[1]);
          if (progress !== lastProgress) {
            lastProgress = progress;
            logger.debug('YouTube progress', { hash: urlHash, progress });
            onProgress?.({
              hash: urlHash,
              progress,
              status: 'downloading',
              message: `Downloading: ${progress.toFixed(1)}%`,
            });
          }
        }
      }
    });

    ytdlp.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ytdlp.on('close', (code) => {
      if (code !== 0) {
        logger.error('yt-dlp failed', new Error(stderr || 'Unknown error'), { url });
        onProgress?.({
          hash: urlHash,
          progress: 0,
          status: 'error',
          message: stderr || 'Download failed',
        });
        reject(new Error(`yt-dlp failed: ${stderr || 'Unknown error'}`));
        return;
      }

      // Find the downloaded file
      const files = fs.readdirSync(mediaDir).filter(f => f.startsWith(urlHash));
      if (files.length === 0) {
        reject(new Error('Download completed but file not found'));
        return;
      }

      const filename = files[0];
      if (!filename) {
        reject(new Error('Unexpected empty filename'));
        return;
      }
      const filePath = path.join(mediaDir, filename);
      const stats = fs.statSync(filePath);

      const content: Content = {
        id: generateId(),
        hash: urlHash,
        filename,
        name,
        originalUrl: url,
        source: { type: 'youtube', url },
        type: 'video',
        sizeBytes: stats.size,
        metadata: finalMetadata,
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
        'youtube',
        JSON.stringify({ type: 'youtube', url }),
        'video',
        content.sizeBytes,
        finalMetadata ? JSON.stringify(finalMetadata) : null,
        content.createdAt
      );

      logger.info('YouTube cached', { filename, hash: urlHash, size: stats.size });
      onProgress?.({
        hash: urlHash,
        progress: 100,
        status: 'complete',
        message: 'Download complete',
      });

      resolve({ content, alreadyCached: false });
    });

    ytdlp.on('error', (err) => {
      logger.error('Failed to start yt-dlp', err);
      onProgress?.({
        hash: urlHash,
        progress: 0,
        status: 'error',
        message: `Failed to start yt-dlp: ${err.message}. Is yt-dlp installed?`,
      });
      reject(new Error(`Failed to start yt-dlp: ${err.message}. Is yt-dlp installed?`));
    });
  });
}
