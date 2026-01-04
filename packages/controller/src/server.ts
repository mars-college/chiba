/**
 * Controller HTTP/WebSocket server for Chiba digital signage system.
 *
 * This is the central controller that:
 * - Manages node registration and status
 * - Proxies commands to individual nodes
 * - Serves the admin dashboard
 * - Provides WebSocket connections for real-time updates
 */

import http from 'http';
import https from 'https';
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
      case '/':
        sendJson(res, {
          name: 'chiba-controller',
          version: VERSION,
          endpoints: [
            'GET /',
            'GET /api/nodes',
            'GET /api/nodes/:id',
            'POST /api/nodes/register',
            'POST /api/nodes/:id/play',
            'POST /api/nodes/:id/pause',
            'POST /api/nodes/:id/stop',
            'POST /api/nodes/:id/cache',
            'GET /api/content',
            'GET /api/playlists',
          ],
        });
        return;

      case '/health':
        sendJson(res, { status: 'ok', uptime: process.uptime() });
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

      case '/api/playlists':
        // Playlists (stub - returns empty for now)
        sendJson(res, { success: true, data: [] });
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

  // Create playlist (stub for now)
  if (method === 'POST' && url.pathname === '/api/playlists') {
    const body = await readJsonBody<{ name: string; items?: unknown[]; loop?: boolean }>(req);
    if (!body) {
      sendError(res, 'Invalid JSON body');
      return;
    }
    logger.info('Create playlist request', body);
    // TODO: Store in database
    sendJson(res, {
      success: true,
      data: { id: crypto.randomUUID(), name: body.name, items: [], loop: body.loop ?? true },
    });
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
