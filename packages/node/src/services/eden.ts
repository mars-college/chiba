/**
 * Eden API integration for syncing collections and fetching creations.
 * Downloads content from Eden collections with pagination support.
 */

import https from 'https';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createLogger, EDEN_API, getContentType } from '@chiba/shared';
import type { Content, ContentMetadata, Playlist, PlaylistItem } from '@chiba/shared';
import { getDatabase, generateId } from '../db/index.js';
import { getMediaDir, getExistingContent, notifyContentCached } from './content-cache.js';

const logger = createLogger('node', 'eden');

/**
 * Eden creation object from API.
 */
export interface EdenCreation {
  _id: string;
  url: string;
  filename?: string;
  title?: string;
  name?: string;
  user?: {
    username?: string;
  };
  mediaAttributes?: {
    mimeType?: string;
    width?: number;
    height?: number;
  };
}

/**
 * Eden collection object from API.
 */
export interface EdenCollection {
  _id: string;
  name: string;
  description?: string;
  user?: {
    username?: string;
  };
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Parsed Eden URL info.
 */
export interface EdenUrlInfo {
  type: 'creation' | 'collection';
  id: string;
  db: 'PROD' | 'STAGE';
}

/**
 * Eden API response.
 */
interface EdenApiResponse {
  docs?: Array<{ _id: string; url?: string; filename?: string }>;
  hasNextPage?: boolean;
}

/**
 * Sanitize a creation name: max 40 chars, no line breaks.
 */
export function sanitizeCreationName(name: string | null | undefined): string | null {
  if (!name) return null;
  // Remove line breaks and extra whitespace
  const cleaned = name.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
  // Truncate to 40 chars
  if (cleaned.length <= 40) return cleaned;
  return cleaned.slice(0, 37) + '...';
}

export interface EdenSyncResult {
  collectionId: string;
  collectionName: string;
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
 * Parse an Eden URL to extract type, ID, and database.
 * Supports:
 * - https://app.eden.art/creation/[id]
 * - https://eden.art/creations/[id]
 * - https://app.eden.art/collection/[id]
 * - https://eden.art/collections/[id]
 * - https://staging.eden.art/... (STAGE db)
 */
export function parseEdenUrl(url: string): EdenUrlInfo | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const pathParts = parsed.pathname.split('/').filter(Boolean);

    // Determine database from hostname
    const db: 'PROD' | 'STAGE' = hostname.includes('staging') ? 'STAGE' : 'PROD';

    // Check if it's an Eden domain
    if (!hostname.includes('eden.art')) {
      return null;
    }

    // Parse path: /creation/[id], /creations/[id], /collection/[id], /collections/[id]
    if (pathParts.length >= 2) {
      const resourceType = pathParts[0]?.toLowerCase();
      const id = pathParts[1];

      if ((resourceType === 'creation' || resourceType === 'creations') && id) {
        return { type: 'creation', id, db };
      }
      if ((resourceType === 'collection' || resourceType === 'collections') && id) {
        return { type: 'collection', id, db };
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a string is a valid Eden URL.
 */
export function isEdenUrl(url: string): boolean {
  return parseEdenUrl(url) !== null;
}

/**
 * Fetch a single creation by ID from Eden API.
 */
export async function getCreation(
  creationId: string,
  db: 'PROD' | 'STAGE' = 'PROD'
): Promise<EdenCreation | null> {
  const apiKey = process.env.EDEN_API_KEY;
  if (!apiKey) {
    throw new Error('EDEN_API_KEY not configured');
  }

  const apiBase = getApiBase(db);
  const url = `${apiBase}/v2/creations/${creationId}`;

  logger.info('Fetching Eden creation', { creationId, db });

  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'X-Api-Key': apiKey }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode === 404) {
            resolve(null);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Eden API returned ${res.statusCode}: ${body}`));
            return;
          }
          const response = JSON.parse(body) as { creation: EdenCreation };
          resolve(response.creation);
        } catch (e) {
          reject(new Error(`Failed to parse creation response: ${body}`));
        }
      });
    });
    req.on('error', reject);
  });
}

/**
 * Get creation from URL - parses URL and fetches the creation.
 */
export async function getCreationFromUrl(
  url: string
): Promise<{ creation: EdenCreation; db: 'PROD' | 'STAGE' } | null> {
  const info = parseEdenUrl(url);
  if (!info || info.type !== 'creation') {
    return null;
  }

  const creation = await getCreation(info.id, info.db);
  if (!creation) {
    return null;
  }

  return { creation, db: info.db };
}

/**
 * Get collection metadata (without creations).
 */
export async function getCollectionInfo(
  collectionId: string,
  db: 'PROD' | 'STAGE' = 'PROD'
): Promise<EdenCollection | null> {
  const apiKey = process.env.EDEN_API_KEY;
  if (!apiKey) {
    throw new Error('EDEN_API_KEY not configured');
  }

  const apiBase = getApiBase(db);
  const url = `${apiBase}/v2/collections/${collectionId}`;

  logger.info('Fetching Eden collection info', { collectionId, db });

  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'X-Api-Key': apiKey }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode === 404) {
            resolve(null);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Eden API returned ${res.statusCode}: ${body}`));
            return;
          }
          const data = JSON.parse(body) as EdenCollection;
          resolve(data);
        } catch (e) {
          reject(new Error(`Failed to parse collection response: ${body}`));
        }
      });
    });
    req.on('error', reject);
  });
}

/**
 * Get all creations from a collection (for listing, not downloading).
 */
export async function getCollectionCreationsList(
  collectionId: string,
  db: 'PROD' | 'STAGE' = 'PROD'
): Promise<EdenCreation[]> {
  return getCollectionCreations(collectionId, db);
}

/**
 * Fetch all creations from an Eden collection with full details.
 * First gets the list of IDs, then fetches each creation individually for full metadata.
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
  const creationIds: string[] = [];
  let page = 1;
  let hasNextPage = true;

  logger.info('Fetching Eden collection creation IDs', { collectionId, db, apiBase });

  // First, get all creation IDs from the collection
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
      creationIds.push(...data.docs.map(d => d._id));
      logger.debug('Fetched page', { page, count: data.docs.length });
    }

    hasNextPage = data.hasNextPage ?? false;
    page++;
  }

  logger.info('Found creation IDs', { collectionId, count: creationIds.length });

  // Now fetch full details for each creation
  const creations: EdenCreation[] = [];
  for (const creationId of creationIds) {
    try {
      const creation = await getCreation(creationId, db);
      if (creation) {
        creations.push(creation);
      }
    } catch (err) {
      logger.warn('Failed to fetch creation details', { creationId, error: (err as Error).message });
    }
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

  // Fetch collection metadata for the playlist name
  const collectionInfo = await getCollectionInfo(collectionId, db);
  const collectionName = collectionInfo?.name || `Eden Collection ${collectionId}`;

  // Fetch all creations
  const creations = await getCollectionCreations(collectionId, db);

  const result: EdenSyncResult = {
    collectionId,
    collectionName,
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
          title: sanitizeCreationName(creation.name) || sanitizeCreationName(creation.title) || `Creation ${creation._id.slice(0, 8)}`,
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
      // Sanitize name: max 40 chars, no line breaks
      const contentName = sanitizeCreationName(creation.name) || sanitizeCreationName(creation.title) || `Creation ${creation._id.slice(0, 8)}`;
      const metadata: ContentMetadata = {
        title: contentName,
        author: creation.user?.username,
      };

      const content: Content = {
        id: generateId(),
        hash: urlHash,
        filename,
        name: contentName,
        originalUrl: creation.url,
        source: { type: 'eden_collection', collectionId, db },
        type: getContentType(filename) ?? 'video',
        sizeBytes: stats.size,
        metadata,
        createdAt: Date.now(),
      };

      // Save to database
      const database = getDatabase();
      database.prepare(`
        INSERT OR REPLACE INTO cached_content (
          hash, filename, name, original_url, source_type, source_data,
          content_type, size_bytes, metadata, cached_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        content.hash,
        content.filename,
        content.name,
        creation.url,
        'eden_collection',
        JSON.stringify({ type: 'eden_collection', collectionId, db }),
        content.type,
        content.sizeBytes,
        JSON.stringify(metadata),
        content.createdAt
      );

      // Notify about newly cached content
      notifyContentCached(content);

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
      name: collectionName,
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

/**
 * Result of downloading a single Eden creation.
 */
export interface EdenCreationDownloadResult {
  content: Content;
  alreadyCached: boolean;
  creation: EdenCreation;
}

/**
 * Download and cache a single Eden creation.
 * Returns the cached content object.
 */
export async function downloadCreation(
  creationId: string,
  options: {
    db?: 'PROD' | 'STAGE';
    name?: string;
  } = {}
): Promise<EdenCreationDownloadResult> {
  const { db = 'PROD', name } = options;
  const mediaDir = getMediaDir();

  logger.info('Downloading Eden creation', { creationId, db });

  // Fetch creation metadata
  const creation = await getCreation(creationId, db);
  if (!creation) {
    throw new Error(`Creation not found: ${creationId}`);
  }

  if (!creation.url) {
    throw new Error(`Creation ${creationId} has no media URL`);
  }

  // Determine filename
  const urlHash = crypto.createHash('md5').update(creation.url).digest('hex');
  const ext = path.extname(new URL(creation.url).pathname) || '.mp4';
  const filename = `${urlHash}${ext}`;
  const destPath = path.join(mediaDir, filename);

  // Check if already cached
  const existing = getExistingContent(urlHash);
  if (existing && fs.existsSync(destPath)) {
    logger.info('Creation already cached', { creationId, filename });
    return { content: existing, alreadyCached: true, creation };
  }

  // Download file
  logger.info('Downloading creation media', { creationId, url: creation.url });
  await downloadFile(creation.url, destPath);

  const stats = fs.statSync(destPath);
  // Sanitize name: max 40 chars, no line breaks
  const contentName = name || sanitizeCreationName(creation.name) || sanitizeCreationName(creation.title) || `Creation ${creation._id.slice(0, 8)}`;
  const metadata: ContentMetadata = {
    title: contentName,
    author: creation.user?.username,
  };

  const content: Content = {
    id: generateId(),
    hash: urlHash,
    filename,
    name: contentName,
    originalUrl: creation.url,
    source: { type: 'eden_creation', creationId, db },
    type: getContentType(filename) ?? 'video',
    sizeBytes: stats.size,
    metadata,
    createdAt: Date.now(),
  };

  // Save to database
  const database = getDatabase();
  database.prepare(`
    INSERT OR REPLACE INTO cached_content (
      hash, filename, name, original_url, source_type, source_data,
      content_type, size_bytes, metadata, cached_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    content.hash,
    content.filename,
    content.name ?? null,
    creation.url,
    'eden_creation',
    JSON.stringify({ type: 'eden_creation', creationId, db }),
    'video',
    content.sizeBytes,
    JSON.stringify(metadata),
    content.createdAt
  );

  // Notify about newly cached content
  notifyContentCached(content);

  logger.info('Creation downloaded', { creationId, filename, size: stats.size });

  return { content, alreadyCached: false, creation };
}

/**
 * Download creation from URL - parses URL and downloads.
 */
export async function downloadCreationFromUrl(
  url: string,
  options: { name?: string } = {}
): Promise<EdenCreationDownloadResult | null> {
  const info = parseEdenUrl(url);
  if (!info || info.type !== 'creation') {
    return null;
  }

  return downloadCreation(info.id, { db: info.db, name: options.name });
}
