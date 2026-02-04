/**
 * Controller HTTP/WebSocket server for Chiba digital signage system.
 *
 * This is the central controller that:
 * - Manages node registration and status
 * - Proxies commands to individual nodes
 * - Serves the admin dashboard
 * - Provides WebSocket connections for real-time updates
 */

import dotenv from 'dotenv';
import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import {
  createLogger,
  DEFAULT_PORT,
  VERSION,
  NODE_TIMEOUT,
  DEFAULT_PLAYBACK_STATE,
  type NodeStatus,
  type ControllerToNodeMessage,
  type NodeToControllerMessage,
  type ControllerToDashboardMessage,
  type DashboardToControllerMessage,
} from '@chiba/shared';

import { initDatabase, closeDatabase, getDatabase, generateId } from './db/index.js';
import {
  getCreation as getEdenCreation,
  getCollection as getEdenCollection,
  getCollectionCreations as getEdenCollectionCreations,
  parseEdenUrl,
  sanitizeCreationName,
} from './services/eden.js';
import {
  controlLight,
  getAllLights,
  getLightById,
  renameLight,
  deleteLight,
  refreshAllLightStates,
  syncLightsFromConfig,
} from './services/lights.js';
import { runDiscovery, startAutoDiscovery, stopAutoDiscovery } from './services/discovery.js';
import { isCloudConfigured } from './services/govee-cloud.js';
import { handleUpload, getUploadPath } from './services/uploads.js';
import type {
  LightWithState,
  LightPreset,
  LightControlRequest,
  CreatePresetRequest,
  PresetLightSetting,
  DiscoveryResult,
} from '@chiba/shared';

// Load .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const logger = createLogger('controller', 'server');

// ============================================================================
// Server State
// ============================================================================

interface ServerState {
  /** Connected nodes by ID */
  nodes: Map<string, NodeConnection>;
  /** Connected dashboard clients */
  dashboardClients: Set<WebSocket>;
  /** Node timeout check interval */
  timeoutCheckInterval: NodeJS.Timeout | null;
}

interface NodeConnection {
  ws: WebSocket;
  status: NodeStatus;
  lastHeartbeat: number;
  /** Node's HTTP URL for command proxying */
  httpUrl: string;
}

const state: ServerState = {
  nodes: new Map(),
  dashboardClients: new Set(),
  timeoutCheckInterval: null,
};

// ============================================================================
// HTTP Request Handling
// ============================================================================

/**
 * Read request body as JSON.
 */
async function readJsonBody<T>(req: http.IncomingMessage): Promise<T | null> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body) as T);
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => {
      resolve(null);
    });
  });
}

/**
 * Send JSON response.
 */
function sendJson(
  res: http.ServerResponse,
  data: unknown,
  statusCode = 200
): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
  });
  res.end(JSON.stringify(data));
}

/**
 * Send error response.
 */
function sendError(
  res: http.ServerResponse,
  message: string,
  statusCode = 400
): void {
  sendJson(res, { success: false, error: message }, statusCode);
}

// ============================================================================
// Static File Serving (Dashboard)
// ============================================================================

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  // Video types for uploaded media
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.m4v': 'video/x-m4v',
};

// Dashboard dist directory (relative to compiled server.js)
const DASHBOARD_DIR = path.resolve(__dirname, '../../dashboard/dist');

/**
 * Serve static files from the dashboard dist directory.
 * Returns true if a file was served, false otherwise.
 */
function serveStaticFile(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  urlPath: string
): boolean {
  // Security: prevent directory traversal
  const safePath = path.normalize(urlPath).replace(/^(\.\.[\/\\])+/, '');
  let filePath = path.join(DASHBOARD_DIR, safePath);

  // Check if dashboard dist exists
  if (!fs.existsSync(DASHBOARD_DIR)) {
    return false;
  }

  // If path is a directory or doesn't exist, try index.html (SPA routing)
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // For SPA routing, serve index.html for non-file paths
    const indexPath = path.join(DASHBOARD_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      filePath = indexPath;
    } else {
      return false;
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': content.length,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=31536000',
    });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check API key authentication.
 */
function isAuthenticated(req: http.IncomingMessage): boolean {
  const apiKey = process.env.API_KEY;
  if (!apiKey) return true; // No key configured = no auth required

  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7) === apiKey;
  }

  if (req.headers['x-api-key'] === apiKey) {
    return true;
  }

  const url = new URL(req.url ?? '', `http://${req.headers.host}`);
  if (url.searchParams.get('api_key') === apiKey) {
    return true;
  }

  return false;
}

/**
 * Handle HTTP requests.
 */
async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<void> {
  const url = new URL(req.url ?? '', `http://${req.headers.host}`);
  const method = req.method ?? 'GET';

  logger.debug('HTTP request', { method, path: url.pathname });

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    });
    res.end();
    return;
  }

  // Public routes (no auth required)
  if (method === 'GET') {
    switch (url.pathname) {
      case '/api/info':
        sendJson(res, {
          name: process.env.INSTANCE_NAME || 'chiba-controller',
          version: VERSION,
          endpoints: [
            'GET /api/info',
            'GET /health',
            // Nodes
            'GET /api/nodes',
            'GET /api/nodes/:id',
            'POST /api/nodes/register',
            'POST /api/nodes/:id/:action (play, stop, pause, resume, next, previous, volume, loop, shuffle, cache, clear-cache, rename, rotate)',
            // Content
            'GET /api/content',
            'POST /api/content',
            'PUT /api/content/:id',
            'POST /api/upload',
            'GET /uploads/:filename',
            'DELETE /api/content/:id',
            // Playlists
            'GET /api/playlists',
            'GET /api/playlists/:id',
            'POST /api/playlists',
            'PUT /api/playlists/:id',
            'DELETE /api/playlists/:id',
            'POST /api/playlists/:id/items',
            'DELETE /api/playlists/:id/items/:index',
            'POST /api/playlists/:id/play',
            'POST /api/playlists/:id/cache',
            // Eden
            'GET /api/eden/creation/:id',
            'GET /api/eden/collection/:id',
            'GET /api/eden/parse?url=...',
            // Lights
            'GET /api/lights',
            'POST /api/lights/discover',
            'PUT /api/lights/:id',
            'DELETE /api/lights/:id',
            'POST /api/lights/:id/control',
            'POST /api/lights/all/control',
            'GET /api/presets',
            'POST /api/presets',
            'POST /api/presets/:id/apply',
            'DELETE /api/presets/:id',
          ],
        });
        return;

      case '/health':
        sendJson(res, { status: 'ok', uptime: process.uptime() });
        return;

      case '/api/config':
        // Provide API key to dashboard (same-origin only in production)
        sendJson(res, {
          apiKey: process.env.API_KEY || '',
          version: VERSION,
        });
        return;

      case '/api/nodes':
        sendJson(res, {
          success: true,
          data: {
            nodes: Array.from(state.nodes.values()).map((n) => n.status),
          },
        });
        return;

      case '/api/content': {
        // Content library from database with pagination and search
        const db = getDatabase();
        const urlParams = new URL(req.url || '', `http://${req.headers.host}`).searchParams;

        // Parse pagination params
        const page = Math.max(1, parseInt(urlParams.get('page') || '1', 10));
        const limit = Math.min(100, Math.max(1, parseInt(urlParams.get('limit') || '100', 10)));
        const search = urlParams.get('search')?.trim().toLowerCase() || '';
        const offset = (page - 1) * limit;

        // Build WHERE clause for search
        let whereClause = '';
        const params: string[] = [];
        if (search) {
          whereClause = `WHERE (
            LOWER(COALESCE(name, '')) LIKE ? OR
            LOWER(filename) LIKE ? OR
            LOWER(COALESCE(metadata, '')) LIKE ?
          )`;
          const searchPattern = `%${search}%`;
          params.push(searchPattern, searchPattern, searchPattern);
        }

        // Get total count
        const countResult = db.prepare(`SELECT COUNT(*) as total FROM content ${whereClause}`).get(...params) as { total: number };
        const total = countResult.total;

        // Get paginated results
        const rows = db.prepare(`
          SELECT id, hash, filename, name, original_url, source_type, source_data,
                 content_type, size_bytes, duration, metadata, created_at
          FROM content
          ${whereClause}
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `).all(...params, limit, offset) as Array<{
          id: string;
          hash: string;
          filename: string;
          name: string | null;
          original_url: string | null;
          source_type: string;
          source_data: string | null;
          content_type: string;
          size_bytes: number | null;
          duration: number | null;
          metadata: string | null;
          created_at: number;
        }>;

        const items = rows.map(row => ({
          id: row.id,
          hash: row.hash,
          filename: row.filename,
          name: row.name ?? undefined,
          originalUrl: row.original_url,
          source: row.source_data ? JSON.parse(row.source_data) : { type: row.source_type },
          type: row.content_type as 'video' | 'image',
          sizeBytes: row.size_bytes ?? 0,
          duration: row.duration ?? undefined,
          metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
          createdAt: row.created_at,
        }));

        sendJson(res, { success: true, data: { items, total, page, limit } });
        return;
      }

      case '/api/playlists': {
        // List all playlists from database
        const db = getDatabase();
        const rows = db.prepare(`
          SELECT id, name, items, loop, show_intros, intro_duration, created_at, updated_at
          FROM playlists
          ORDER BY updated_at DESC
        `).all() as Array<{
          id: string;
          name: string;
          items: string;
          loop: number;
          show_intros: number;
          intro_duration: number;
          created_at: number;
          updated_at: number;
        }>;

        const playlists = rows.map(row => ({
          id: row.id,
          name: row.name,
          items: JSON.parse(row.items),
          loop: Boolean(row.loop),
          showIntros: Boolean(row.show_intros),
          introDuration: row.intro_duration,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));

        sendJson(res, { success: true, data: playlists });
        return;
      }

      case '/api/lights': {
        // Refresh states from actual lights (queries each light via UDP)
        const reachabilityMap = await refreshAllLightStates();

        // Get all lights with their updated states from database
        const db = getDatabase();
        const rows = db.prepare(`
          SELECT l.*, ls.power, ls.hue, ls.saturation, ls.brightness, ls.kelvin, ls.updated_at as state_updated_at
          FROM lights l
          LEFT JOIN light_state ls ON l.id = ls.light_id
          ORDER BY l.name
        `).all() as Array<{
          id: string;
          name: string;
          ip_address: string;
          port: number;
          device_id: string | null;
          sku: string | null;
          device_type: string | null;
          created_at: number;
          updated_at: number;
          power: number | null;
          hue: number | null;
          saturation: number | null;
          brightness: number | null;
          kelvin: number | null;
          state_updated_at: number | null;
        }>;

        const lightsWithState: LightWithState[] = rows.map(row => ({
          id: row.id,
          name: row.name,
          ipAddress: row.ip_address,
          port: row.port,
          deviceId: row.device_id ?? undefined,
          sku: row.sku ?? undefined,
          deviceType: row.device_type ?? undefined,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          state: row.power !== null ? {
            lightId: row.id,
            power: Boolean(row.power),
            hue: row.hue ?? 0,
            saturation: row.saturation ?? 100,
            brightness: row.brightness ?? 100,
            kelvin: row.kelvin ?? undefined,
            updatedAt: row.state_updated_at ?? 0,
          } : null,
          reachable: reachabilityMap.get(row.id) !== null,
        }));

        sendJson(res, { success: true, data: lightsWithState });
        return;
      }

      case '/api/presets': {
        // Get all light presets
        const db = getDatabase();
        const rows = db.prepare(`
          SELECT id, name, is_predefined, settings, created_at, updated_at
          FROM light_presets
          ORDER BY is_predefined DESC, name
        `).all() as Array<{
          id: string;
          name: string;
          is_predefined: number;
          settings: string;
          created_at: number;
          updated_at: number;
        }>;

        const presets: LightPreset[] = rows.map(row => ({
          id: row.id,
          name: row.name,
          isPredefined: Boolean(row.is_predefined),
          settings: JSON.parse(row.settings),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }));

        sendJson(res, { success: true, data: presets });
        return;
      }
    }

    // Eden API endpoints
    if (url.pathname.startsWith('/api/eden/')) {
      const edenPath = url.pathname.slice('/api/eden/'.length);
      const db = (url.searchParams.get('db') as 'PROD' | 'STAGE') || 'PROD';

      // GET /api/eden/creation/:id - Get creation metadata
      if (edenPath.startsWith('creation/')) {
        const creationId = edenPath.slice('creation/'.length);
        if (!creationId) {
          sendError(res, 'Missing creation ID');
          return;
        }
        try {
          const creation = await getEdenCreation(creationId, db);
          if (!creation) {
            sendError(res, 'Creation not found', 404);
            return;
          }
          sendJson(res, { success: true, data: creation });
        } catch (err) {
          logger.error('Eden creation fetch failed', err as Error);
          sendError(res, `Eden API error: ${(err as Error).message}`, 500);
        }
        return;
      }

      // GET /api/eden/collection/:id - Get collection with creations
      if (edenPath.startsWith('collection/')) {
        const collectionId = edenPath.slice('collection/'.length);
        if (!collectionId) {
          sendError(res, 'Missing collection ID');
          return;
        }
        try {
          const collection = await getEdenCollection(collectionId, db);
          if (!collection) {
            sendError(res, 'Collection not found', 404);
            return;
          }
          const creations = await getEdenCollectionCreations(collectionId, db);
          sendJson(res, {
            success: true,
            data: {
              collection,
              creations,
            },
          });
        } catch (err) {
          logger.error('Eden collection fetch failed', err as Error);
          sendError(res, `Eden API error: ${(err as Error).message}`, 500);
        }
        return;
      }

      // GET /api/eden/parse?url=... - Parse an Eden URL
      if (edenPath === 'parse') {
        const edenUrl = url.searchParams.get('url');
        if (!edenUrl) {
          sendError(res, 'Missing url parameter');
          return;
        }
        const parsed = parseEdenUrl(edenUrl);
        if (!parsed) {
          sendJson(res, { success: true, data: { valid: false } });
          return;
        }
        sendJson(res, { success: true, data: { valid: true, ...parsed } });
        return;
      }

      sendError(res, 'Unknown Eden endpoint', 404);
      return;
    }

    // Node detail: /api/nodes/:id
    if (url.pathname.startsWith('/api/nodes/')) {
      const nodeId = url.pathname.split('/')[3];
      if (nodeId) {
        // Try to find node by ID first, then by friendly name
        let node = state.nodes.get(nodeId);
        if (!node) {
          for (const [, n] of state.nodes.entries()) {
            if (n.status.node.friendlyName === nodeId) {
              node = n;
              break;
            }
          }
        }
        if (node) {
          sendJson(res, { success: true, data: { node: node.status } });
        } else {
          sendError(res, 'Node not found', 404);
        }
        return;
      }
    }

    // Serve uploaded files with range request support
    if (url.pathname.startsWith('/uploads/')) {
      const filename = url.pathname.slice('/uploads/'.length);
      const filePath = getUploadPath(filename);

      if (!filePath) {
        sendError(res, 'File not found', 404);
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
      const stat = fs.statSync(filePath);

      // Support range requests for video streaming
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0] || '0', 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        const chunksize = end - start + 1;

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': mimeType,
          'Access-Control-Allow-Origin': '*',
        });

        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': stat.size,
          'Content-Type': mimeType,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
        });

        fs.createReadStream(filePath).pipe(res);
      }
      return;
    }

    // Serve static files (dashboard) for non-API GET requests
    if (!url.pathname.startsWith('/api/')) {
      if (serveStaticFile(req, res, url.pathname)) {
        return;
      }
    }
  }

  // Protected routes (require auth)
  if (!isAuthenticated(req)) {
    sendError(res, 'Unauthorized', 401);
    return;
  }

  // File upload endpoint
  if (method === 'POST' && url.pathname === '/api/upload') {
    try {
      const result = await handleUpload(req);

      // Add to content library
      const db = getDatabase();
      const id = generateId();
      const controllerHost = req.headers.host || `localhost:${process.env.PORT || 8080}`;
      const uploadUrl = `http://${controllerHost}/uploads/${result.filename}`;

      const sourceData = JSON.stringify({
        type: 'upload',
        originalName: result.originalName,
        uploadUrl,
      });

      // Build metadata JSON if description or author provided
      const metadata = (result.description || result.author) ? JSON.stringify({
        description: result.description || undefined,
        author: result.author || undefined,
      }) : null;

      db.prepare(`
        INSERT INTO content (id, hash, filename, name, original_url, source_type, source_data, content_type, size_bytes, metadata, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        result.hash,
        result.filename,
        result.originalName,
        uploadUrl,
        'upload',
        sourceData,
        result.contentType,
        result.sizeBytes,
        metadata,
        Date.now()
      );

      logger.info('Upload added to content library', {
        id,
        hash: result.hash,
        filename: result.filename,
        size: result.sizeBytes,
      });

      sendJson(res, {
        success: true,
        data: {
          id,
          hash: result.hash,
          filename: result.filename,
          originalName: result.originalName,
          contentType: result.contentType,
          sizeBytes: result.sizeBytes,
          url: uploadUrl,
        },
      });
    } catch (err) {
      logger.error('Upload failed', err as Error);
      sendError(res, `Upload failed: ${(err as Error).message}`, 400);
    }
    return;
  }

  // Add content to library
  if (method === 'POST' && url.pathname === '/api/content') {
    const body = await readJsonBody<{
      url?: string;
      name?: string;
      description?: string;
      author?: string;
    }>(req);
    if (!body) {
      sendError(res, 'Invalid JSON body');
      return;
    }

    // URL is required
    if (!body.url) {
      sendError(res, 'URL is required');
      return;
    }

    const inputUrl = body.url.trim();
    const db = getDatabase();

    // Check if this is an Eden URL
    const edenInfo = parseEdenUrl(inputUrl);

    // Handle Eden collection URLs - fetch all creations and create playlist
    if (edenInfo?.type === 'collection') {
      logger.info('Adding Eden collection', { collectionId: edenInfo.id, db: edenInfo.db });

      try {
        // Fetch collection metadata
        const collection = await getEdenCollection(edenInfo.id, edenInfo.db);
        if (!collection) {
          sendError(res, 'Eden collection not found', 404);
          return;
        }

        // Fetch all creations in the collection
        const creations = await getEdenCollectionCreations(edenInfo.id, edenInfo.db);
        if (creations.length === 0) {
          sendError(res, 'Eden collection has no creations', 400);
          return;
        }

        logger.info('Fetched Eden collection', {
          name: collection.name,
          creationCount: creations.length
        });

        // Add each creation as a content item
        const contentIds: string[] = [];
        const now = Date.now();

        for (const creation of creations) {
          const contentId = generateId();
          const hash = crypto.randomUUID().replace(/-/g, '').substring(0, 32);

          // Determine content type from URL or mimeType
          let contentType: 'video' | 'image' = 'video';
          const mimeType = creation.mediaAttributes?.mimeType || '';
          const urlLower = creation.url?.toLowerCase() || '';
          if (mimeType.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(urlLower)) {
            contentType = 'image';
          }

          // Get filename from creation
          const filename = creation.filename || `${hash}.${contentType === 'video' ? 'mp4' : 'jpg'}`;

          // Build name from creation metadata (sanitized: max 40 chars, no line breaks)
          const creationName = sanitizeCreationName(creation.name) || sanitizeCreationName(creation.title) || `Creation ${creation._id.slice(0, 8)}`;

          // Build metadata
          const creationMetadata = JSON.stringify({
            author: creation.user?.username || undefined,
            edenCreationId: creation._id,
          });

          const sourceData = JSON.stringify({
            type: 'eden_creation',
            url: creation.url,
            creationId: creation._id,
            db: edenInfo.db,
          });

          db.prepare(`
            INSERT INTO content (id, hash, filename, name, original_url, source_type, source_data, content_type, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(contentId, hash, filename, creationName, creation.url, 'eden', sourceData, contentType, creationMetadata, now);

          contentIds.push(contentId);
        }

        // Create a playlist for the collection
        const playlistId = generateId();
        const playlistName = body.name?.trim() || collection.name || `Eden Collection ${edenInfo.id}`;

        // Build playlist items from the content we just added
        const playlistItems = contentIds.map((_contentId, index) => {
          const creation = creations[index]!;
          return {
            sourceType: 'eden_creation',
            sourceData: {
              url: creation.url,
              creationId: creation._id,
              db: edenInfo.db,
            },
            name: creation.name || creation.title || creation.filename || creation._id,
            duration: null,
          };
        });

        db.prepare(`
          INSERT INTO playlists (id, name, items, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          playlistId,
          playlistName,
          JSON.stringify(playlistItems),
          now,
          now
        );

        logger.info('Eden collection added', {
          collectionId: edenInfo.id,
          playlistId,
          playlistName,
          contentCount: contentIds.length,
        });

        sendJson(res, {
          success: true,
          data: {
            type: 'collection',
            collectionId: edenInfo.id,
            collectionName: collection.name,
            playlistId,
            playlistName,
            contentCount: contentIds.length,
            contentIds,
          },
        });
        return;
      } catch (err) {
        logger.error('Failed to add Eden collection', err as Error);
        sendError(res, `Eden API error: ${(err as Error).message}`, 500);
        return;
      }
    }

    // Handle Eden creation URLs - fetch metadata and add single item
    if (edenInfo?.type === 'creation') {
      logger.info('Adding Eden creation', { creationId: edenInfo.id, db: edenInfo.db });

      try {
        const creation = await getEdenCreation(edenInfo.id, edenInfo.db);
        if (!creation) {
          sendError(res, 'Eden creation not found', 404);
          return;
        }

        const id = generateId();
        const hash = crypto.randomUUID().replace(/-/g, '').substring(0, 32);

        // Determine content type
        let contentType: 'video' | 'image' = 'video';
        const mimeType = creation.mediaAttributes?.mimeType || '';
        const urlLower = creation.url?.toLowerCase() || '';
        if (mimeType.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(urlLower)) {
          contentType = 'image';
        }

        const filename = creation.filename || `${hash}.${contentType === 'video' ? 'mp4' : 'jpg'}`;
        // Build name from creation metadata (sanitized: max 40 chars, no line breaks)
        const creationName = body.name?.trim() || sanitizeCreationName(creation.name) || sanitizeCreationName(creation.title) || `Creation ${creation._id.slice(0, 8)}`;

        const metadata = JSON.stringify({
          description: body.description?.trim() || undefined,
          author: body.author?.trim() || creation.user?.username || undefined,
          edenCreationId: creation._id,
        });

        const sourceData = JSON.stringify({
          type: 'eden_creation',
          url: creation.url,
          creationId: creation._id,
          db: edenInfo.db,
        });

        db.prepare(`
          INSERT INTO content (id, hash, filename, name, original_url, source_type, source_data, content_type, metadata, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(id, hash, filename, creationName, creation.url, 'eden', sourceData, contentType, metadata, Date.now());

        logger.info('Eden creation added', { id, name: creationName, creationId: creation._id });

        sendJson(res, {
          success: true,
          data: {
            type: 'creation',
            id,
            hash,
            filename,
            name: creationName,
            sourceType: 'eden',
            originalUrl: creation.url,
            metadata: JSON.parse(metadata),
          },
        });
        return;
      } catch (err) {
        logger.error('Failed to add Eden creation', err as Error);
        sendError(res, `Eden API error: ${(err as Error).message}`, 500);
        return;
      }
    }

    // Handle other URL types (YouTube, direct URLs)
    let sourceType = 'url';
    if (inputUrl.includes('youtube.com') || inputUrl.includes('youtu.be')) {
      sourceType = 'youtube';
    }

    logger.info('Add content request', { url: inputUrl, sourceType, name: body.name });

    const id = generateId();
    const hash = crypto.randomUUID().replace(/-/g, '').substring(0, 32);
    const sourceData = JSON.stringify({ type: sourceType, url: inputUrl });
    const contentType = 'video'; // Default to video

    // Generate a filename from the URL or type
    let filename = `${hash}.mp4`;
    try {
      const urlObj = new URL(inputUrl);
      const pathParts = urlObj.pathname.split('/');
      const lastPart = pathParts[pathParts.length - 1];
      if (lastPart && lastPart.includes('.')) {
        filename = lastPart;
      }
    } catch {
      // Keep default filename
    }

    // Build metadata object if description or author provided
    const metadata = (body.description || body.author) ? JSON.stringify({
      description: body.description?.trim() || undefined,
      author: body.author?.trim() || undefined,
    }) : null;

    // Use provided name or null
    const name = body.name?.trim() || null;

    db.prepare(`
      INSERT INTO content (id, hash, filename, name, original_url, source_type, source_data, content_type, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, hash, filename, name, inputUrl, sourceType, sourceData, contentType, metadata, Date.now());

    logger.info('Content added to library', { id, name, type: sourceType, url: inputUrl });

    sendJson(res, {
      success: true,
      data: {
        id,
        hash,
        filename,
        name,
        sourceType,
        originalUrl: inputUrl,
        metadata: metadata ? JSON.parse(metadata) : undefined,
      },
    });
    return;
  }

  // ============================================================================
  // Playlist CRUD
  // ============================================================================

  // Create playlist
  if (method === 'POST' && url.pathname === '/api/playlists') {
    interface PlaylistItemInput {
      url?: string;
      creationId?: string;
      collectionId?: string;
      filename?: string;
      name?: string;
      duration?: number;
      db?: 'PROD' | 'STAGE';
    }
    interface CreatePlaylistBody {
      name: string;
      items?: PlaylistItemInput[];
      loop?: boolean;
      showIntros?: boolean;
      introDuration?: number;
      targetNodes?: string[]; // Node IDs to cache content on
    }

    const body = await readJsonBody<CreatePlaylistBody>(req);
    if (!body) {
      sendError(res, 'Invalid JSON body');
      return;
    }
    if (!body.name?.trim()) {
      sendError(res, 'Playlist name is required');
      return;
    }

    logger.info('Create playlist request', { name: body.name, itemCount: body.items?.length ?? 0 });

    const playlistId = generateId();
    const now = Date.now();

    // Process items - convert to PlaylistItem format
    const processedItems: Array<{
      id: string;
      sourceType: string;
      sourceData: Record<string, unknown>;
      name?: string;
      duration?: number;
      order: number;
    }> = [];

    if (body.items) {
      for (let i = 0; i < body.items.length; i++) {
        const item = body.items[i];
        if (!item) continue;

        const itemId = generateId();
        let sourceType = 'unknown';
        let sourceData: Record<string, unknown> = {};

        if (item.url) {
          // Check if it's an Eden URL
          const edenInfo = parseEdenUrl(item.url);
          if (edenInfo) {
            sourceType = edenInfo.type === 'creation' ? 'eden_creation' : 'eden_collection';
            sourceData = { url: item.url, id: edenInfo.id, db: edenInfo.db };
          } else if (item.url.includes('youtube.com') || item.url.includes('youtu.be')) {
            sourceType = 'youtube';
            sourceData = { url: item.url };
          } else {
            sourceType = 'url';
            sourceData = { url: item.url };
          }
        } else if (item.creationId) {
          sourceType = 'eden_creation';
          sourceData = { id: item.creationId, db: item.db || 'PROD' };
        } else if (item.collectionId) {
          sourceType = 'eden_collection';
          sourceData = { id: item.collectionId, db: item.db || 'PROD' };
        } else if (item.filename) {
          sourceType = 'file';
          sourceData = { filename: item.filename };
        }

        processedItems.push({
          id: itemId,
          sourceType,
          sourceData,
          name: item.name,
          duration: item.duration,
          order: i,
        });
      }
    }

    // Save to database
    const db = getDatabase();
    db.prepare(`
      INSERT INTO playlists (id, name, items, loop, show_intros, intro_duration, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      playlistId,
      body.name.trim(),
      JSON.stringify(processedItems),
      body.loop !== false ? 1 : 0,
      body.showIntros !== false ? 1 : 0,
      body.introDuration ?? 3000,
      now,
      now
    );

    logger.info('Playlist created', { id: playlistId, name: body.name, itemCount: processedItems.length });

    // Optionally trigger caching on target nodes
    if (body.targetNodes && body.targetNodes.length > 0 && processedItems.length > 0) {
      logger.info('Triggering cache on nodes', { nodes: body.targetNodes, playlistId });
      // This is async - we don't wait for it
      for (const nodeId of body.targetNodes) {
        const node = state.nodes.get(nodeId);
        if (node) {
          // Send cache commands for each item
          for (const item of processedItems) {
            const cacheBody: Record<string, unknown> = {};
            if (item.sourceType === 'eden_creation') {
              cacheBody.creationId = item.sourceData.id;
              cacheBody.db = item.sourceData.db;
            } else if (item.sourceType === 'eden_collection') {
              cacheBody.collectionId = item.sourceData.id;
              cacheBody.db = item.sourceData.db;
            } else if (item.sourceType === 'youtube' || item.sourceType === 'url') {
              cacheBody.url = item.sourceData.url;
            }
            if (Object.keys(cacheBody).length > 0) {
              proxyCommandToNode(node, 'cache', cacheBody).catch(err => {
                logger.error('Failed to cache on node', err as Error, { nodeId, item: item.id });
              });
            }
          }
        }
      }
    }

    sendJson(res, {
      success: true,
      data: {
        id: playlistId,
        name: body.name.trim(),
        items: processedItems,
        loop: body.loop !== false,
        showIntros: body.showIntros !== false,
        introDuration: body.introDuration ?? 3000,
        createdAt: now,
        updatedAt: now,
      },
    });
    return;
  }

  // Get single playlist
  if (method === 'GET' && url.pathname.match(/^\/api\/playlists\/[^/]+$/)) {
    const playlistId = url.pathname.split('/')[3];
    if (!playlistId) {
      sendError(res, 'Missing playlist ID');
      return;
    }

    const db = getDatabase();
    const row = db.prepare(`
      SELECT id, name, items, loop, show_intros, intro_duration, created_at, updated_at
      FROM playlists WHERE id = ?
    `).get(playlistId) as {
      id: string;
      name: string;
      items: string;
      loop: number;
      show_intros: number;
      intro_duration: number;
      created_at: number;
      updated_at: number;
    } | undefined;

    if (!row) {
      sendError(res, 'Playlist not found', 404);
      return;
    }

    sendJson(res, {
      success: true,
      data: {
        id: row.id,
        name: row.name,
        items: JSON.parse(row.items),
        loop: Boolean(row.loop),
        showIntros: Boolean(row.show_intros),
        introDuration: row.intro_duration,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
    return;
  }

  // Update playlist
  if (method === 'PUT' && url.pathname.match(/^\/api\/playlists\/[^/]+$/)) {
    const playlistId = url.pathname.split('/')[3];
    if (!playlistId) {
      sendError(res, 'Missing playlist ID');
      return;
    }

    const body = await readJsonBody<{
      name?: string;
      items?: unknown[];
      loop?: boolean;
      showIntros?: boolean;
      introDuration?: number;
    }>(req);

    if (!body) {
      sendError(res, 'Invalid JSON body');
      return;
    }

    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM playlists WHERE id = ?').get(playlistId);
    if (!existing) {
      sendError(res, 'Playlist not found', 404);
      return;
    }

    // Build update query dynamically
    const updates: string[] = [];
    const params: unknown[] = [];

    if (body.name !== undefined) {
      updates.push('name = ?');
      params.push(body.name);
    }
    if (body.items !== undefined) {
      updates.push('items = ?');
      params.push(JSON.stringify(body.items));
    }
    if (body.loop !== undefined) {
      updates.push('loop = ?');
      params.push(body.loop ? 1 : 0);
    }
    if (body.showIntros !== undefined) {
      updates.push('show_intros = ?');
      params.push(body.showIntros ? 1 : 0);
    }
    if (body.introDuration !== undefined) {
      updates.push('intro_duration = ?');
      params.push(body.introDuration);
    }

    if (updates.length === 0) {
      sendError(res, 'No fields to update');
      return;
    }

    updates.push('updated_at = ?');
    params.push(Date.now());
    params.push(playlistId);

    db.prepare(`UPDATE playlists SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    // Fetch and return updated playlist
    const row = db.prepare(`
      SELECT id, name, items, loop, show_intros, intro_duration, created_at, updated_at
      FROM playlists WHERE id = ?
    `).get(playlistId) as {
      id: string;
      name: string;
      items: string;
      loop: number;
      show_intros: number;
      intro_duration: number;
      created_at: number;
      updated_at: number;
    };

    logger.info('Playlist updated', { id: playlistId });

    sendJson(res, {
      success: true,
      data: {
        id: row.id,
        name: row.name,
        items: JSON.parse(row.items),
        loop: Boolean(row.loop),
        showIntros: Boolean(row.show_intros),
        introDuration: row.intro_duration,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
    return;
  }

  // Delete playlist
  if (method === 'DELETE' && url.pathname.match(/^\/api\/playlists\/[^/]+$/)) {
    const playlistId = url.pathname.split('/')[3];
    if (!playlistId) {
      sendError(res, 'Missing playlist ID');
      return;
    }

    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM playlists WHERE id = ?').get(playlistId);
    if (!existing) {
      sendError(res, 'Playlist not found', 404);
      return;
    }

    db.prepare('DELETE FROM playlists WHERE id = ?').run(playlistId);
    logger.info('Playlist deleted', { id: playlistId });
    sendJson(res, { success: true, message: 'Playlist deleted' });
    return;
  }

  // Add items to playlist
  if (method === 'POST' && url.pathname.match(/^\/api\/playlists\/[^/]+\/items$/)) {
    const playlistId = url.pathname.split('/')[3];
    if (!playlistId) {
      sendError(res, 'Missing playlist ID');
      return;
    }

    const body = await readJsonBody<{
      items: Array<{
        url?: string;
        creationId?: string;
        collectionId?: string;
        filename?: string;
        name?: string;
        duration?: number;
        db?: 'PROD' | 'STAGE';
      }>;
    }>(req);

    if (!body?.items || !Array.isArray(body.items)) {
      sendError(res, 'Items array is required');
      return;
    }

    const db = getDatabase();
    const row = db.prepare('SELECT items FROM playlists WHERE id = ?').get(playlistId) as { items: string } | undefined;
    if (!row) {
      sendError(res, 'Playlist not found', 404);
      return;
    }

    const existingItems = JSON.parse(row.items) as Array<{ order: number }>;
    const maxOrder = existingItems.length > 0
      ? Math.max(...existingItems.map(i => i.order)) + 1
      : 0;

    // Process new items
    const newItems = body.items.map((item, i) => {
      const itemId = generateId();
      let sourceType = 'unknown';
      let sourceData: Record<string, unknown> = {};

      if (item.url) {
        const edenInfo = parseEdenUrl(item.url);
        if (edenInfo) {
          sourceType = edenInfo.type === 'creation' ? 'eden_creation' : 'eden_collection';
          sourceData = { url: item.url, id: edenInfo.id, db: edenInfo.db };
        } else if (item.url.includes('youtube.com') || item.url.includes('youtu.be')) {
          sourceType = 'youtube';
          sourceData = { url: item.url };
        } else {
          sourceType = 'url';
          sourceData = { url: item.url };
        }
      } else if (item.creationId) {
        sourceType = 'eden_creation';
        sourceData = { id: item.creationId, db: item.db || 'PROD' };
      } else if (item.collectionId) {
        sourceType = 'eden_collection';
        sourceData = { id: item.collectionId, db: item.db || 'PROD' };
      } else if (item.filename) {
        sourceType = 'file';
        sourceData = { filename: item.filename };
      }

      return {
        id: itemId,
        sourceType,
        sourceData,
        name: item.name,
        duration: item.duration,
        order: maxOrder + i,
      };
    });

    const allItems = [...existingItems, ...newItems];
    db.prepare('UPDATE playlists SET items = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(allItems), Date.now(), playlistId);

    logger.info('Items added to playlist', { playlistId, addedCount: newItems.length });

    sendJson(res, {
      success: true,
      data: {
        addedItems: newItems,
        totalItems: allItems.length,
      },
    });
    return;
  }

  // Remove item from playlist
  if (method === 'DELETE' && url.pathname.match(/^\/api\/playlists\/[^/]+\/items\/\d+$/)) {
    const parts = url.pathname.split('/');
    const playlistId = parts[3];
    const itemIndex = parseInt(parts[5] ?? '', 10);

    if (!playlistId || isNaN(itemIndex)) {
      sendError(res, 'Invalid playlist ID or item index');
      return;
    }

    const db = getDatabase();
    const row = db.prepare('SELECT items FROM playlists WHERE id = ?').get(playlistId) as { items: string } | undefined;
    if (!row) {
      sendError(res, 'Playlist not found', 404);
      return;
    }

    const items = JSON.parse(row.items) as unknown[];
    if (itemIndex < 0 || itemIndex >= items.length) {
      sendError(res, 'Item index out of range', 400);
      return;
    }

    items.splice(itemIndex, 1);
    // Re-assign order values
    items.forEach((item, i) => {
      (item as { order: number }).order = i;
    });

    db.prepare('UPDATE playlists SET items = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(items), Date.now(), playlistId);

    logger.info('Item removed from playlist', { playlistId, index: itemIndex });

    sendJson(res, { success: true, message: 'Item removed', remainingItems: items.length });
    return;
  }

  // Play playlist on node - POST /api/playlists/:id/play
  if (method === 'POST' && url.pathname.match(/^\/api\/playlists\/[^/]+\/play$/)) {
    const playlistId = url.pathname.split('/')[3];
    if (!playlistId) {
      sendError(res, 'Missing playlist ID');
      return;
    }

    const body = await readJsonBody<{
      nodeId: string;
      startIndex?: number;
    }>(req);

    if (!body?.nodeId) {
      sendError(res, 'nodeId is required');
      return;
    }

    const db = getDatabase();
    const row = db.prepare(`
      SELECT id, name, items, loop, show_intros, intro_duration
      FROM playlists WHERE id = ?
    `).get(playlistId) as {
      id: string;
      name: string;
      items: string;
      loop: number;
      show_intros: number;
      intro_duration: number;
    } | undefined;

    if (!row) {
      sendError(res, 'Playlist not found', 404);
      return;
    }

    const node = state.nodes.get(body.nodeId);
    if (!node) {
      sendError(res, 'Node not found', 404);
      return;
    }

    const items = JSON.parse(row.items) as Array<{
      id: string;
      sourceType: string;
      sourceData: Record<string, unknown>;
      name?: string;
      duration?: number;
      order: number;
    }>;

    // Build play command with proper PlaylistItem objects
    // The node will resolve/cache each item when playing
    const playBody: Record<string, unknown> = {
      playlist: {
        id: row.id,
        name: row.name,
        items: items.map((item, idx) => {
          // Build ContentSource based on source type
          let content: Record<string, unknown>;
          if (item.sourceType === 'eden_creation') {
            content = { type: 'eden_creation', creationId: item.sourceData.creationId || item.sourceData.id, db: item.sourceData.db };
          } else if (item.sourceType === 'eden_collection') {
            content = { type: 'eden_collection', collectionId: item.sourceData.collectionId || item.sourceData.id, db: item.sourceData.db };
          } else if (item.sourceType === 'youtube') {
            content = { type: 'youtube', url: item.sourceData.url };
          } else if (item.sourceType === 'url') {
            content = { type: 'url', url: item.sourceData.url };
          } else if (item.sourceType === 'file') {
            content = { type: 'file', filename: item.sourceData.filename };
          } else {
            // Fallback - pass through as-is
            content = { type: 'url', url: String(item.sourceData.url || '') };
          }

          // Return proper PlaylistItem structure
          return {
            id: item.id,
            content,
            duration: item.duration,
            order: item.order ?? idx,
            metadata: item.name ? { title: item.name } : undefined,
          };
        }),
        loop: Boolean(row.loop),
        showIntros: Boolean(row.show_intros),
        introDuration: row.intro_duration,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      startIndex: body.startIndex ?? 0,
    };

    logger.info('Playing playlist on node', {
      playlistId,
      playlistName: row.name,
      nodeId: body.nodeId,
      itemCount: items.length,
    });

    try {
      const result = await proxyCommandToNode(node, 'play', playBody);
      sendJson(res, { success: true, data: result });
    } catch (err) {
      logger.error('Failed to play playlist on node', err as Error);
      sendError(res, `Play failed: ${(err as Error).message}`, 502);
    }
    return;
  }

  // Cache playlist on node - POST /api/playlists/:id/cache
  if (method === 'POST' && url.pathname.match(/^\/api\/playlists\/[^/]+\/cache$/)) {
    const playlistId = url.pathname.split('/')[3];
    if (!playlistId) {
      sendError(res, 'Missing playlist ID');
      return;
    }

    const body = await readJsonBody<{
      nodeIds: string[];
    }>(req);

    if (!body?.nodeIds || !Array.isArray(body.nodeIds) || body.nodeIds.length === 0) {
      sendError(res, 'nodeIds array is required');
      return;
    }

    const db = getDatabase();
    const row = db.prepare('SELECT items FROM playlists WHERE id = ?').get(playlistId) as { items: string } | undefined;
    if (!row) {
      sendError(res, 'Playlist not found', 404);
      return;
    }

    const items = JSON.parse(row.items) as Array<{
      sourceType: string;
      sourceData: Record<string, unknown>;
    }>;

    logger.info('Caching playlist on nodes', { playlistId, nodeIds: body.nodeIds, itemCount: items.length });

    const results: Record<string, { status: string; errors?: string[] }> = {};

    for (const nodeId of body.nodeIds) {
      const node = state.nodes.get(nodeId);
      if (!node) {
        results[nodeId] = { status: 'error', errors: ['Node not found'] };
        continue;
      }

      const errors: string[] = [];
      for (const item of items) {
        const cacheBody: Record<string, unknown> = {};
        if (item.sourceType === 'eden_creation') {
          cacheBody.creationId = item.sourceData.creationId || item.sourceData.id;
          cacheBody.db = item.sourceData.db;
        } else if (item.sourceType === 'eden_collection') {
          cacheBody.collectionId = item.sourceData.collectionId || item.sourceData.id;
          cacheBody.db = item.sourceData.db;
        } else if (item.sourceType === 'youtube' || item.sourceType === 'url') {
          cacheBody.url = item.sourceData.url;
        }

        if (Object.keys(cacheBody).length > 0) {
          try {
            await proxyCommandToNode(node, 'cache', cacheBody);
          } catch (err) {
            errors.push(`${item.sourceType}: ${(err as Error).message}`);
          }
        }
      }

      results[nodeId] = errors.length > 0
        ? { status: 'partial', errors }
        : { status: 'success' };
    }

    sendJson(res, { success: true, data: { playlistId, results } });
    return;
  }

  // Node registration (HTTP endpoint for nodes that can't use WebSocket)
  if (method === 'POST' && url.pathname === '/api/nodes/register') {
    const body = await readJsonBody<{ id?: string; name?: string; port?: number }>(req);
    if (!body) {
      sendError(res, 'Invalid JSON body');
      return;
    }

    // Generate ID if not provided
    const nodeId = body.id || crypto.randomUUID();
    const nodeName = body.name || 'unnamed-node';

    logger.info('Node registration via HTTP', { id: nodeId, name: nodeName });

    sendJson(res, {
      success: true,
      data: {
        id: nodeId,
        name: nodeName,
        apiKey: process.env.API_KEY || '',
      },
    });
    return;
  }

  // Update content metadata
  if (method === 'PUT' && url.pathname.startsWith('/api/content/')) {
    const contentId = url.pathname.split('/')[3];
    if (!contentId) {
      sendError(res, 'Missing content ID');
      return;
    }

    const db = getDatabase();
    const existing = db.prepare('SELECT * FROM content WHERE id = ?').get(contentId) as {
      id: string;
      metadata: string | null;
    } | undefined;
    if (!existing) {
      sendError(res, 'Content not found', 404);
      return;
    }

    const body = await readJsonBody<{
      name?: string;
      description?: string;
      author?: string;
    }>(req);

    if (!body) {
      sendError(res, 'Invalid JSON body');
      return;
    }

    // Update name if provided
    if (body.name !== undefined) {
      db.prepare('UPDATE content SET name = ? WHERE id = ?').run(body.name || null, contentId);
    }

    // Update metadata if description or author provided
    if (body.description !== undefined || body.author !== undefined) {
      const currentMetadata = existing.metadata ? JSON.parse(existing.metadata) : {};
      const newMetadata = {
        ...currentMetadata,
        ...(body.description !== undefined && { description: body.description || undefined }),
        ...(body.author !== undefined && { author: body.author || undefined }),
      };
      // Clean up undefined values
      Object.keys(newMetadata).forEach(key => {
        if (newMetadata[key] === undefined || newMetadata[key] === '') {
          delete newMetadata[key];
        }
      });
      db.prepare('UPDATE content SET metadata = ? WHERE id = ?').run(
        Object.keys(newMetadata).length > 0 ? JSON.stringify(newMetadata) : null,
        contentId
      );
    }

    logger.info('Content updated', { id: contentId, updates: body });
    sendJson(res, { success: true, message: 'Content updated' });
    return;
  }

  // Delete content from library
  if (method === 'DELETE' && url.pathname.startsWith('/api/content/')) {
    const contentId = url.pathname.split('/')[3];
    if (!contentId) {
      sendError(res, 'Missing content ID');
      return;
    }

    const db = getDatabase();
    const existing = db.prepare('SELECT id FROM content WHERE id = ?').get(contentId);
    if (!existing) {
      sendError(res, 'Content not found', 404);
      return;
    }

    db.prepare('DELETE FROM content WHERE id = ?').run(contentId);
    logger.info('Content deleted from library', { id: contentId });
    sendJson(res, { success: true, message: 'Content deleted' });
    return;
  }

  // ============================================================================
  // Light Control Endpoints
  // ============================================================================

  // Discover lights - POST /api/lights/discover
  // Pass { subnet: "100.128.0" } to scan a specific subnet via unicast UDP
  // Pass { prune: true } to delete lights not found in discovery
  if (method === 'POST' && url.pathname === '/api/lights/discover') {
    const body = await readJsonBody<{ timeout?: number; subnet?: string; prune?: boolean }>(req);
    const timeout = body?.timeout ?? 5000;
    const subnet = body?.subnet;
    const prune = body?.prune ?? false;

    logger.info('Starting light discovery', { timeout, subnet, prune });

    try {
      const result: DiscoveryResult = await runDiscovery(timeout, subnet, prune);
      sendJson(res, { success: true, data: result });
    } catch (err) {
      logger.error('Light discovery failed', err as Error);
      sendError(res, `Discovery failed: ${(err as Error).message}`, 500);
    }
    return;
  }

  // Sync lights from config - POST /api/lights/sync
  if (method === 'POST' && url.pathname === '/api/lights/sync') {
    logger.info('Syncing lights from config');

    try {
      const result = syncLightsFromConfig();
      sendJson(res, { success: true, data: result });
    } catch (err) {
      logger.error('Light sync failed', err as Error);
      sendError(res, `Sync failed: ${(err as Error).message}`, 500);
    }
    return;
  }

  // Import discovered lights - POST /api/lights/import
  // Allows importing discovery results from external tools (e.g., Python script)
  if (method === 'POST' && url.pathname === '/api/lights/import') {
    const body = await readJsonBody<{ lights: Array<{ ip: string; deviceId: string; sku: string }> }>(req);

    if (!body?.lights || !Array.isArray(body.lights)) {
      sendError(res, 'lights array is required');
      return;
    }

    // Validate each light has required fields
    for (const light of body.lights) {
      if (!light.ip || !light.deviceId || !light.sku) {
        sendError(res, 'Each light must have ip, deviceId, and sku');
        return;
      }
    }

    logger.info('Importing discovered lights', { count: body.lights.length });

    try {
      // Import using syncDiscoveredLights from discovery service
      const { syncDiscoveredLights } = await import('./services/discovery.js');
      const { added, updated } = syncDiscoveredLights(body.lights);

      sendJson(res, {
        success: true,
        data: {
          imported: body.lights.length,
          added,
          updated,
        },
      });
    } catch (err) {
      logger.error('Light import failed', err as Error);
      sendError(res, `Import failed: ${(err as Error).message}`, 500);
    }
    return;
  }

  // Rename a light - PUT /api/lights/:id
  if (method === 'PUT' && url.pathname.match(/^\/api\/lights\/[^/]+$/) && !url.pathname.includes('/control')) {
    const lightId = url.pathname.split('/')[3];
    if (!lightId) {
      sendError(res, 'Missing light ID');
      return;
    }

    const body = await readJsonBody<{ name?: string }>(req);
    if (!body?.name?.trim()) {
      sendError(res, 'Name is required');
      return;
    }

    try {
      const updated = renameLight(lightId, body.name.trim());
      if (!updated) {
        sendError(res, 'Light not found', 404);
        return;
      }
      logger.info('Light renamed', { id: lightId, name: body.name.trim() });
      sendJson(res, { success: true, data: updated });
    } catch (err) {
      logger.error('Failed to rename light', err as Error);
      sendError(res, `Rename failed: ${(err as Error).message}`, 500);
    }
    return;
  }

  // Delete a light - DELETE /api/lights/:id
  if (method === 'DELETE' && url.pathname.match(/^\/api\/lights\/[^/]+$/)) {
    const lightId = url.pathname.split('/')[3];
    if (!lightId) {
      sendError(res, 'Missing light ID');
      return;
    }

    try {
      const deleted = deleteLight(lightId);
      if (!deleted) {
        sendError(res, 'Light not found', 404);
        return;
      }
      logger.info('Light deleted', { id: lightId });
      sendJson(res, { success: true, message: 'Light deleted' });
    } catch (err) {
      logger.error('Failed to delete light', err as Error);
      sendError(res, `Delete failed: ${(err as Error).message}`, 500);
    }
    return;
  }

  // Control all lights - POST /api/lights/all/control
  // NOTE: Must come BEFORE the single-light handler to avoid regex matching "all" as an ID
  if (method === 'POST' && url.pathname === '/api/lights/all/control') {
    const body = await readJsonBody<LightControlRequest>(req);
    if (!body) {
      sendError(res, 'Invalid JSON body');
      return;
    }

    const lights = getAllLights();
    const results: Array<{ lightId: string; success: boolean; error?: string }> = [];

    logger.info('Control all lights', { body, count: lights.length });

    // Control all lights in parallel
    await Promise.all(
      lights.map(async (light) => {
        try {
          await controlLight(light, body);
          results.push({ lightId: light.id, success: true });
        } catch (err) {
          results.push({ lightId: light.id, success: false, error: (err as Error).message });
        }
      })
    );

    sendJson(res, { success: true, data: { results } });
    return;
  }

  // Control a single light - POST /api/lights/:id/control
  if (method === 'POST' && url.pathname.match(/^\/api\/lights\/[^/]+\/control$/)) {
    const lightId = url.pathname.split('/')[3];
    if (!lightId) {
      sendError(res, 'Missing light ID');
      return;
    }

    const light = getLightById(lightId);
    if (!light) {
      sendError(res, 'Light not found', 404);
      return;
    }

    const body = await readJsonBody<LightControlRequest>(req);
    if (!body) {
      sendError(res, 'Invalid JSON body');
      return;
    }

    logger.info('Light control request', { lightId, body });

    try {
      const state = await controlLight(light, body);
      sendJson(res, { success: true, data: { lightId: light.id, state } });
    } catch (err) {
      logger.error('Failed to control light', err as Error, { lightId });
      sendError(res, `Light control failed: ${(err as Error).message}`, 500);
    }
    return;
  }

  // Create a new preset - POST /api/presets
  if (method === 'POST' && url.pathname === '/api/presets') {
    const body = await readJsonBody<CreatePresetRequest>(req);
    if (!body?.name || !body?.settings) {
      sendError(res, 'Name and settings are required');
      return;
    }

    const db = getDatabase();
    const id = generateId();
    const now = Date.now();

    try {
      db.prepare(`
        INSERT INTO light_presets (id, name, is_predefined, settings, created_at, updated_at)
        VALUES (?, ?, 0, ?, ?, ?)
      `).run(id, body.name.trim(), JSON.stringify(body.settings), now, now);

      logger.info('Preset created', { id, name: body.name });

      sendJson(res, {
        success: true,
        data: {
          id,
          name: body.name.trim(),
          isPredefined: false,
          settings: body.settings,
          createdAt: now,
          updatedAt: now,
        },
      });
    } catch (err) {
      if ((err as Error).message.includes('UNIQUE constraint failed')) {
        sendError(res, 'A preset with that name already exists', 409);
      } else {
        throw err;
      }
    }
    return;
  }

  // Apply a preset - POST /api/presets/:id/apply
  if (method === 'POST' && url.pathname.match(/^\/api\/presets\/[^/]+\/apply$/)) {
    const presetId = url.pathname.split('/')[3];
    if (!presetId) {
      sendError(res, 'Missing preset ID');
      return;
    }

    const db = getDatabase();
    const preset = db.prepare('SELECT settings FROM light_presets WHERE id = ?').get(presetId) as { settings: string } | undefined;

    if (!preset) {
      sendError(res, 'Preset not found', 404);
      return;
    }

    const settings: PresetLightSetting[] = JSON.parse(preset.settings);
    const lights = getAllLights();

    logger.info('Applying preset', { presetId, settingsCount: settings.length });

    const results: Array<{ lightId: string; success: boolean; error?: string }> = [];

    for (const setting of settings) {
      const targetLights = setting.lightId === '*'
        ? lights
        : lights.filter(l => l.id === setting.lightId);

      for (const light of targetLights) {
        const request: LightControlRequest = {
          power: setting.power,
          hue: setting.hue,
          saturation: setting.saturation,
          brightness: setting.brightness,
        };

        try {
          await controlLight(light, request);
          results.push({ lightId: light.id, success: true });
        } catch (err) {
          results.push({ lightId: light.id, success: false, error: (err as Error).message });
        }
      }
    }

    sendJson(res, { success: true, data: { presetId, results } });
    return;
  }

  // Delete a user preset - DELETE /api/presets/:id
  if (method === 'DELETE' && url.pathname.match(/^\/api\/presets\/[^/]+$/)) {
    const presetId = url.pathname.split('/')[3];
    if (!presetId) {
      sendError(res, 'Missing preset ID');
      return;
    }

    const db = getDatabase();
    const preset = db.prepare('SELECT is_predefined FROM light_presets WHERE id = ?').get(presetId) as { is_predefined: number } | undefined;

    if (!preset) {
      sendError(res, 'Preset not found', 404);
      return;
    }

    if (preset.is_predefined) {
      sendError(res, 'Cannot delete predefined presets', 403);
      return;
    }

    db.prepare('DELETE FROM light_presets WHERE id = ?').run(presetId);
    logger.info('Preset deleted', { id: presetId });
    sendJson(res, { success: true, message: 'Preset deleted' });
    return;
  }

  // Node commands: /api/nodes/:id/:action
  if (method === 'POST' && url.pathname.startsWith('/api/nodes/')) {
    const parts = url.pathname.split('/');
    const nodeId = parts[3];
    const action = parts[4];

    if (!nodeId || !action) {
      sendError(res, 'Invalid endpoint');
      return;
    }

    // Try to find node by ID first, then by friendly name
    let node = state.nodes.get(nodeId);
    if (!node) {
      for (const [, n] of state.nodes.entries()) {
        if (n.status.node.friendlyName === nodeId) {
          node = n;
          break;
        }
      }
    }
    if (!node) {
      sendError(res, 'Node not found', 404);
      return;
    }

    const body = await readJsonBody<Record<string, unknown>>(req);
    logger.info('Node command', { nodeId, action, body });

    // Proxy the command to the node via HTTP
    try {
      const result = await proxyCommandToNode(node, action, body);
      sendJson(res, { success: true, data: result });
    } catch (error) {
      logger.error('Failed to proxy command', error as Error);
      sendError(res, `Command failed: ${(error as Error).message}`, 502);
    }
    return;
  }

  // 404 for unhandled routes
  sendError(res, 'Not found', 404);
}

// ============================================================================
// Command Proxy
// ============================================================================

/**
 * Proxy a command to a node via HTTP.
 */
async function proxyCommandToNode(
  node: NodeConnection,
  action: string,
  body: Record<string, unknown> | null
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const url = new URL(`/${action}`, node.httpUrl);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.API_KEY && { 'X-API-Key': process.env.API_KEY }),
      },
    };

    const req = httpModule.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(result.error || `HTTP ${res.statusCode}`));
          } else {
            resolve(result);
          }
        } catch {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          } else {
            resolve(data);
          }
        }
      });
    });

    req.on('error', reject);
    // 5 minute timeout to allow for YouTube downloads
    req.setTimeout(300000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Start checking for timed out nodes.
 */
function startNodeTimeoutCheck(): void {
  state.timeoutCheckInterval = setInterval(() => {
    const now = Date.now();
    const timedOutNodes: string[] = [];

    for (const [nodeId, conn] of state.nodes.entries()) {
      if (now - conn.lastHeartbeat > NODE_TIMEOUT) {
        timedOutNodes.push(nodeId);
      }
    }

    for (const nodeId of timedOutNodes) {
      const conn = state.nodes.get(nodeId);
      if (conn) {
        logger.warn('Node timed out', { nodeId });
        conn.ws.close();
        state.nodes.delete(nodeId);
        broadcastToDashboards({
          type: 'node_disconnected',
          nodeId,
        });
      }
    }
  }, 30000); // Check every 30 seconds
}

/**
 * Stop the node timeout check.
 */
function stopNodeTimeoutCheck(): void {
  if (state.timeoutCheckInterval) {
    clearInterval(state.timeoutCheckInterval);
    state.timeoutCheckInterval = null;
  }
}

// ============================================================================
// WebSocket Handling
// ============================================================================

/**
 * Handle WebSocket connections from nodes.
 */
function handleNodeConnection(ws: WebSocket): void {
  logger.info('Node WebSocket connected');

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString()) as NodeToControllerMessage;
      handleNodeMessage(ws, message);
    } catch (error) {
      logger.error('Failed to parse node message', error as Error);
    }
  });

  ws.on('close', () => {
    // Find and remove the disconnected node
    for (const [nodeId, conn] of state.nodes.entries()) {
      if (conn.ws === ws) {
        logger.info('Node disconnected', { nodeId });
        state.nodes.delete(nodeId);
        broadcastToDashboards({
          type: 'node_disconnected',
          nodeId,
        });
        break;
      }
    }
  });

  ws.on('error', (error) => {
    logger.error('Node WebSocket error', error);
  });
}

/**
 * Handle messages from nodes.
 */
function handleNodeMessage(
  ws: WebSocket,
  message: NodeToControllerMessage
): void {
  logger.debug('Node message', { type: message.type });

  switch (message.type) {
    case 'register': {
      const { config, info } = message;
      logger.info('Node registered', { id: config.id, name: config.friendlyName, ip: info.ip, port: info.port });

      // Persist node to database (required for foreign key in node_content)
      try {
        const db = getDatabase();
        db.prepare(`
          INSERT INTO nodes (id, friendly_name, hostname, ip, port, version, last_seen, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            friendly_name = excluded.friendly_name,
            hostname = excluded.hostname,
            ip = excluded.ip,
            port = excluded.port,
            version = excluded.version,
            last_seen = excluded.last_seen,
            updated_at = excluded.updated_at
        `).run(
          config.id,
          config.friendlyName,
          info.hostname,
          info.ip,
          info.port,
          info.version,
          Date.now(),
          Date.now(),
          Date.now()
        );
      } catch (err) {
        logger.error('Failed to persist node to database', err as Error);
      }

      const status: NodeStatus = {
        node: info,
        connected: true,
        lastSeen: Date.now(),
        playbackState: { ...DEFAULT_PLAYBACK_STATE },
        cachedContent: [],
        cachedPlaylists: [],
        diskUsage: {
          totalBytes: 0,
          usedBytes: 0,
          freeBytes: 0,
          mediaBytes: 0,
        },
      };

      // Build HTTP URL for command proxying
      const httpUrl = `http://${info.ip}:${info.port}`;

      state.nodes.set(config.id, { ws, status, lastHeartbeat: Date.now(), httpUrl });

      // Notify dashboards
      broadcastToDashboards({
        type: 'node_update',
        nodeId: config.id,
        status,
      });
      break;
    }

    case 'heartbeat': {
      const { status } = message;
      const existing = Array.from(state.nodes.entries()).find(
        ([, conn]) => conn.ws === ws
      );

      if (existing) {
        const [nodeId, conn] = existing;
        conn.status = status;
        conn.lastHeartbeat = Date.now();
        state.nodes.set(nodeId, conn);

        broadcastToDashboards({
          type: 'node_update',
          nodeId,
          status,
        });
      }
      break;
    }

    case 'state': {
      const { playback } = message;
      const existing = Array.from(state.nodes.entries()).find(
        ([, conn]) => conn.ws === ws
      );

      if (existing) {
        const [nodeId, conn] = existing;
        conn.status.playbackState = playback;
        state.nodes.set(nodeId, conn);

        broadcastToDashboards({
          type: 'node_update',
          nodeId,
          status: conn.status,
        });
      }
      break;
    }

    case 'pong':
      // Handled by heartbeat monitoring
      break;

    case 'download_progress': {
      // Forward task progress to all connected dashboards
      const nodeId = findNodeIdByWebSocket(ws);
      if (nodeId) {
        broadcastToDashboards({
          type: 'task_progress',
          nodeId,
          task: message,
        });
        logger.debug('Forwarded task progress', { nodeId, taskId: message.taskId, status: message.status });
      }
      break;
    }

    case 'content_cached': {
      // Add content to global library if not already present
      const nodeId = findNodeIdByWebSocket(ws);
      const { content } = message;

      try {
        const db = getDatabase();

        // Check if content already exists
        const existing = db.prepare('SELECT id FROM content WHERE hash = ?').get(content.hash) as { id: string } | undefined;

        if (!existing) {
          // Add to global content library
          const id = generateId();
          db.prepare(`
            INSERT INTO content (id, hash, filename, name, original_url, source_type, source_data, content_type, size_bytes, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            id,
            content.hash,
            content.filename,
            content.name ?? null,
            content.originalUrl ?? null,
            content.sourceType,
            content.sourceData,
            content.contentType,
            content.sizeBytes ?? null,
            content.metadata ?? null,
            Date.now()
          );
          logger.info('Added content to library from node', { hash: content.hash, nodeId });
        }

        // Track which node has this content
        if (nodeId) {
          db.prepare(`
            INSERT OR REPLACE INTO node_content (node_id, content_hash, cached_at)
            VALUES (?, ?, ?)
          `).run(nodeId, content.hash, Date.now());
        }
      } catch (err) {
        logger.error('Failed to process content_cached message', err as Error);
      }
      break;
    }

    default:
      logger.warn('Unknown message type', { type: (message as { type: string }).type });
  }
}

/**
 * Find node ID by its WebSocket connection.
 */
function findNodeIdByWebSocket(ws: WebSocket): string | null {
  for (const [nodeId, conn] of state.nodes.entries()) {
    if (conn.ws === ws) {
      return nodeId;
    }
  }
  return null;
}

/**
 * Handle WebSocket connections from dashboard.
 */
function handleDashboardConnection(ws: WebSocket): void {
  logger.info('Dashboard WebSocket connected');
  state.dashboardClients.add(ws);

  // Send current node list
  const nodesMessage: ControllerToDashboardMessage = {
    type: 'nodes',
    nodes: Array.from(state.nodes.values()).map((n) => n.status),
  };
  ws.send(JSON.stringify(nodesMessage));

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(
        data.toString()
      ) as DashboardToControllerMessage;
      handleDashboardMessage(ws, message);
    } catch (error) {
      logger.error('Failed to parse dashboard message', error as Error);
    }
  });

  ws.on('close', () => {
    logger.info('Dashboard disconnected');
    state.dashboardClients.delete(ws);
  });

  ws.on('error', (error) => {
    logger.error('Dashboard WebSocket error', error);
  });
}

/**
 * Handle messages from dashboard.
 */
function handleDashboardMessage(
  _ws: WebSocket,
  message: DashboardToControllerMessage
): void {
  logger.debug('Dashboard message', { type: message.type });

  switch (message.type) {
    case 'command': {
      const { nodeId, command } = message;
      const node = state.nodes.get(nodeId);

      if (node) {
        const nodeMessage: ControllerToNodeMessage = {
          type: 'command',
          command,
        };
        node.ws.send(JSON.stringify(nodeMessage));
        logger.info('Command sent to node', { nodeId, action: command.action });
      } else {
        logger.warn('Node not found for command', { nodeId });
      }
      break;
    }

    case 'subscribe':
      // Currently all dashboards receive all updates
      break;

    default:
      logger.warn('Unknown dashboard message type', {
        type: (message as { type: string }).type,
      });
  }
}

/**
 * Broadcast message to all connected dashboards.
 */
function broadcastToDashboards(message: ControllerToDashboardMessage): void {
  const data = JSON.stringify(message);
  for (const client of state.dashboardClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

// ============================================================================
// Server Startup
// ============================================================================

/**
 * Start the controller server.
 */
export function startServer(port = DEFAULT_PORT): http.Server {
  // Initialize database
  initDatabase();

  // Sync lights from config file (lights.json)
  syncLightsFromConfig();

  // Start auto-discovery for lights (runs every 30 minutes)
  startAutoDiscovery();

  // Create HTTP server
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      logger.error('Request handler error', error as Error);
      sendError(res, 'Internal server error', 500);
    });
  });

  // Create WebSocket servers
  const nodeWss = new WebSocketServer({ noServer: true });
  const dashboardWss = new WebSocketServer({ noServer: true });

  nodeWss.on('connection', handleNodeConnection);
  dashboardWss.on('connection', handleDashboardConnection);

  // Handle upgrade requests
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);

    if (url.pathname === '/ws/nodes') {
      nodeWss.handleUpgrade(req, socket, head, (ws) => {
        nodeWss.emit('connection', ws, req);
      });
    } else if (url.pathname === '/ws/dashboard') {
      dashboardWss.handleUpgrade(req, socket, head, (ws) => {
        dashboardWss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  // Start listening
  server.listen(port, () => {
    logger.info(`Controller server started`, { port, version: VERSION });
    logger.info('Govee cloud API', { configured: isCloudConfigured() });
    logger.info(`WebSocket endpoints: /ws/nodes, /ws/dashboard`);

    // Start node timeout monitoring
    startNodeTimeoutCheck();
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down...');
    stopNodeTimeoutCheck();
    stopAutoDiscovery();
    closeDatabase();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return server;
}

// Start server if this is the main module
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const port = parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
  startServer(port);
}
