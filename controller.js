#!/usr/bin/env node
/**
 * Kiosk Controller - Central routing server
 * Routes commands to individual Pis via mDNS hostnames
 */

require('dotenv').config({ quiet: true });

const http = require('http');
const { execSync } = require('child_process');

const PORT = process.env.PORT || 8080;
const PI_PORT = 8080; // All Pis run on port 8080
const API_KEY = process.env.API_KEY || null;
const DISCOVERY_PREFIX = process.env.DISCOVERY_PREFIX || 'mars';
const DISCOVERY_MAX = parseInt(process.env.DISCOVERY_MAX || '20', 10);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Routes that don't require authentication (public)
const PUBLIC_ROUTES = ['/', '/discover'];

// Minimal logging in production
const log = IS_PRODUCTION
  ? () => {}
  : (msg) => console.log(`[controller] ${msg}`);

// Check if request is authenticated
function isAuthenticated(req) {
  // No API key configured = no auth required
  if (!API_KEY) return true;

  // Check Authorization header: "Bearer <key>"
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (token === API_KEY) return true;
  }

  // Check X-API-Key header
  if (req.headers['x-api-key'] === API_KEY) return true;

  // Check query param ?api_key=xxx (less secure, but convenient)
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.searchParams.get('api_key') === API_KEY) return true;

  return false;
}

// Check if route requires auth
function requiresAuth(method, urlPath) {
  // GET requests to public routes don't need auth
  if (method === 'GET' && PUBLIC_ROUTES.includes(urlPath)) {
    return false;
  }
  // All other requests require auth (if API_KEY is set)
  return true;
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

// Discovery cache
let discoveryCache = { kiosks: [], timestamp: 0 };
const DISCOVERY_CACHE_TTL = 30000; // 30 seconds

/**
 * Discover Pis using mDNS ping
 */
function discoverPis() {
  // Check cache
  if (Date.now() - discoveryCache.timestamp < DISCOVERY_CACHE_TTL) {
    return discoveryCache.kiosks;
  }

  log('Discovering Pis...');
  const kiosks = [];

  for (let i = 1; i <= DISCOVERY_MAX; i++) {
    const num = String(i).padStart(2, '0');
    const hostname = `${DISCOVERY_PREFIX}${num}.local`;
    try {
      // Use ping with 1 second timeout
      const result = execSync(`ping -c1 -t1 "${hostname}" 2>/dev/null | head -1`, {
        encoding: 'utf8',
        timeout: 2000
      });
      const ipMatch = result.match(/\d+\.\d+\.\d+\.\d+/);
      if (ipMatch) {
        kiosks.push({ hostname, ip: ipMatch[0], status: 'online' });
        log(`  Found: ${hostname} (${ipMatch[0]})`);
      }
    } catch {
      // Pi not responding - skip silently
    }
  }

  discoveryCache = { kiosks, timestamp: Date.now() };
  log(`Discovery complete: ${kiosks.length} kiosks found`);
  return kiosks;
}

/**
 * Proxy request to a specific Pi
 */
function proxyToKiosk(kiosk, method, urlPath, body, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: kiosk,
      port: PI_PORT,
      path: urlPath,
      method: method,
      headers: { 'Content-Type': 'application/json' },
      timeout: timeout
    };

    log(`Proxying ${method} ${urlPath} -> ${kiosk}:${PI_PORT}`);

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: { raw: data } });
        }
      });
    });

    req.on('error', (err) => {
      log(`Proxy error to ${kiosk}: ${err.message}`);
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (body && method !== 'GET' && Object.keys(body).length > 0) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// HTTP server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const urlPath = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    });
    res.end();
    return;
  }

  // Authentication check
  if (requiresAuth(req.method, urlPath) && !isAuthenticated(req)) {
    jsonResponse(res, { error: 'Unauthorized. Provide API key via Authorization: Bearer <key> header' }, 401);
    return;
  }

  // Controller-specific endpoints
  if (urlPath === '/' && req.method === 'GET') {
    jsonResponse(res, {
      service: 'kiosk-controller',
      version: '1.0.0',
      endpoints: [
        '/discover',
        '/status', '/files', '/volume',
        '/file', '/url', '/off',
        '/cache', '/cache_and_play',
        '/youtube', '/youtube_and_play',
        '/sync', '/sync_and_play',
        '/playlist', '/next', '/previous',
        '/pause', '/resume', '/restart'
      ],
      usage: "Add 'kiosk' parameter to route commands (e.g., ?kiosk=mars01.local or {\"kiosk\": \"mars01.local\", ...})",
      discoveryPrefix: DISCOVERY_PREFIX,
      discoveryMax: DISCOVERY_MAX
    });
    return;
  }

  if (urlPath === '/discover' && req.method === 'GET') {
    const kiosks = discoverPis();
    jsonResponse(res, {
      kiosks,
      timestamp: new Date().toISOString(),
      prefix: DISCOVERY_PREFIX,
      scanRange: `${DISCOVERY_PREFIX}01.local - ${DISCOVERY_PREFIX}${String(DISCOVERY_MAX).padStart(2, '0')}.local`
    });
    return;
  }

  // All other endpoints require kiosk parameter and get proxied
  let kiosk = url.searchParams.get('kiosk');
  let body = {};

  if (req.method === 'POST') {
    body = await readBody(req);
    kiosk = kiosk || body.kiosk;
    delete body.kiosk; // Remove kiosk param before forwarding
  }

  if (!kiosk) {
    jsonResponse(res, {
      error: "Missing 'kiosk' parameter. Specify target Pi hostname (e.g., mars01.local)",
      usage: {
        GET: "Add ?kiosk=mars01.local query parameter",
        POST: "Add \"kiosk\": \"mars01.local\" in request body"
      },
      discover: "Use GET /discover to find available kiosks"
    }, 400);
    return;
  }

  // Determine timeout based on endpoint (downloads need longer)
  let timeout = 30000; // Default 30 seconds
  if (['/youtube', '/youtube_and_play', '/cache', '/cache_and_play', '/sync', '/sync_and_play', '/playlist'].includes(urlPath)) {
    timeout = 300000; // 5 minutes for download operations
  }

  // Proxy to the specified kiosk
  try {
    const result = await proxyToKiosk(kiosk, req.method, urlPath, body, timeout);
    res.writeHead(result.status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    });
    res.end(JSON.stringify({
      kiosk,
      ...result.data
    }));
  } catch (err) {
    jsonResponse(res, {
      error: `Cannot reach kiosk: ${kiosk}`,
      details: err.message,
      suggestion: "Check that the Pi is powered on and connected to the network. Use GET /discover to find available kiosks."
    }, 502);
  }
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Kiosk controller running on http://0.0.0.0:${PORT}`);
  console.log(`Discovery: ${DISCOVERY_PREFIX}01.local - ${DISCOVERY_PREFIX}${String(DISCOVERY_MAX).padStart(2, '0')}.local`);
  console.log(`Auth: ${API_KEY ? 'enabled (API_KEY set)' : 'disabled (no API_KEY)'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close();
  process.exit(0);
});
