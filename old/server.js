#!/usr/bin/env node
/**
 * Kiosk Signage Server
 * Optimized for Raspberry Pi - minimal memory, efficient streaming
 */

require('dotenv').config({ quiet: true });

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const { WebSocketServer } = require('ws');
const { syncCollection } = require('./eden');

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MEDIA_DIR = path.join(__dirname, 'media');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const API_KEY = process.env.API_KEY || null;

// Routes that don't require authentication (public)
const PUBLIC_ROUTES = ['/', '/status', '/player', '/files'];
const PUBLIC_PREFIXES = ['/assets/', '/media/'];

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
  if (method === 'GET') {
    if (PUBLIC_ROUTES.includes(urlPath)) return false;
    for (const prefix of PUBLIC_PREFIXES) {
      if (urlPath.startsWith(prefix)) return false;
    }
  }
  // All POST requests require auth
  return true;
}

// State
let state = { mode: 'off', file: null, url: null, playlist: null, playlistIndex: 0, loop: true, paused: false };
let currentVolume = 10; // 0-10 scale, default max
const wsClients = new Set();

// Advance to next video in playlist
function nextInPlaylist() {
  if (!state.playlist || state.playlist.length === 0) return false;

  let nextIndex = state.playlistIndex + 1;

  if (nextIndex >= state.playlist.length) {
    if (state.loop) {
      nextIndex = 0;
    } else {
      // End of playlist, stop
      state = { mode: 'off', file: null, url: null, playlist: null, playlistIndex: 0, loop: true };
      broadcast();
      log('Playlist ended');
      return false;
    }
  }

  state.playlistIndex = nextIndex;
  state.file = state.playlist[nextIndex];
  state.paused = false;
  broadcast();
  log(`Playlist: playing ${state.file} (${nextIndex + 1}/${state.playlist.length})`);
  return true;
}

// Go to previous video in playlist
function previousInPlaylist() {
  if (!state.playlist || state.playlist.length === 0) return false;

  let prevIndex = state.playlistIndex - 1;

  if (prevIndex < 0) {
    if (state.loop) {
      prevIndex = state.playlist.length - 1;
    } else {
      prevIndex = 0; // Stay at start if not looping
    }
  }

  state.playlistIndex = prevIndex;
  state.file = state.playlist[prevIndex];
  state.paused = false;
  broadcast();
  log(`Playlist: playing ${state.file} (${prevIndex + 1}/${state.playlist.length})`);
  return true;
}

// Set system volume using ALSA
function setVolume(level) {
  const clampedLevel = Math.min(10, Math.max(0, Math.round(level)));
  const percent = clampedLevel * 10;
  currentVolume = clampedLevel;

  try {
    // Try common ALSA device names
    try {
      execSync(`amixer set PCM ${percent}%`, { stdio: 'ignore' });
    } catch {
      try {
        execSync(`amixer set Master ${percent}%`, { stdio: 'ignore' });
      } catch {
        // Try with specific card
        execSync(`amixer -c 0 set PCM ${percent}%`, { stdio: 'ignore' });
      }
    }
    log(`Volume set to ${clampedLevel} (${percent}%)`);
    return true;
  } catch (err) {
    log(`Volume error: ${err.message}`);
    return false;
  }
}

// Check if URL is a YouTube link
function isYouTubeUrl(url) {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(url);
}

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
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
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

// Valid video extensions
const VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v'];

// Video magic bytes signatures
const VIDEO_SIGNATURES = [
  { bytes: [0x00, 0x00, 0x00], offset: 0, check: (buf) => buf.length > 11 && buf.toString('ascii', 4, 8) === 'ftyp' }, // MP4/M4V
  { bytes: [0x1A, 0x45, 0xDF, 0xA3], offset: 0 }, // WebM/MKV
  { bytes: [0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70], offset: 0 }, // MOV
  { bytes: [0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70], offset: 0 }, // MOV variant
  { bytes: [0x52, 0x49, 0x46, 0x46], offset: 0, check: (buf) => buf.length > 11 && buf.toString('ascii', 8, 11) === 'AVI' }, // AVI
];

// Check if buffer starts with video signature
function isVideoFile(buffer) {
  for (const sig of VIDEO_SIGNATURES) {
    if (sig.check) {
      if (sig.check(buffer)) return true;
    } else {
      let match = true;
      for (let i = 0; i < sig.bytes.length; i++) {
        if (buffer[sig.offset + i] !== sig.bytes[i]) {
          match = false;
          break;
        }
      }
      if (match) return true;
    }
  }
  return false;
}

// Download file from URL and cache it
function downloadAndCache(url) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;

    // Extract extension from URL
    const urlPath = new URL(url).pathname;
    let ext = path.extname(urlPath).toLowerCase();

    // Default to .mp4 if no valid extension
    if (!VIDEO_EXTENSIONS.includes(ext)) {
      ext = '.mp4';
    }

    const tempPath = path.join(MEDIA_DIR, `_temp_${Date.now()}${ext}`);
    const fileStream = fs.createWriteStream(tempPath);
    const hash = crypto.createHash('md5');

    const request = protocol.get(url, {
      headers: { 'User-Agent': 'Kiosk-Server/1.0' },
      timeout: 60000
    }, (response) => {
      // Handle redirects
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        fileStream.close();
        fs.unlinkSync(tempPath);
        downloadAndCache(response.headers.location).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        fileStream.close();
        fs.unlinkSync(tempPath);
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      let headerChecked = false;
      let isVideo = false;

      response.on('data', (chunk) => {
        // Check first chunk for video signature
        if (!headerChecked) {
          headerChecked = true;
          isVideo = isVideoFile(chunk);
          if (!isVideo) {
            log(`Not a video file: ${url}`);
            response.destroy();
            fileStream.close();
            fs.unlink(tempPath, () => {});
            reject(new Error('Not a video file'));
            return;
          }
        }
        hash.update(chunk);
        fileStream.write(chunk);
      });

      response.on('end', () => {
        fileStream.end(() => {
          if (!isVideo) {
            fs.unlink(tempPath, () => {});
            reject(new Error('Not a video file'));
            return;
          }

          const md5 = hash.digest('hex');
          const finalName = `${md5}${ext}`;
          const finalPath = path.join(MEDIA_DIR, finalName);

          // Check if file already exists
          if (fs.existsSync(finalPath)) {
            fs.unlinkSync(tempPath);
            log(`Already cached: ${finalName}`);
            resolve({ filename: finalName, cached: true });
            return;
          }

          // Rename temp file to final name
          fs.rename(tempPath, finalPath, (err) => {
            if (err) {
              fs.unlink(tempPath, () => {});
              reject(err);
              return;
            }
            log(`Cached: ${finalName}`);
            resolve({ filename: finalName, cached: false });
          });
        });
      });

      response.on('error', (err) => {
        fileStream.close();
        fs.unlink(tempPath, () => {});
        reject(err);
      });
    });

    request.on('error', (err) => {
      fileStream.close();
      fs.unlink(tempPath, () => {});
      reject(err);
    });

    request.on('timeout', () => {
      request.destroy();
      fileStream.close();
      fs.unlink(tempPath, () => {});
      reject(new Error('Download timeout'));
    });
  });
}

// Download YouTube video using yt-dlp
function downloadYouTube(url) {
  return new Promise((resolve, reject) => {
    // Generate a temp filename based on URL hash
    const urlHash = crypto.createHash('md5').update(url).digest('hex');
    const outputTemplate = path.join(MEDIA_DIR, `${urlHash}.%(ext)s`);

    // Check if we already have this video cached
    const existingFiles = fs.readdirSync(MEDIA_DIR).filter(f => f.startsWith(urlHash));
    if (existingFiles.length > 0) {
      log(`YouTube already cached: ${existingFiles[0]}`);
      return resolve({ filename: existingFiles[0], cached: true });
    }

    log(`Downloading YouTube: ${url}`);

    // yt-dlp arguments for best quality up to 1080p
    const args = [
      '-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
      '--merge-output-format', 'mp4',
      '-o', outputTemplate,
      '--no-playlist',
      '--no-warnings',
      '--progress',
      url
    ];

    const ytdlp = spawn('yt-dlp', args);

    let stderr = '';
    let lastProgress = '';

    ytdlp.stdout.on('data', (data) => {
      const output = data.toString();
      // Log progress updates
      if (output.includes('%')) {
        const match = output.match(/(\d+\.?\d*)%/);
        if (match && match[1] !== lastProgress) {
          lastProgress = match[1];
          log(`YouTube download: ${lastProgress}%`);
        }
      }
    });

    ytdlp.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ytdlp.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp failed: ${stderr || 'Unknown error'}`));
        return;
      }

      // Find the downloaded file
      const files = fs.readdirSync(MEDIA_DIR).filter(f => f.startsWith(urlHash));
      if (files.length === 0) {
        reject(new Error('Download completed but file not found'));
        return;
      }

      const filename = files[0];
      log(`YouTube cached: ${filename}`);
      resolve({ filename, cached: false });
    });

    ytdlp.on('error', (err) => {
      reject(new Error(`Failed to start yt-dlp: ${err.message}. Is yt-dlp installed?`));
    });
  });
}

// HTTP server
const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];

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

  // GET routes
  if (req.method === 'GET') {
    switch (urlPath) {
      case '/':
        jsonResponse(res, { service: 'kiosk-server', endpoints: ['/status', '/files', '/file', '/url', '/off', '/cache', '/cache_and_play', '/youtube', '/youtube_and_play', '/sync', '/sync_and_play', '/playlist', '/next', '/previous', '/pause', '/resume', '/restart', '/volume'] });
        break;
      case '/status':
        jsonResponse(res, { ...state, wsClients: wsClients.size });
        break;
      case '/volume':
        jsonResponse(res, { level: currentVolume });
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
      case '/cache': {
        const url = body.url;
        if (!url) {
          jsonResponse(res, { error: 'Missing url parameter' }, 400);
          return;
        }
        try {
          log(`Caching: ${url}`);
          const result = await downloadAndCache(url);
          jsonResponse(res, {
            status: 'ok',
            filename: result.filename,
            alreadyCached: result.cached,
            playUrl: `/media/${result.filename}`
          });
        } catch (err) {
          log(`Cache error: ${err.message}`);
          jsonResponse(res, { error: err.message }, 400);
        }
        break;
      }
      case '/cache_and_play': {
        const url = body.url;
        if (!url) {
          jsonResponse(res, { error: 'Missing url parameter' }, 400);
          return;
        }
        try {
          log(`Cache and play: ${url}`);
          const result = await downloadAndCache(url);
          state = { mode: 'video', file: result.filename, url: null, playlist: null, playlistIndex: 0, loop: true };
          broadcast();
          log(`Playing: ${result.filename}`);
          jsonResponse(res, {
            status: 'ok',
            filename: result.filename,
            alreadyCached: result.cached,
            playUrl: `/media/${result.filename}`,
            ...state
          });
        } catch (err) {
          log(`Cache and play error: ${err.message}`);
          jsonResponse(res, { error: err.message }, 400);
        }
        break;
      }
      case '/youtube': {
        const url = body.url;
        if (!url) {
          jsonResponse(res, { error: 'Missing url parameter' }, 400);
          return;
        }
        try {
          const result = await downloadYouTube(url);
          jsonResponse(res, {
            status: 'ok',
            filename: result.filename,
            alreadyCached: result.cached,
            playUrl: `/media/${result.filename}`
          });
        } catch (err) {
          log(`YouTube error: ${err.message}`);
          jsonResponse(res, { error: err.message }, 400);
        }
        break;
      }
      case '/youtube_and_play': {
        const url = body.url;
        if (!url) {
          jsonResponse(res, { error: 'Missing url parameter' }, 400);
          return;
        }
        try {
          const result = await downloadYouTube(url);
          state = { mode: 'video', file: result.filename, url: null, playlist: null, playlistIndex: 0, loop: true };
          broadcast();
          log(`Playing YouTube: ${result.filename}`);
          jsonResponse(res, {
            status: 'ok',
            filename: result.filename,
            alreadyCached: result.cached,
            playUrl: `/media/${result.filename}`,
            ...state
          });
        } catch (err) {
          log(`YouTube and play error: ${err.message}`);
          jsonResponse(res, { error: err.message }, 400);
        }
        break;
      }
      case '/sync': {
        const collectionId = body.collectionId || body.collection;
        const db = (body.db || 'PROD').toUpperCase();
        if (!collectionId) {
          jsonResponse(res, { error: 'Missing collectionId parameter' }, 400);
          return;
        }
        if (!['PROD', 'STAGE'].includes(db)) {
          jsonResponse(res, { error: 'Invalid db parameter. Use PROD or STAGE' }, 400);
          return;
        }
        if (!process.env.EDEN_API_KEY) {
          jsonResponse(res, { error: 'EDEN_API_KEY not configured' }, 500);
          return;
        }
        try {
          log(`Syncing collection: ${collectionId} (${db})`);
          const result = await syncCollection(collectionId, MEDIA_DIR, { db });
          log(`Sync complete: ${result.downloaded} downloaded, ${result.skipped} skipped`);
          jsonResponse(res, {
            status: 'ok',
            collectionId,
            db,
            ...result
          });
        } catch (err) {
          log(`Sync error: ${err.message}`);
          jsonResponse(res, { error: err.message }, 400);
        }
        break;
      }
      case '/sync_and_play': {
        const collectionId = body.collectionId || body.collection;
        const db = (body.db || 'PROD').toUpperCase();
        const loop = body.loop !== false; // Default to true
        if (!collectionId) {
          jsonResponse(res, { error: 'Missing collectionId parameter' }, 400);
          return;
        }
        if (!['PROD', 'STAGE'].includes(db)) {
          jsonResponse(res, { error: 'Invalid db parameter. Use PROD or STAGE' }, 400);
          return;
        }
        if (!process.env.EDEN_API_KEY) {
          jsonResponse(res, { error: 'EDEN_API_KEY not configured' }, 500);
          return;
        }
        try {
          log(`Sync and play collection: ${collectionId} (${db}, loop: ${loop})`);
          const result = await syncCollection(collectionId, MEDIA_DIR, { db });
          log(`Sync complete: ${result.downloaded} downloaded, ${result.skipped} skipped`);

          // Get list of successfully synced files
          const playlist = result.files
            .filter(f => f.status === 'downloaded' || f.status === 'skipped')
            .map(f => f.filename);

          if (playlist.length === 0) {
            jsonResponse(res, { error: 'No videos found in collection' }, 400);
            return;
          }

          // Start playlist
          state = {
            mode: 'playlist',
            file: playlist[0],
            url: null,
            playlist,
            playlistIndex: 0,
            loop,
            paused: false
          };
          broadcast();
          log(`Playing playlist: ${playlist.length} videos, starting with ${playlist[0]}`);

          jsonResponse(res, {
            status: 'ok',
            collectionId,
            db,
            mode: 'playlist',
            loop,
            playlist,
            currentFile: playlist[0],
            syncResult: result
          });
        } catch (err) {
          log(`Sync and play error: ${err.message}`);
          jsonResponse(res, { error: err.message }, 400);
        }
        break;
      }
      case '/playlist': {
        const items = body.items;
        const loop = body.loop !== false; // Default to true
        if (!items || !Array.isArray(items) || items.length === 0) {
          jsonResponse(res, { error: 'Missing or empty items array' }, 400);
          return;
        }

        log(`Creating playlist with ${items.length} items`);
        const playlist = [];
        const failed = [];

        // Process items sequentially
        for (const item of items) {
          if (item.file) {
            // Cached file - verify it exists
            const filePath = path.join(MEDIA_DIR, item.file);
            if (fs.existsSync(filePath)) {
              playlist.push(item.file);
              log(`  Added cached file: ${item.file}`);
            } else {
              failed.push({ file: item.file, error: 'File not found' });
              log(`  Skipped (not found): ${item.file}`);
            }
          } else if (item.url) {
            // URL to download
            try {
              let result;
              if (isYouTubeUrl(item.url)) {
                log(`  Downloading YouTube: ${item.url}`);
                result = await downloadYouTube(item.url);
              } else {
                log(`  Downloading URL: ${item.url}`);
                result = await downloadAndCache(item.url);
              }
              playlist.push(result.filename);
              log(`  Added: ${result.filename} (cached: ${result.cached})`);
            } catch (err) {
              failed.push({ url: item.url, error: err.message });
              log(`  Skipped (download failed): ${item.url} - ${err.message}`);
            }
          } else {
            failed.push({ item, error: 'Item must have "file" or "url" property' });
          }
        }

        if (playlist.length === 0) {
          jsonResponse(res, { error: 'No valid items in playlist', failed }, 400);
          return;
        }

        // Start playlist
        state = {
          mode: 'playlist',
          file: playlist[0],
          url: null,
          playlist,
          playlistIndex: 0,
          loop,
          paused: false
        };
        broadcast();
        log(`Playing playlist: ${playlist.length} items, starting with ${playlist[0]}`);

        jsonResponse(res, {
          status: 'ok',
          mode: 'playlist',
          playlist,
          currentFile: playlist[0],
          loop,
          failed: failed.length > 0 ? failed : undefined
        });
        break;
      }
      case '/next': {
        if (state.mode === 'playlist') {
          nextInPlaylist();
          jsonResponse(res, { status: 'ok', ...state });
        } else if (state.mode === 'video' && state.file) {
          // Restart single video
          state.paused = false;
          broadcast();
          jsonResponse(res, { status: 'ok', action: 'restart', ...state });
        } else {
          jsonResponse(res, { error: 'No active playback' }, 400);
        }
        break;
      }
      case '/previous': {
        if (state.mode === 'playlist') {
          previousInPlaylist();
          jsonResponse(res, { status: 'ok', ...state });
        } else if (state.mode === 'video' && state.file) {
          // Restart single video
          state.paused = false;
          broadcast();
          jsonResponse(res, { status: 'ok', action: 'restart', ...state });
        } else {
          jsonResponse(res, { error: 'No active playback' }, 400);
        }
        break;
      }
      case '/pause': {
        if (state.mode === 'off') {
          jsonResponse(res, { error: 'No active playback' }, 400);
          return;
        }
        state.paused = true;
        broadcast();
        log('Playback paused');
        jsonResponse(res, { status: 'ok', ...state });
        break;
      }
      case '/resume': {
        if (state.mode === 'off') {
          jsonResponse(res, { error: 'No active playback' }, 400);
          return;
        }
        state.paused = false;
        broadcast();
        log('Playback resumed');
        jsonResponse(res, { status: 'ok', ...state });
        break;
      }
      case '/restart': {
        if (state.mode === 'playlist' && state.playlist && state.playlist.length > 0) {
          state.playlistIndex = 0;
          state.file = state.playlist[0];
          state.paused = false;
          broadcast();
          log(`Playlist restarted: ${state.file}`);
          jsonResponse(res, { status: 'ok', ...state });
        } else if (state.mode === 'video' && state.file) {
          state.paused = false;
          broadcast();
          jsonResponse(res, { status: 'ok', action: 'restart', ...state });
        } else {
          jsonResponse(res, { error: 'No active playback to restart' }, 400);
        }
        break;
      }
      case '/volume': {
        const level = body.level;
        if (level === undefined || typeof level !== 'number') {
          jsonResponse(res, { error: 'Missing or invalid level parameter (0-10)' }, 400);
          return;
        }
        if (level < 0 || level > 10) {
          jsonResponse(res, { error: 'Level must be between 0 and 10' }, 400);
          return;
        }
        setVolume(level);
        jsonResponse(res, { status: 'ok', level: currentVolume });
        break;
      }
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
      } else if (msg.type === 'next') {
        // Player requests next video in playlist
        if (state.mode === 'playlist') {
          nextInPlaylist();
        }
      }
    } catch {}
  });
});

// Start server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Kiosk server running on http://0.0.0.0:${PORT}`);
  console.log(`Player: http://localhost:${PORT}/player`);
  console.log(`Media dir: ${MEDIA_DIR}`);
  console.log(`Auth: ${API_KEY ? 'enabled (API_KEY set)' : 'disabled (no API_KEY)'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  wss.close();
  server.close();
  process.exit(0);
});
