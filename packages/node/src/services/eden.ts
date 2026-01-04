/**
 * Eden API integration for syncing collections.
 * Downloads content from Eden collections with pagination support.
 */

import https from 'https';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createLogger, EDEN_API } from '@chiba/shared';
import type { Content, ContentMetadata, Playlist, PlaylistItem } from '@chiba/shared';
import { getDatabase, generateId } from '../db/index.js';
import { getMediaDir, getExistingContent } from './content-cache.js';

const logger = createLogger('node', 'eden');

/**
 * Eden creation object from API.
 */
interface EdenCreation {
  _id: string;
  url: string;
  filename?: string;
  title?: string;
  name?: string;
  user?: {
    username?: string;
  };
}

/**
 * Eden API response.
 */
interface EdenApiResponse {
  docs?: EdenCreation[];
  hasNextPage?: boolean;
}

export interface EdenSyncResult {
  collectionId: string;
  db: 'PROD' | 'STAGE';
  total: number;
  downloaded: number;
  skipped: number;
  failed: number;
  files: Array<{
    filename: string;
    status: 'downloaded' | 'skipped' | 'failed';
    url?: string;
    error?: string;
    content?: Content;
  }>;
  playlist?: Playlist;
}

export interface EdenProgress {
  collectionId: string;
  current: number;
  total: number;
  filename: string;
  status: 'downloading' | 'skipped' | 'complete' | 'error';
}

export type EdenProgressCallback = (progress: EdenProgress) => void;

/**
 * Get Eden API base URL.
 */
function getApiBase(db: 'PROD' | 'STAGE' = 'PROD'): string {
  return db === 'STAGE' ? EDEN_API.STAGE : EDEN_API.PROD;
}

/**
 * Fetch all creations from an Eden collection with pagination.
 */
async function getCollectionCreations(
  collectionId: string,
  db: 'PROD' | 'STAGE' = 'PROD'
): Promise<EdenCreation[]> {
  const apiKey = process.env.EDEN_API_KEY;
  if (!apiKey) {
    throw new Error('EDEN_API_KEY not configured');
  }

  const apiBase = getApiBase(db);
  const creations: EdenCreation[] = [];
  let page = 1;
  let hasNextPage = true;

  logger.info('Fetching Eden collection', { collectionId, db, apiBase });

  while (hasNextPage) {
    const url = `${apiBase}/v2/collections/${collectionId}/creations?page=${page}&limit=100`;

    const data = await new Promise<EdenApiResponse>((resolve, reject) => {
      const req = https.get(url, {
        headers: { 'X-Api-Key': apiKey }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(body) as EdenApiResponse);
          } catch (e) {
            reject(new Error(`Failed to parse response: ${body}`));
          }
        });
      });
      req.on('error', reject);
    });

    if (data.docs) {
      creations.push(...data.docs);
      logger.debug('Fetched page', { page, count: data.docs.length });
    }

    hasNextPage = data.hasNextPage ?? false;
    page++;
  }

  logger.info('Fetched all creations', { collectionId, total: creations.length });
  return creations;
}

/**
 * Download a file from URL.
 */
async function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);

    const request = (urlToFetch: string) => {
      https.get(urlToFetch, {
        headers: {
          'User-Agent': 'Chiba/2.0',
          'Accept': '*/*'
        }
      }, (response) => {
        // Handle redirects
        if ((response.statusCode === 301 || response.statusCode === 302) && response.headers.location) {
          file.close();
          fs.unlinkSync(destPath);
          request(response.headers.location);
          return;
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlink(destPath, () => {});
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (err) => {
        file.close();
        fs.unlink(destPath, () => {});
        reject(err);
      });
    };

    request(url);
  });
}

/**
 * Sync all creations from an Eden collection.
 * Downloads to local media directory with MD5 naming.
 */
export async function syncCollection(
  collectionId: string,
  options: {
    db?: 'PROD' | 'STAGE';
    skipExisting?: boolean;
    onProgress?: EdenProgressCallback;
  } = {}
): Promise<EdenSyncResult> {
  const { db = 'PROD', skipExisting = true, onProgress } = options;
  const mediaDir = getMediaDir();

  logger.info('Starting Eden sync', { collectionId, db, skipExisting });
  const done = logger.time('Eden sync', { collectionId });

  // Fetch all creations
  const creations = await getCollectionCreations(collectionId, db);

  const result: EdenSyncResult = {
    collectionId,
    db,
    total: creations.length,
    downloaded: 0,
    skipped: 0,
    failed: 0,
    files: [],
  };

  const playlistItems: PlaylistItem[] = [];
  let order = 0;

  for (let i = 0; i < creations.length; i++) {
    const creation = creations[i];
    if (!creation) continue;

    // Determine filename - use hash of URL for consistency
    const urlHash = crypto.createHash('md5').update(creation.url).digest('hex');
    const ext = path.extname(new URL(creation.url).pathname) || '.mp4';
    const filename = `${urlHash}${ext}`;
    const destPath = path.join(mediaDir, filename);

    onProgress?.({
      collectionId,
      current: i + 1,
      total: creations.length,
      filename,
      status: 'downloading',
    });

    // Check if already exists
    const existing = getExistingContent(urlHash);
    if (skipExisting && existing && fs.existsSync(destPath)) {
      logger.debug('Skipping existing', { filename });
      result.skipped++;
      result.files.push({ filename, status: 'skipped', content: existing });

      playlistItems.push({
        id: generateId(),
        content: existing,
        order: order++,
        metadata: {
          title: creation.title || creation.name,
          author: creation.user?.username,
        },
      });

      onProgress?.({
        collectionId,
        current: i + 1,
        total: creations.length,
        filename,
        status: 'skipped',
      });
      continue;
    }

    try {
      logger.debug('Downloading', { filename, url: creation.url });
      await downloadFile(creation.url, destPath);

      const stats = fs.statSync(destPath);
      const metadata: ContentMetadata = {
        title: creation.title || creation.name,
        author: creation.user?.username,
      };

      const content: Content = {
        id: generateId(),
        hash: urlHash,
        filename,
        originalUrl: creation.url,
        source: { type: 'eden', collectionId, db },
        type: 'video', // Assume video for Eden
        sizeBytes: stats.size,
        metadata,
        createdAt: Date.now(),
      };

      // Save to database
      const database = getDatabase();
      database.prepare(`
        INSERT OR REPLACE INTO cached_content (
          hash, filename, original_url, source_type, source_data,
          content_type, size_bytes, metadata, cached_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        content.hash,
        content.filename,
        creation.url,
        'eden',
        JSON.stringify({ type: 'eden', collectionId, db }),
        'video',
        content.sizeBytes,
        JSON.stringify(metadata),
        content.createdAt
      );

      result.downloaded++;
      result.files.push({ filename, status: 'downloaded', url: creation.url, content });

      playlistItems.push({
        id: generateId(),
        content,
        order: order++,
        metadata,
      });

      onProgress?.({
        collectionId,
        current: i + 1,
        total: creations.length,
        filename,
        status: 'complete',
      });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error('Failed to download', new Error(error), { filename, url: creation.url });
      result.failed++;
      result.files.push({ filename, status: 'failed', error, url: creation.url });

      onProgress?.({
        collectionId,
        current: i + 1,
        total: creations.length,
        filename,
        status: 'error',
      });
    }
  }

  // Create playlist from synced content
  if (playlistItems.length > 0) {
    result.playlist = {
      id: generateId(),
      name: `Eden Collection ${collectionId}`,
      items: playlistItems,
      loop: true,
      showIntros: true,
      introDuration: 3000,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  done();
  logger.info('Eden sync complete', {
    collectionId,
    total: result.total,
    downloaded: result.downloaded,
    skipped: result.skipped,
    failed: result.failed,
  });

  return result;
}
