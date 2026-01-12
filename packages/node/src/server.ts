/**
 * Node HTTP/WebSocket server for Chiba digital signage system.
 *
 * This runs on each Raspberry Pi and:
 * - Serves the player application
 * - Manages content caching
 * - Handles playback control
 * - Connects to the central controller
 */

import dotenv from 'dotenv';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { WebSocketServer, WebSocket } from 'ws';
import os from 'os';

// ES modules don't have __dirname, so we create it
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root (for local dev) or current dir (for Pi deployment)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config(); // Also check current working directory
import {
  createLogger,
  DEFAULT_PORT,
  VERSION,
  DEFAULT_PLAYBACK_STATE,
  HEARTBEAT_INTERVAL,
  type PlaybackState,
  type NodeInfo,
  type NodeConfig,
  type NodeStatus,
  type DiskUsage,
  type HardwareMetrics,
  type ContentSummary,
  type PlaylistItem,
  type NodeToControllerMessage,
  type ControllerToNodeMessage,
  type PlayerToNodeMessage,
  type DisplayRotation,
} from '@chiba/shared';
import { initDatabase, closeDatabase, setConfig, getAllConfig, listPlaylists } from './db/index.js';
import { getMediaDir, listCachedContent, getCacheSize, getContentByFilename, clearAllCache } from './services/content-cache.js';
import { getDiskUsage as getDiskUsageActual, getHardwareMetrics as getHardwareMetricsActual } from './services/hardware.js';
import { isYouTubeUrl } from './services/youtube.js';
import { isEdenUrl, parseEdenUrl } from './services/eden.js';
import {
  playbackManager,
  addPlayerClient,
  removePlayerClient,
  playContent,
  playPlaylist,
  playUrl,
  stopPlayback,
  pausePlayback,
  resumePlayback,
  nextItem,
  previousItem,
  setPlaybackVolume,
  setImageDuration,
  handleContentEnded,
  handleIntroComplete,
  appendItems,
} from './services/playback.js';
import { getTaskQueue, type TaskSource } from './services/task-queue.js';

const logger = createLogger('node', 'server');

// ============================================================================
// Server State
// ============================================================================

interface ServerState {
  /** Current playback state */
  playback: PlaybackState;
  /** Connected player clients */
  playerClients: Set<WebSocket>;
  /** Connection to controller */
  controllerWs: WebSocket | null;
  /** Node configuration */
  config: NodeConfig;
  /** Server start time */
  startTime: number;
  /** Controller reconnect timer */
  reconnectTimer: NodeJS.Timeout | null;
  /** Heartbeat timer */
  heartbeatTimer: NodeJS.Timeout | null;
}

const state: ServerState = {
  playback: { ...DEFAULT_PLAYBACK_STATE },
  playerClients: new Set(),
  controllerWs: null,
  config: {
    id: '',
    friendlyName: 'unnamed-node',
    controllerUrl: '',
  },
  startTime: Date.now(),
  reconnectTimer: null,
  heartbeatTimer: null,
};

// ============================================================================
// Node Information
// ============================================================================

// Display rotation config file path (must match rotate-display.sh)
const CHIBA_DIR = process.env.CHIBA_DIR || '/home/pi/chiba';
const ROTATION_CONFIG_FILE = path.join(CHIBA_DIR, '.display-rotate');

/**
 * Get the current display rotation from config file.
 */
function getDisplayRotation(): DisplayRotation {
  try {
    if (fs.existsSync(ROTATION_CONFIG_FILE)) {
      const value = fs.readFileSync(ROTATION_CONFIG_FILE, 'utf-8').trim();
      const rotation = parseInt(value, 10);
      if (rotation === 0 || rotation === 90 || rotation === 180 || rotation === 270) {
        return rotation;
      }
    }
  } catch {
    // Ignore errors, return default
  }
  return 0;
}

/**
 * Set display rotation - applies immediately and persists for reboot.
 * Returns true on success, false on failure.
 */
function setDisplayRotation(rotation: DisplayRotation): { success: boolean; error?: string } {
  try {
    // Save to config file for persistence across reboots
    fs.mkdirSync(path.dirname(ROTATION_CONFIG_FILE), { recursive: true });
    fs.writeFileSync(ROTATION_CONFIG_FILE, String(rotation));
    logger.info('Saved rotation config', { rotation, file: ROTATION_CONFIG_FILE });

    // Try to apply immediately using wlr-randr (only works if Wayland is running)
    try {
      // Detect the output name
      const wlrOutput = execSync('wlr-randr 2>/dev/null | grep -E "^[A-Z]+-[A-Z]?-?[0-9]+" | head -1 | awk \'{print $1}\'', {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();

      if (wlrOutput) {
        execSync(`wlr-randr --output "${wlrOutput}" --transform ${rotation}`, {
          encoding: 'utf-8',
          timeout: 5000,
        });
        logger.info('Applied rotation immediately', { output: wlrOutput, rotation });
      } else {
        logger.info('No Wayland display detected, rotation will apply on next boot');
      }
    } catch {
      // wlr-randr not available or failed - that's OK, rotation will apply on reboot
      logger.info('Could not apply rotation immediately (Wayland not running?), will apply on next boot');
    }

    return { success: true };
  } catch (err) {
    const error = (err as Error).message;
    logger.error('Failed to set rotation', err as Error);
    return { success: false, error };
  }
}

/**
 * Get the node's IP address.
 */
function getIpAddress(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (!iface) continue;

    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address;
      }
    }
  }
  return '127.0.0.1';
}

/**
 * Get node information.
 */
function getNodeInfo(): NodeInfo {
  return {
    id: state.config.id,
    friendlyName: state.config.friendlyName,
    hostname: os.hostname(),
    ip: getIpAddress(),
    port: parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10),
    version: VERSION,
    uptime: Math.floor((Date.now() - state.startTime) / 1000),
    displayRotation: getDisplayRotation(),
  };
}

/**
 * Get disk usage information.
 */
function getDiskUsage(): DiskUsage {
  return getDiskUsageActual();
}

/**
 * Get hardware metrics.
 */
function getHardwareMetrics(): HardwareMetrics {
  return getHardwareMetricsActual();
}

/**
 * Get cached content list.
 */
function getCachedContent(): ContentSummary[] {
  const content = listCachedContent();
  return content.map(c => ({
    hash: c.hash,
    filename: c.filename,
    name: c.name || c.metadata?.title, // Use name or metadata title
    type: c.type,
    sizeBytes: c.sizeBytes,
    cachedAt: c.createdAt, // Content uses createdAt, ContentSummary uses cachedAt
  }));
}

/**
 * Get full node status.
 */
function getNodeStatus(): NodeStatus {
  return {
    node: getNodeInfo(),
    connected: state.controllerWs?.readyState === WebSocket.OPEN,
    lastSeen: Date.now(),
    playbackState: playbackManager.getState(),
    cachedContent: getCachedContent(),
    diskUsage: getDiskUsage(),
    hardware: getHardwareMetrics(),
  };
}

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
  if (!apiKey) return true;

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
          name: 'chiba-node',
          version: VERSION,
          friendlyName: state.config.friendlyName,
          nodeId: state.config.id,
          uptime: Math.floor((Date.now() - state.startTime) / 1000),
        });
        return;

      case '/health':
        sendJson(res, { status: 'ok', uptime: process.uptime() });
        return;

      case '/status':
        sendJson(res, {
          success: true,
          data: {
            node: getNodeInfo(),
            playback: playbackManager.getState(),
            controllerConnected:
              state.controllerWs?.readyState === WebSocket.OPEN,
            wsClients: state.playerClients.size,
          },
        });
        return;

      case '/files':
        sendJson(res, {
          success: true,
          data: {
            files: getCachedContent(),
            totalBytes: 0,
            count: 0,
          },
        });
        return;

      case '/debug': {
        const cachedContent = getCachedContent();
        const totalCacheSize = getCacheSize();
        const playlists = listPlaylists();
        const currentState = playbackManager.getState();
        const ipAddress = getIpAddress();
        // Network is only truly online if we have a real IP (not loopback)
        const hasRealIp = ipAddress !== '127.0.0.1' && ipAddress !== '::1';
        const isControllerConnected = state.controllerWs?.readyState === WebSocket.OPEN;

        sendJson(res, {
          nodeName: state.config.friendlyName,
          nodeId: state.config.id,
          ipAddress,
          networkStatus: hasRealIp ? 'online' : 'offline',
          controllerStatus: hasRealIp && isControllerConnected ? 'online' : 'offline',
          content: cachedContent.map(c => ({
            filename: c.filename,
            sizeBytes: c.sizeBytes,
            type: c.type,
            name: c.name,
          })),
          totalCacheSize,
          playlists: playlists.map(p => ({
            id: p.id,
            name: p.name,
            itemCount: p.items.length,
            loop: p.loop,
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
          })),
          currentPlaylist: currentState.playlist ? {
            id: currentState.playlist.id,
            name: currentState.playlist.name,
            currentIndex: currentState.playlistIndex,
            totalItems: currentState.playlist.items.length,
          } : null,
        });
        return;
      }
    }

    // Serve media files
    if (url.pathname.startsWith('/media/')) {
      const filename = decodeURIComponent(url.pathname.slice(7)); // Remove '/media/'
      const mediaDir = getMediaDir();
      const filePath = path.join(mediaDir, filename);

      // Security: ensure path is within media directory
      const realPath = path.resolve(filePath);
      if (!realPath.startsWith(path.resolve(mediaDir))) {
        sendError(res, 'Invalid path', 403);
        return;
      }

      // Check if file exists
      if (!fs.existsSync(realPath)) {
        sendError(res, 'File not found', 404);
        return;
      }

      // Determine content type
      const ext = path.extname(filename).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mkv': 'video/x-matroska',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      // Get file stats
      const stat = fs.statSync(realPath);
      const fileSize = stat.size;

      // Handle range requests for video streaming
      const range = req.headers.range;
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0] ?? '0', 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;

        const stream = fs.createReadStream(realPath, { start, end });
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
        });
        stream.pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': fileSize,
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
        });
        fs.createReadStream(realPath).pipe(res);
      }
      return;
    }

    // Serve player app
    if (url.pathname === '/player' || url.pathname.startsWith('/player/')) {
      const playerDistDir = path.join(__dirname, '../../player/dist');

      // Map /player to index.html, /player/assets/... to assets/...
      let filePath: string;
      if (url.pathname === '/player' || url.pathname === '/player/') {
        filePath = path.join(playerDistDir, 'index.html');
      } else {
        const relativePath = url.pathname.slice('/player/'.length);
        filePath = path.join(playerDistDir, relativePath);
      }

      // Security: ensure path is within player dist directory
      const realPath = path.resolve(filePath);
      if (!realPath.startsWith(path.resolve(playerDistDir))) {
        sendError(res, 'Invalid path', 403);
        return;
      }

      // Check if file exists
      if (!fs.existsSync(realPath)) {
        // For SPA routing, serve index.html for non-asset paths
        const indexPath = path.join(playerDistDir, 'index.html');
        if (fs.existsSync(indexPath)) {
          res.writeHead(200, {
            'Content-Type': 'text/html',
            'Access-Control-Allow-Origin': '*',
          });
          fs.createReadStream(indexPath).pipe(res);
          return;
        }
        sendError(res, 'Player not found - run pnpm build', 404);
        return;
      }

      // Determine content type
      const ext = path.extname(realPath).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';

      res.writeHead(200, {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
      });
      fs.createReadStream(realPath).pipe(res);
      return;
    }
  }

  // Protected routes (require auth)
  if (!isAuthenticated(req)) {
    sendError(res, 'Unauthorized', 401);
    return;
  }

  if (method === 'POST') {
    const body = await readJsonBody<Record<string, unknown>>(req);

    switch (url.pathname) {
      case '/play': {
        // Play content - auto-detects source type
        // Accepts: filename, url (auto-detects YouTube/media/Eden), collectionId (Eden), creationId (Eden), content, playlist
        // For content that needs downloading, returns immediately with taskId and plays when download completes
        logger.info('Play command received', body as Record<string, unknown>);

        const urlToPlay = body?.url as string | undefined;
        const filenameToPlay = body?.filename as string | undefined;
        const collectionId = body?.collectionId as string | undefined;
        const creationId = body?.creationId as string | undefined;
        const db = (body?.db as 'PROD' | 'STAGE') || 'PROD';
        const contentName = body?.name as string | undefined;

        const taskQueue = getTaskQueue();

        // Eden single creation by ID - async with playAfter
        if (creationId) {
          logger.info('Queuing Eden creation for play', { creationId, db });
          const taskId = taskQueue.enqueue({
            type: 'eden',
            source: { creationId, db },
            metadata: contentName ? { name: contentName } : undefined,
            playAfter: true,
            priority: 10, // Higher priority than cache-only tasks
          });
          sendJson(res, {
            success: true,
            data: {
              taskId,
              status: 'queued',
              message: 'Eden creation download queued, will play when complete',
            },
          });
          return;
        }

        // Eden collection - async with playAfter
        if (collectionId) {
          logger.info('Queuing Eden collection for play', { collectionId, db });
          const taskId = taskQueue.enqueue({
            type: 'eden',
            source: { collectionId, db },
            metadata: contentName ? { name: contentName } : undefined,
            playAfter: true,
            priority: 10,
          });
          sendJson(res, {
            success: true,
            data: {
              taskId,
              status: 'queued',
              message: 'Eden collection sync queued, will play when complete',
            },
          });
          return;
        }

        // Cached file by filename - play immediately (synchronous)
        if (filenameToPlay) {
          const content = getContentByFilename(filenameToPlay);
          if (!content) {
            sendError(res, `File not found in cache: ${filenameToPlay}`, 404);
            return;
          }
          const playOptions = {
            loop: body?.loop !== false,
            showIntro: body?.showIntro === true,
          };
          playContent(content, playOptions);
          sendJson(res, { success: true, data: { state: playbackManager.getState() } });
          return;
        }

        // URL - auto-detect type
        if (urlToPlay) {
          // Eden URL (creation or collection) - async with playAfter
          if (isEdenUrl(urlToPlay)) {
            const edenInfo = parseEdenUrl(urlToPlay);
            if (edenInfo?.type === 'creation') {
              logger.info('Queuing Eden creation URL for play', { url: urlToPlay, id: edenInfo.id });
              const taskId = taskQueue.enqueue({
                type: 'eden',
                source: { creationId: edenInfo.id, db: edenInfo.db },
                metadata: contentName ? { name: contentName } : undefined,
                playAfter: true,
                priority: 10,
              });
              sendJson(res, {
                success: true,
                data: {
                  taskId,
                  status: 'queued',
                  message: 'Eden creation download queued, will play when complete',
                },
              });
              return;
            } else if (edenInfo?.type === 'collection') {
              logger.info('Queuing Eden collection URL for play', { url: urlToPlay, id: edenInfo.id });
              const taskId = taskQueue.enqueue({
                type: 'eden',
                source: { collectionId: edenInfo.id, db: edenInfo.db },
                metadata: contentName ? { name: contentName } : undefined,
                playAfter: true,
                priority: 10,
              });
              sendJson(res, {
                success: true,
                data: {
                  taskId,
                  status: 'queued',
                  message: 'Eden collection sync queued, will play when complete',
                },
              });
              return;
            }
          }

          // YouTube - async with playAfter
          if (isYouTubeUrl(urlToPlay)) {
            logger.info('Queuing YouTube for play', { url: urlToPlay });
            const taskId = taskQueue.enqueue({
              type: 'youtube',
              source: { url: urlToPlay },
              metadata: contentName ? { name: contentName } : undefined,
              playAfter: true,
              priority: 10,
            });
            sendJson(res, {
              success: true,
              data: {
                taskId,
                status: 'queued',
                message: 'YouTube download queued, will play when complete',
              },
            });
            return;
          }

          // Media file URL - async with playAfter
          const urlLower = urlToPlay.toLowerCase();
          const isMedia = /\.(mp4|webm|mov|mkv|jpg|jpeg|png|gif|webp)(\?|$)/i.test(urlLower);

          if (isMedia) {
            logger.info('Queuing media URL for play', { url: urlToPlay });
            const taskId = taskQueue.enqueue({
              type: 'cache',
              source: { url: urlToPlay },
              metadata: contentName ? { name: contentName } : undefined,
              playAfter: true,
              priority: 10,
            });
            sendJson(res, {
              success: true,
              data: {
                taskId,
                status: 'queued',
                message: 'Media download queued, will play when complete',
              },
            });
            return;
          }

          // Non-media URL - iframe mode (synchronous, no download needed)
          playUrl(urlToPlay);
          sendJson(res, { success: true, data: { state: playbackManager.getState() } });
          return;
        }

        // Direct content object - play immediately (synchronous)
        if (body?.content) {
          const content = body.content as import('@chiba/shared').Content;
          const playOptions = {
            loop: body?.loop !== false,
            showIntro: body?.showIntro === true,
          };
          playContent(content, playOptions);
          sendJson(res, { success: true, data: { state: playbackManager.getState() } });
          return;
        }

        // Playlist object - play immediately (synchronous)
        if (body?.playlist) {
          const playlist = body.playlist as import('@chiba/shared').Playlist;
          const startIndex = (body.startIndex as number) ?? 0;
          playPlaylist(playlist, startIndex);
          sendJson(res, { success: true, data: { state: playbackManager.getState() } });
          return;
        }

        sendError(res, 'Missing filename, url, collectionId, creationId, content, or playlist');
        return;
      }

      case '/pause':
        pausePlayback();
        sendJson(res, { success: true, data: { state: playbackManager.getState() } });
        return;

      case '/resume':
        resumePlayback();
        sendJson(res, { success: true, data: { state: playbackManager.getState() } });
        return;

      case '/stop':
        stopPlayback();
        sendJson(res, { success: true, data: { state: playbackManager.getState() } });
        return;

      case '/next':
        nextItem();
        sendJson(res, { success: true, data: { state: playbackManager.getState() } });
        return;

      case '/previous':
        previousItem();
        sendJson(res, { success: true, data: { state: playbackManager.getState() } });
        return;

      case '/volume': {
        // Accept either 'level' or 'volume' for compatibility
        const level = (body?.level as number) ?? (body?.volume as number) ?? 100;
        const success = setPlaybackVolume(level);
        sendJson(res, { success, data: { volume: playbackManager.getState().volume } });
        return;
      }

      case '/loop': {
        const enabled = body?.enabled as boolean ?? !playbackManager.getState().loop;
        playbackManager.setLoop(enabled);
        sendJson(res, { success: true, data: { loop: playbackManager.getState().loop } });
        return;
      }

      case '/image-duration': {
        const duration = body?.duration as number | undefined;
        if (duration === undefined || typeof duration !== 'number') {
          sendError(res, 'Duration (in ms) is required', 400);
          return;
        }
        setImageDuration(duration);
        sendJson(res, { success: true, data: { imageDuration: playbackManager.getState().imageDuration } });
        return;
      }

      case '/cache': {
        // Cache content without playing - async via task queue
        // Accepts: url (auto-detects YouTube/Eden), OR collectionId/creationId for Eden
        const cacheUrl = body?.url as string | undefined;
        const cacheName = body?.name as string | undefined;
        const collectionId = body?.collectionId as string | undefined;
        const creationId = body?.creationId as string | undefined;
        const db = (body?.db as 'PROD' | 'STAGE') || 'PROD';

        const taskQueue = getTaskQueue();

        // Eden single creation by ID
        if (creationId) {
          logger.info('Queuing Eden creation cache', { creationId, db });
          const taskId = taskQueue.enqueue({
            type: 'eden',
            source: { creationId, db },
            metadata: cacheName ? { name: cacheName } : undefined,
            playAfter: false,
            priority: 0,
          });
          sendJson(res, {
            success: true,
            data: {
              taskId,
              status: 'queued',
              message: 'Eden creation download queued',
            },
          });
          return;
        }

        // Eden collection
        if (collectionId) {
          logger.info('Queuing Eden collection cache', { collectionId, db });
          const taskId = taskQueue.enqueue({
            type: 'eden',
            source: { collectionId, db },
            metadata: cacheName ? { name: cacheName } : undefined,
            playAfter: false,
            priority: 0,
          });
          sendJson(res, {
            success: true,
            data: {
              taskId,
              status: 'queued',
              message: 'Eden collection sync queued',
            },
          });
          return;
        }

        // URL (auto-detects Eden/YouTube/media)
        if (!cacheUrl) {
          sendError(res, 'Missing url, collectionId, or creationId parameter');
          return;
        }

        logger.info('Queuing URL cache', { url: cacheUrl, name: cacheName });

        // Determine task type based on URL
        let taskType: 'youtube' | 'eden' | 'cache' = 'cache';
        const source: TaskSource = { url: cacheUrl };

        if (isEdenUrl(cacheUrl)) {
          const edenInfo = parseEdenUrl(cacheUrl);
          if (edenInfo?.type === 'creation') {
            taskType = 'eden';
            source.creationId = edenInfo.id;
            source.db = edenInfo.db;
            delete source.url;
          } else if (edenInfo?.type === 'collection') {
            taskType = 'eden';
            source.collectionId = edenInfo.id;
            source.db = edenInfo.db;
            delete source.url;
          }
        } else if (isYouTubeUrl(cacheUrl)) {
          taskType = 'youtube';
        }

        const taskId = taskQueue.enqueue({
          type: taskType,
          source,
          metadata: cacheName ? { name: cacheName } : undefined,
          playAfter: false,
          priority: 0,
        });

        sendJson(res, {
          success: true,
          data: {
            taskId,
            status: 'queued',
            message: 'Download queued',
          },
        });
        return;
      }

      case '/append': {
        // Append items to current playlist (or create new one)
        logger.info('Append command received', body as Record<string, unknown>);

        const items = body?.items as PlaylistItem[] | undefined;
        const name = body?.name as string | undefined;
        const loop = body?.loop as boolean | undefined;
        const showIntros = body?.showIntros as boolean | undefined;

        if (!items || !Array.isArray(items) || items.length === 0) {
          sendError(res, 'Missing or empty items array', 400);
          return;
        }

        // Validate items have required fields
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (!item || !item.id || !item.content) {
            sendError(res, `Invalid item at index ${i}: missing id or content`, 400);
            return;
          }
        }

        try {
          const playlist = appendItems(items, { name, loop, showIntros });
          sendJson(res, {
            success: true,
            data: {
              playlist,
              state: playbackManager.getState(),
            },
          });
        } catch (err) {
          sendError(res, (err as Error).message);
        }
        return;
      }

      case '/clear-cache': {
        logger.info('Clear cache command received');
        // Stop playback first if something is playing
        if (playbackManager.getState().mode !== 'off') {
          stopPlayback();
        }
        const result = clearAllCache();
        logger.info('Cache cleared', result);
        sendJson(res, {
          success: true,
          data: {
            deletedCount: result.deletedCount,
            freedBytes: result.freedBytes,
          },
        });
        return;
      }

      case '/exit-kiosk': {
        // Exit kiosk mode by killing cage directly
        logger.info('Exit kiosk command received');
        try {
          // Kill cage (Wayland compositor) which will exit the kiosk
          execSync('pkill -9 cage 2>/dev/null || true', { encoding: 'utf-8' });
          // Also write signal file for newer run-kiosk.sh versions
          fs.writeFileSync('/tmp/chiba-exit-kiosk', Date.now().toString());
          logger.info('Cage killed, kiosk should exit');
          sendJson(res, {
            success: true,
            message: 'Kiosk killed',
          });
        } catch (err) {
          logger.error('Failed to kill kiosk', err as Error);
          sendError(res, 'Failed to kill kiosk', 500);
        }
        return;
      }

      case '/rename': {
        // Rename the node's friendly name
        const newName = body?.name as string | undefined;
        if (!newName || typeof newName !== 'string' || newName.trim() === '') {
          sendError(res, 'Missing or invalid name parameter', 400);
          return;
        }

        const trimmedName = newName.trim();
        const oldName = state.config.friendlyName;
        logger.info('Rename command received', { oldName, newName: trimmedName });

        // Update runtime state
        state.config.friendlyName = trimmedName;

        // Persist to database
        setConfig('node.friendly_name', trimmedName);

        // Send state update to controller so dashboard updates
        sendStateToController(playbackManager.getState());

        // Also send a heartbeat with the new name
        if (state.controllerWs?.readyState === WebSocket.OPEN) {
          const heartbeatMessage: NodeToControllerMessage = {
            type: 'heartbeat',
            status: getNodeStatus(),
          };
          state.controllerWs.send(JSON.stringify(heartbeatMessage));
        }

        logger.info('Node renamed', { oldName, newName: trimmedName });
        sendJson(res, {
          success: true,
          data: {
            oldName,
            newName: trimmedName,
          },
        });
        return;
      }

      case '/rotate': {
        // Rotate the display (0, 90, 180, 270 degrees)
        const rotation = body?.rotation as number | undefined;
        if (rotation === undefined || typeof rotation !== 'number') {
          sendError(res, 'Missing rotation parameter (0, 90, 180, or 270)', 400);
          return;
        }

        // Validate rotation value
        if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) {
          sendError(res, 'Invalid rotation value. Must be 0, 90, 180, or 270', 400);
          return;
        }

        const oldRotation = getDisplayRotation();
        logger.info('Rotate command received', { oldRotation, newRotation: rotation });

        const result = setDisplayRotation(rotation as DisplayRotation);
        if (!result.success) {
          sendError(res, result.error || 'Failed to set rotation', 500);
          return;
        }

        // Send a heartbeat with the new rotation so dashboard updates
        if (state.controllerWs?.readyState === WebSocket.OPEN) {
          const heartbeatMessage: NodeToControllerMessage = {
            type: 'heartbeat',
            status: getNodeStatus(),
          };
          state.controllerWs.send(JSON.stringify(heartbeatMessage));
        }

        logger.info('Display rotated', { oldRotation, newRotation: rotation });
        sendJson(res, {
          success: true,
          data: {
            oldRotation,
            newRotation: rotation,
            appliedImmediately: true, // Best effort - may have been saved for reboot
          },
        });
        return;
      }
    }
  }

  // 404 for unhandled routes
  sendError(res, 'Not found', 404);
}

// ============================================================================
// WebSocket - Player Connection
// ============================================================================

/**
 * Handle WebSocket connections from the player.
 */
function handlePlayerConnection(ws: WebSocket): void {
  logger.info('Player WebSocket connected');
  state.playerClients.add(ws);

  // Register with playback manager
  addPlayerClient(ws);

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString()) as PlayerToNodeMessage;
      handlePlayerMessage(ws, message);
    } catch (error) {
      logger.error('Failed to parse player message', error as Error);
    }
  });

  ws.on('close', () => {
    logger.info('Player disconnected');
    state.playerClients.delete(ws);
    removePlayerClient(ws);
  });

  ws.on('error', (error) => {
    logger.error('Player WebSocket error', error);
  });
}

/**
 * Handle messages from player.
 */
function handlePlayerMessage(_ws: WebSocket, message: PlayerToNodeMessage): void {
  logger.debug('Player message', { type: message.type });

  switch (message.type) {
    case 'ready':
      logger.info('Player ready');
      break;

    case 'ended':
      logger.info('Content ended');
      handleContentEnded();
      break;

    case 'intro_complete':
      logger.info('Intro complete');
      handleIntroComplete();
      break;

    case 'error':
      logger.error('Player error', new Error(message.error));
      break;

    default:
      logger.warn('Unknown player message type', {
        type: (message as { type: string }).type,
      });
  }
}

// NOTE: Broadcasting to players is handled by the playbackService itself.
// The playbackService has addPlayerClient/removePlayerClient methods that
// automatically broadcast state changes to connected player WebSocket clients.

// ============================================================================
// WebSocket - Controller Connection
// ============================================================================

/**
 * Connect to the central controller.
 */
function connectToController(): void {
  if (!state.config.controllerUrl) {
    logger.debug('No controller URL configured, skipping connection');
    return;
  }

  const wsUrl = state.config.controllerUrl.replace(/^http/, 'ws') + '/ws/nodes';
  logger.info('Connecting to controller', { url: wsUrl });

  try {
    const ws = new WebSocket(wsUrl);

    ws.on('open', () => {
      logger.info('Connected to controller');
      state.controllerWs = ws;

      // Send registration
      const registerMessage: NodeToControllerMessage = {
        type: 'register',
        config: state.config,
        info: getNodeInfo(),
      };
      ws.send(JSON.stringify(registerMessage));

      // Start heartbeat
      startHeartbeat();
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as ControllerToNodeMessage;
        handleControllerMessage(message);
      } catch (error) {
        logger.error('Failed to parse controller message', error as Error);
      }
    });

    ws.on('close', () => {
      logger.warn('Controller connection closed');
      state.controllerWs = null;
      stopHeartbeat();
      scheduleReconnect();
    });

    ws.on('error', (error) => {
      logger.error('Controller WebSocket error', error);
      state.controllerWs = null;
      stopHeartbeat();
      scheduleReconnect();
    });
  } catch (error) {
    logger.error('Failed to connect to controller', error as Error);
    scheduleReconnect();
  }
}

/**
 * Handle messages from controller.
 */
function handleControllerMessage(message: ControllerToNodeMessage): void {
  logger.debug('Controller message', { type: message.type });

  switch (message.type) {
    case 'command': {
      const { command } = message;
      logger.info('Received command from controller', { action: command.action });
      // TODO: Execute command
      break;
    }

    case 'preload': {
      const { content } = message;
      logger.info('Received preload request', { count: content.length });
      // TODO: Queue downloads
      break;
    }

    case 'ping': {
      const pongMessage: NodeToControllerMessage = {
        type: 'pong',
        timestamp: message.timestamp,
      };
      state.controllerWs?.send(JSON.stringify(pongMessage));
      break;
    }

    case 'config': {
      logger.info('Received config update', message.config);
      // TODO: Apply config updates
      break;
    }

    default:
      logger.warn('Unknown controller message type', {
        type: (message as { type: string }).type,
      });
  }
}

/**
 * Start sending heartbeats to controller.
 */
function startHeartbeat(): void {
  stopHeartbeat();

  state.heartbeatTimer = setInterval(() => {
    if (state.controllerWs?.readyState === WebSocket.OPEN) {
      const heartbeatMessage: NodeToControllerMessage = {
        type: 'heartbeat',
        status: getNodeStatus(),
      };
      state.controllerWs.send(JSON.stringify(heartbeatMessage));
      logger.debug('Heartbeat sent');
    }
  }, HEARTBEAT_INTERVAL);
}

/**
 * Stop heartbeat timer.
 */
function stopHeartbeat(): void {
  if (state.heartbeatTimer) {
    clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }
}

/**
 * Schedule reconnection to controller.
 */
function scheduleReconnect(): void {
  if (state.reconnectTimer) {
    return;
  }

  logger.info('Scheduling reconnection in 5 seconds');
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    connectToController();
  }, 5000);
}

// ============================================================================
// Server Startup
// ============================================================================

/**
 * Load configuration from database and environment.
 */
function loadConfig(): void {
  // Initialize database first
  initDatabase();

  // Load from database
  const dbConfig = getAllConfig();

  // Build config, preferring environment variables
  // Use || instead of ?? so empty strings fall through to defaults
  state.config = {
    id: process.env.NODE_ID || dbConfig['node.id'] || crypto.randomUUID(),
    friendlyName:
      process.env.NODE_NAME ||
      dbConfig['node.friendly_name'] ||
      'unnamed-node',
    controllerUrl:
      process.env.CONTROLLER_URL || dbConfig['controller.url'] || '',
    apiKey: process.env.API_KEY || dbConfig['controller.api_key'],
  };

  // Persist ID if it was just generated or was empty
  if (!dbConfig['node.id'] || dbConfig['node.id'] === '') {
    setConfig('node.id', state.config.id);
  }

  logger.info('Configuration loaded', {
    id: state.config.id,
    friendlyName: state.config.friendlyName,
    controllerUrl: state.config.controllerUrl || '(not configured)',
  });
}

/**
 * Start the node server.
 */
/**
 * Send playback state update to controller.
 */
function sendStateToController(playback: PlaybackState): void {
  if (state.controllerWs?.readyState === WebSocket.OPEN) {
    const message: NodeToControllerMessage = {
      type: 'state',
      playback,
    };
    state.controllerWs.send(JSON.stringify(message));
    logger.debug('State sent to controller', { mode: playback.mode });
  }
}

export function startServer(port = DEFAULT_PORT): http.Server {
  // Load configuration
  loadConfig();

  // Set up playback state change callback to notify controller
  playbackManager.onStateChange(sendStateToController);

  // Initialize task queue with progress callback
  const taskQueue = getTaskQueue();
  taskQueue.setNodeId(state.config.id);
  taskQueue.setProgressCallback((msg) => {
    if (state.controllerWs?.readyState === WebSocket.OPEN) {
      state.controllerWs.send(JSON.stringify(msg));
      logger.debug('Task progress sent to controller', { taskId: msg.taskId, status: msg.status });
    }
  });
  taskQueue.setPlayCallback((result) => {
    // When a task with playAfter completes, start playback
    if (result.filename) {
      const content = getContentByFilename(result.filename);
      if (content) {
        playContent(content, { loop: true });
        logger.info('Auto-playing content after download', { filename: result.filename });
      }
    }
  });

  // Create HTTP server
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((error) => {
      logger.error('Request handler error', error as Error);
      sendError(res, 'Internal server error', 500);
    });
  });

  // Create WebSocket server for player
  const playerWss = new WebSocketServer({ noServer: true });
  playerWss.on('connection', handlePlayerConnection);

  // Handle upgrade requests
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);

    if (url.pathname === '/ws') {
      playerWss.handleUpgrade(req, socket, head, (ws) => {
        playerWss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  // Start listening
  server.listen(port, () => {
    logger.info(`Node server started`, {
      port,
      version: VERSION,
      friendlyName: state.config.friendlyName,
    });
    logger.info(`WebSocket endpoint: /ws`);

    // Connect to controller
    connectToController();
  });

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down...');
    stopHeartbeat();
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
    }
    state.controllerWs?.close();
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
