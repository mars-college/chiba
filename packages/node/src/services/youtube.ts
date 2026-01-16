/**
 * YouTube download service using yt-dlp.
 * Downloads videos with quality priority: 1080p > 720p > best available.
 * This prevents downloading 4K+ videos that are too large for Pi displays.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createLogger } from '@chiba/shared';
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
  name?: string;
}

export type YouTubeProgressCallback = (progress: YouTubeProgress) => void;

/**
 * Get video metadata from yt-dlp.
 * Times out after 30 seconds to prevent indefinite hanging.
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

    logger.debug('Fetching YouTube metadata', { url, args });
    const ytdlp = spawn('yt-dlp', args);
    logger.debug('yt-dlp metadata process spawned', { pid: ytdlp.pid });

    let stdout = '';
    let stderr = '';
    let resolved = false;

    // Timeout after 30 seconds
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        logger.warn('yt-dlp metadata timed out after 30s', { url, pid: ytdlp.pid });
        ytdlp.kill();
        resolve({});
      }
    }, 30000);

    ytdlp.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ytdlp.stderr.on('data', (data) => {
      stderr += data.toString();
      logger.debug('yt-dlp metadata stderr', { data: data.toString().slice(0, 200) });
    });

    ytdlp.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);

      logger.debug('yt-dlp metadata process closed', { code, stdoutLen: stdout.length, stderrLen: stderr.length });
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

    ytdlp.on('error', (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      logger.error('yt-dlp metadata process error', err);
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
      logger.info('Fetching video metadata', { url, hash: urlHash });
      const videoMeta = await getVideoMetadata(url);
      logger.info('Metadata fetched', { url, hash: urlHash, title: videoMeta.title, author: videoMeta.author });
      finalMetadata = {
        ...metadata,
        title: metadata?.title ?? videoMeta.title,
        author: metadata?.author ?? videoMeta.author,
      };
    }

    // Get display name for progress (prefer provided name, then fetched title)
    const displayName = name || finalMetadata?.title;

    onProgress?.({
      hash: urlHash,
      progress: 0,
      status: 'downloading',
      message: 'Starting download...',
      name: displayName,
    });

    // yt-dlp arguments: prefer 1080p, then 720p, with capped fallbacks
    // Format priority:
    // 1. Best video up to 1080p + best audio (separate streams)
    // 2. Best video up to 720p + best audio (if 1080p unavailable)
    // 3. Best combined format up to 1080p
    // 4. Best combined format up to 720p
    // 5. Absolute best (only if nothing else works)
    const args = [
      '-f', 'bestvideo[height<=1080]+bestaudio/bestvideo[height<=720]+bestaudio/best[height<=1080]/best[height<=720]/best',
      '--merge-output-format', 'mp4',
      '-o', outputTemplate,
      '--no-playlist',
      '--no-warnings',
      '--progress',
      '--newline',  // Output progress on new lines for easier parsing
      url
    ];

    logger.info('Spawning yt-dlp', { args: args.join(' '), outputTemplate });
    const ytdlp = spawn('yt-dlp', args);
    logger.info('yt-dlp process spawned', { pid: ytdlp.pid, hash: urlHash });

    let stderr = '';
    let lastProgress = 0;
    let lastLogTime = Date.now();

    ytdlp.stdout.on('data', (data) => {
      const output = data.toString();
      const now = Date.now();

      // Log raw output periodically (every 5 seconds) or if it's not progress
      if (now - lastLogTime > 5000 || !output.includes('%')) {
        logger.debug('yt-dlp stdout', { hash: urlHash, output: output.slice(0, 300) });
        lastLogTime = now;
      }

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
              name: displayName,
            });
          }
        }
      }
    });

    ytdlp.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;
      logger.debug('yt-dlp stderr', { hash: urlHash, data: chunk.slice(0, 300) });
    });

    ytdlp.on('close', (code) => {
      logger.info('yt-dlp process closed', { pid: ytdlp.pid, code, hash: urlHash, stderrLen: stderr.length });
      if (code !== 0) {
        logger.error('yt-dlp failed', new Error(stderr || 'Unknown error'), { url });
        onProgress?.({
          hash: urlHash,
          progress: 0,
          status: 'error',
          message: stderr || 'Download failed',
          name: displayName,
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
        name: displayName,
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
        name: displayName,
      });
      reject(new Error(`Failed to start yt-dlp: ${err.message}. Is yt-dlp installed?`));
    });
  });
}
