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
} from './services/eden.js';

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
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
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
          name: 'chiba-controller',
          version: VERSION,
          endpoints: [
            'GET /api/info',
            'GET /health',
            // Nodes
            'GET /api/nodes',
            'GET /api/nodes/:id',
            'POST /api/nodes/register',
            'POST /api/nodes/:id/:action (play, stop, pause, resume, next, previous, volume, loop, cache, clear-cache)',
            // Content
            'GET /api/content',
            'POST /api/content',
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
        // Content library from database
        const db = getDatabase();
        const rows = db.prepare(`
          SELECT id, hash, filename, name, original_url, source_type, source_data,
                 content_type, size_bytes, duration, metadata, created_at
          FROM content
          ORDER BY created_at DESC
        `).all() as Array<{
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

        const contentList = rows.map(row => ({
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

        sendJson(res, { success: true, data: contentList });
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
        const node = state.nodes.get(nodeId);
        if (node) {
          sendJson(res, { success: true, data: { node: node.status } });
        } else {
          sendError(res, 'Node not found', 404);
        }
        return;
      }
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

  // Add content to library
  if (method === 'POST' && url.pathname === '/api/content') {
    const body = await readJsonBody<{ type: string; url?: string; collectionId?: string; name?: string }>(req);
    if (!body) {
      sendError(res, 'Invalid JSON body');
      return;
    }
    logger.info('Add content request', body);

    const db = getDatabase();
    const id = generateId();
    const hash = crypto.randomUUID().replace(/-/g, '').substring(0, 32); // Placeholder hash
    const sourceType = body.type;
    const sourceData = JSON.stringify(body);
    const contentType = sourceType === 'youtube' ? 'video' : 'video'; // Default to video

    // Generate a filename from the URL or type
    let filename = `${hash}.mp4`;
    if (body.url) {
      try {
        const urlObj = new URL(body.url);
        const pathParts = urlObj.pathname.split('/');
        const lastPart = pathParts[pathParts.length - 1];
        if (lastPart && lastPart.includes('.')) {
          filename = lastPart;
        }
      } catch {
        // Keep default filename
      }
    }

    // Use provided name or null
    const name = body.name?.trim() || null;

    db.prepare(`
      INSERT INTO content (id, hash, filename, name, original_url, source_type, source_data, content_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, hash, filename, name, body.url ?? null, sourceType, sourceData, contentType, Date.now());

    logger.info('Content added to library', { id, name, type: sourceType, url: body.url });

    sendJson(res, {
      success: true,
      data: {
        id,
        hash,
        filename,
        name,
        sourceType,
        originalUrl: body.url,
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

    // Build play command with playlist items
    // The node will resolve/cache each item when playing
    const playBody: Record<string, unknown> = {
      playlist: {
        id: row.id,
        name: row.name,
        items: items.map(item => {
          // Convert stored format to playable format
          if (item.sourceType === 'eden_creation') {
            return { creationId: item.sourceData.id, db: item.sourceData.db, name: item.name };
          } else if (item.sourceType === 'eden_collection') {
            return { collectionId: item.sourceData.id, db: item.sourceData.db };
          } else if (item.sourceType === 'youtube' || item.sourceType === 'url') {
            return { url: item.sourceData.url, name: item.name };
          } else if (item.sourceType === 'file') {
            return { filename: item.sourceData.filename };
          }
          return item;
        }),
        loop: Boolean(row.loop),
        showIntros: Boolean(row.show_intros),
        introDuration: row.intro_duration,
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
          cacheBody.creationId = item.sourceData.id;
          cacheBody.db = item.sourceData.db;
        } else if (item.sourceType === 'eden_collection') {
          cacheBody.collectionId = item.sourceData.id;
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

  // Node commands: /api/nodes/:id/:action
  if (method === 'POST' && url.pathname.startsWith('/api/nodes/')) {
    const parts = url.pathname.split('/');
    const nodeId = parts[3];
    const action = parts[4];

    if (!nodeId || !action) {
      sendError(res, 'Invalid endpoint');
      return;
    }

    const node = state.nodes.get(nodeId);
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

      const status: NodeStatus = {
        node: info,
        connected: true,
        lastSeen: Date.now(),
        playbackState: {
          mode: 'off',
          playlistIndex: 0,
          loop: true,
          paused: false,
          volume: 100,
        },
        cachedContent: [],
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

    default:
      logger.warn('Unknown message type', { type: (message as { type: string }).type });
  }
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
    logger.info(`WebSocket endpoints: /ws/nodes, /ws/dashboard`);

    // Start node timeout monitoring
    startNodeTimeoutCheck();
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down...');
    stopNodeTimeoutCheck();
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
