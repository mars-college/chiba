/**
 * Eden API service for the controller.
 * Provides access to Eden API for querying creations and collections.
 * This is read-only - actual downloading happens on nodes.
 */

import https from 'https';
import { createLogger, EDEN_API } from '@chiba/shared';

const logger = createLogger('controller', 'eden');

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
    userId?: string;
  };
  mediaAttributes?: {
    mimeType?: string;
    width?: number;
    height?: number;
  };
  createdAt?: string;
  updatedAt?: string;
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
    userId?: string;
  };
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Get Eden API base URL.
 */
function getApiBase(db: 'PROD' | 'STAGE' = 'PROD'): string {
  return db === 'STAGE' ? EDEN_API.STAGE : EDEN_API.PROD;
}

/**
 * Make a request to the Eden API.
 */
async function edenRequest<T>(
  endpoint: string,
  db: 'PROD' | 'STAGE' = 'PROD'
): Promise<T> {
  const apiKey = process.env.EDEN_API_KEY;
  if (!apiKey) {
    throw new Error('EDEN_API_KEY not configured');
  }

  const apiBase = getApiBase(db);
  const url = `${apiBase}${endpoint}`;

  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'X-Api-Key': apiKey }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode === 404) {
            reject(new Error('Not found'));
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Eden API returned ${res.statusCode}: ${body}`));
            return;
          }
          resolve(JSON.parse(body) as T);
        } catch (e) {
          reject(new Error(`Failed to parse Eden response: ${body}`));
        }
      });
    });
    req.on('error', reject);
  });
}

/**
 * Get a single creation by ID.
 */
export async function getCreation(
  creationId: string,
  db: 'PROD' | 'STAGE' = 'PROD'
): Promise<EdenCreation | null> {
  logger.info('Fetching Eden creation', { creationId, db });
  try {
    // API wraps response in {creation: {...}}
    const response = await edenRequest<{ creation: EdenCreation }>(`/v2/creations/${creationId}`, db);
    return response.creation;
  } catch (err) {
    if ((err as Error).message === 'Not found') {
      return null;
    }
    throw err;
  }
}

/**
 * Get collection metadata.
 */
export async function getCollection(
  collectionId: string,
  db: 'PROD' | 'STAGE' = 'PROD'
): Promise<EdenCollection | null> {
  logger.info('Fetching Eden collection', { collectionId, db });
  try {
    return await edenRequest<EdenCollection>(`/v2/collections/${collectionId}`, db);
  } catch (err) {
    if ((err as Error).message === 'Not found') {
      return null;
    }
    throw err;
  }
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

/**
 * Get all creations in a collection with full details.
 * Fetches each creation individually to get name and other metadata.
 */
export async function getCollectionCreations(
  collectionId: string,
  db: 'PROD' | 'STAGE' = 'PROD'
): Promise<EdenCreation[]> {
  logger.info('Fetching Eden collection creations', { collectionId, db });

  // First, get the list of creation IDs from the collection
  const creationIds: string[] = [];
  let page = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await edenRequest<{ docs?: Array<{ _id: string }>; hasNextPage?: boolean }>(
      `/v2/collections/${collectionId}/creations?page=${page}&limit=100`,
      db
    );

    if (response.docs) {
      creationIds.push(...response.docs.map(d => d._id));
    }

    hasNextPage = response.hasNextPage ?? false;
    page++;
  }

  logger.info('Found creation IDs in collection', { collectionId, count: creationIds.length });

  // Fetch full details for each creation
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

  logger.info('Fetched collection creations with details', { collectionId, count: creations.length });
  return creations;
}

/**
 * Parse an Eden URL to extract type and ID.
 */
export function parseEdenUrl(url: string): { type: 'creation' | 'collection'; id: string; db: 'PROD' | 'STAGE' } | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    const pathParts = parsed.pathname.split('/').filter(Boolean);

    const db: 'PROD' | 'STAGE' = hostname.includes('staging') ? 'STAGE' : 'PROD';

    if (!hostname.includes('eden.art')) {
      return null;
    }

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
 * Check if URL is an Eden URL.
 */
export function isEdenUrl(url: string): boolean {
  return parseEdenUrl(url) !== null;
}
