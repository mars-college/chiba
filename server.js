#!/usr/bin/env node
/**
 * Kiosk Signage Server
 * Optimized for Raspberry Pi - minimal memory, efficient streaming
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MEDIA_DIR = path.join(__dirname, 'media');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// State
let state = { mode: 'off', file: null, url: null };
const wsClients = new Set();

// Minimal logging in production
const log = IS_PRODUCTION
  ? () => {}
  : (msg) => console.log(`[server] ${msg}`);

// Broadcast state to all WebSocket clients
function broadcast() {
  const msg = JSON.stringify({ type: 'state', ...state });
  for (const ws of wsClients) {
    if (ws.readyState === 1) {
      ws.send(msg, { binary: false });
    }
  }
}

// MIME types (only what we need)
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
};

// Efficient file streaming with range support
function serveFile(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.stat(filePath, (err, stats) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"Not found"}');
      return;
    }

    const headers = {
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': contentType.startsWith('video/') ? 'no-cache' : 'public, max-age=31536000',
    };

    // Range request for video streaming
    const range = req.headers.range;
    if (range && contentType.startsWith('video/')) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 1024 * 1024, stats.size - 1); // 1MB chunks
      const chunkSize = end - start + 1;

      headers['Content-Range'] = `bytes ${start}-${end}/${stats.size}`;
      headers['Content-Length'] = chunkSize;

      res.writeHead(206, headers);
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      headers['Content-Length'] = stats.size;
      res.writeHead(200, headers);
      fs.createReadStream(filePath).pipe(res);
    }
  });
}

// Read JSON body efficiently
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve({});
      }
    });
  });
}

// JSON response helper
function jsonResponse(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

// HTTP server
const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // GET routes
  if (req.method === 'GET') {
    switch (urlPath) {
      case '/':
        jsonResponse(res, { service: 'kiosk-server', endpoints: ['/status', '/files', '/file', '/url', '/off'] });
        break;
      case '/status':
        jsonResponse(res, { ...state, wsClients: wsClients.size });
        break;
      case '/files':
        try {
          const files = fs.readdirSync(MEDIA_DIR)
            .filter(f => !f.endsWith('.html') && !f.startsWith('assets') && !f.startsWith('.'));
          jsonResponse(res, { files });
        } catch {
          jsonResponse(res, { files: [] });
        }
        break;
      case '/player':
        serveFile(req, res, path.join(PUBLIC_DIR, 'index.html'));
        break;
      default:
        if (urlPath.startsWith('/assets/')) {
          serveFile(req, res, path.join(PUBLIC_DIR, urlPath));
        } else if (urlPath.startsWith('/media/')) {
          serveFile(req, res, path.join(MEDIA_DIR, urlPath.slice(7)));
        } else {
          jsonResponse(res, { error: 'Not found' }, 404);
        }
    }
    return;
  }

  // POST routes
  if (req.method === 'POST') {
    const body = await readBody(req);

    switch (urlPath) {
      case '/file': {
        const filename = body.file;
        if (!filename) {
          jsonResponse(res, { error: 'Missing file parameter' }, 400);
          return;
        }
        const filePath = path.join(MEDIA_DIR, filename);
        if (!fs.existsSync(filePath)) {
          jsonResponse(res, { error: `File not found: ${filename}` }, 400);
          return;
        }
        state = { mode: 'video', file: filename, url: null };
        broadcast();
        log(`Playing: ${filename}`);
        jsonResponse(res, { status: 'ok', ...state });
        break;
      }
      case '/url': {
        const url = body.url;
        if (!url) {
          jsonResponse(res, { error: 'Missing url parameter' }, 400);
          return;
        }
        state = { mode: 'url', file: null, url };
        broadcast();
        log(`URL: ${url}`);
        jsonResponse(res, { status: 'ok', ...state });
        break;
      }
      case '/off':
        state = { mode: 'off', file: null, url: null };
        broadcast();
        log('Display off');
        jsonResponse(res, { status: 'ok', ...state });
        break;
      default:
        jsonResponse(res, { error: 'Not found' }, 404);
    }
    return;
  }

  jsonResponse(res, { error: 'Method not allowed' }, 405);
});

// WebSocket server on same port (memory efficient)
const wss = new WebSocketServer({
  server,
  perMessageDeflate: false, // Disable compression to save CPU
  maxPayload: 1024, // Small messages only
});

wss.on('connection', (ws) => {
  wsClients.add(ws);
  log(`WS connected (${wsClients.size} clients)`);

  // Send current state immediately
  ws.send(JSON.stringify({ type: 'state', ...state }));

  ws.on('close', () => {
    wsClients.delete(ws);
    log(`WS disconnected (${wsClients.size} clients)`);
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'ready') {
        ws.send(JSON.stringify({ type: 'state', ...state }));
      }
    } catch {}
  });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Kiosk server running on http://0.0.0.0:${PORT}`);
  console.log(`Player: http://localhost:${PORT}/player`);
  console.log(`Media dir: ${MEDIA_DIR}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  wss.close();
  server.close();
  process.exit(0);
});
