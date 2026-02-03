import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import os from 'node:os';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import mime from 'mime-types';
import { buildIndexFromFile, type GuideIndex } from './index-builder.js';
import { buildIndexFromConfig } from './index-builder-config.js';
import { loadConfig, type ChannelEmbedConfig, type LoadedConfig } from './config.js';
import { createVillageCapture } from './village-capture.js';
import { createWeatherstarCapture } from './weatherstar-capture.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT ?? 8787);
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const WS_HEARTBEAT_MS = Number(process.env.WS_HEARTBEAT_MS ?? 25000);
const wsAlive = new WeakMap<WebSocket, boolean>();

const repoRoot = path.resolve(__dirname, '../../..');
const distDir = path.resolve(__dirname, '../../guide/dist');
const indexFile = path.join(distDir, 'index.html');
const sourcesFile = path.resolve(__dirname, '../data/sources.json');
const configPath = process.env.CHIBA_CONFIG ?? path.resolve(repoRoot, 'config/chiba.toml');

let guideIndex: GuideIndex | null = null;
let rebuildTimer: NodeJS.Timeout | null = null;
const villageCapture = createVillageCapture();
const weatherstarCapture = createWeatherstarCapture();
let loadedConfig: LoadedConfig | null = null;
let mediaRoots: string[] = [];
let configWatchers: Array<ReturnType<typeof fs.watch>> = [];
let configPollTimer: NodeJS.Timeout | null = null;
let lastConfigFingerprint = '';
type RemoteControl =
  | {
      id: string;
      label: string;
      type: 'range';
      min: number;
      max: number;
      step?: number;
      value?: number;
    }
  | {
      id: string;
      label: string;
      type: 'select';
      options: { value: string; label: string }[];
      value?: string;
    }
  | {
      id: string;
      label: string;
      type: 'toggle';
      value?: boolean;
    }
  | {
      id: string;
      label: string;
      type: 'button';
    };

type ControlSchema = {
  appId: string;
  controls: RemoteControl[];
  updatedAt: number;
};

const controlSchemas = new Map<string, ControlSchema>();
const mediaStats = {
  startedAt: Date.now(),
  active: 0,
  requests: 0,
  completed: 0,
  bytesSent: 0,
  bytesRequested: 0,
  errors: 0,
  lastRequestAt: null as number | null,
  lastPath: null as string | null,
};
const mediaPathStats = new Map<
  string,
  { path: string; requests: number; bytes: number; lastAt: number }
>();

const bumpPathStats = (path: string, bytes: number) => {
  const now = Date.now();
  const existing = mediaPathStats.get(path);
  if (existing) {
    existing.requests += 1;
    existing.bytes += bytes;
    existing.lastAt = now;
  } else {
    mediaPathStats.set(path, { path, requests: 1, bytes, lastAt: now });
  }
  if (mediaPathStats.size > 40) {
    const entries = Array.from(mediaPathStats.values()).sort(
      (a, b) => a.lastAt - b.lastAt
    );
    for (let i = 0; i < entries.length - 30; i += 1) {
      mediaPathStats.delete(entries[i].path);
    }
  }
};

const recordMediaError = (path?: string | null) => {
  mediaStats.errors += 1;
  if (path) {
    mediaStats.lastPath = path;
    mediaStats.lastRequestAt = Date.now();
  }
};

const getEmbedConfig = (id: string): ChannelEmbedConfig | null => {
  const channel = loadedConfig?.channels.find((item) => item.id === id);
  return channel?.embed ?? null;
};

const parseBooleanQuery = (value: unknown): boolean => {
  if (value === undefined || value === null) return false;
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "number") return raw > 0;
  if (typeof raw !== "string") return false;
  const normalized = raw.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
};

const buildOverlayHtml = (embed: ChannelEmbedConfig | null) => {
  if (!embed?.overlay) return { html: '', script: '' };
  const overlay = embed.overlay;
  const title = overlay.title ?? 'Broadcast';
  const subtitle = overlay.subtitle ?? 'Waiting for Signal';
  const hint = overlay.hint ?? '';
  const qr = overlay.qr ?? '';
  const button = overlay.button ?? 'Hide Info';
  const showDelay = Math.max(0, overlay.show_delay_ms ?? 0);
  const hideOnMessage = overlay.hide_on_message !== false;
  const mode = overlay.mode === 'corner' ? 'corner' : 'center';
  const qrImg = qr
    ? `<img class="embed-qr" src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=0&data=${encodeURIComponent(
        qr
      )}" alt="QR to broadcast" />`
    : '';
  const html = `
    <div id="embed-overlay" class="embed-overlay ${mode}">
      <div class="embed-panel">
        <div class="embed-title">${title}</div>
        <div class="embed-subtitle">${subtitle}</div>
        ${qrImg}
        ${hint ? `<div class="embed-hint">${hint}</div>` : ''}
        <button class="embed-dismiss" id="embed-dismiss">${button}</button>
      </div>
    </div>`;
  const script = `
    const overlay = document.getElementById('embed-overlay');
    const dismiss = document.getElementById('embed-dismiss');
    const showOverlay = () => overlay?.classList.add('is-visible');
    const hideOverlay = () => overlay?.classList.remove('is-visible');
    if (dismiss) dismiss.addEventListener('click', hideOverlay);
    if (${showDelay} > 0) {
      setTimeout(showOverlay, ${showDelay});
    } else {
      showOverlay();
    }
    if (${hideOnMessage}) {
      window.addEventListener('message', () => hideOverlay());
    }
  `;
  return { html, script };
};

const buildEmbedPage = (embed: ChannelEmbedConfig, debug = false) => {
  const allow =
    embed.allow ?? 'autoplay; fullscreen; camera; microphone';
  const sandbox = embed.sandbox ? `sandbox="${embed.sandbox}"` : '';
  const mask = embed.mask;
  const maskStyle = mask
    ? `#embed-mask {display:block; top:${mask.top ?? 8}px; right:${mask.right ?? 8}px; bottom:${mask.bottom ?? 'auto'}; left:${mask.left ?? 'auto'}; width:${mask.width ?? 340}px; height:${mask.height ?? 140}px;}`
    : '#embed-mask {display:none;}';
  const { html: overlayHtml, script: overlayScript } = buildOverlayHtml(embed);
  const autoplayMessages = embed.autoplay_messages ?? [];
  const autoplayDelay = Math.max(0, embed.autoplay_delay_ms ?? 800);
  const autoplayRetryMs = Math.max(0, embed.autoplay_retry_ms ?? 1500);
  const autoplayRetries = Math.max(0, embed.autoplay_retries ?? 3);
  const debugEnabled = Boolean(debug);
  const debugMeta = JSON.stringify({
    url: embed.url ?? "",
    mode: embed.mode ?? "iframe",
  });
  const debugPanel = debugEnabled
    ? `<div id="embed-debug" class="embed-debug"><div class="embed-debug-title">Embed Debug</div><div id="embed-debug-lines" class="embed-debug-lines"></div></div>`
    : "";
  const debugSetup = `
    const debugEnabled = ${debugEnabled};
    const debugLines = debugEnabled ? document.getElementById('embed-debug-lines') : null;
    const debugLog = (label, detail) => {
      if (!debugEnabled || !debugLines) return;
      const line = document.createElement('div');
      let detailText = '';
      if (detail !== undefined) {
        if (typeof detail === 'string') {
          detailText = detail;
        } else {
          try { detailText = JSON.stringify(detail); } catch { detailText = String(detail); }
        }
      }
      line.textContent = detailText ? \`[\${label}] \${detailText}\` : \`[\${label}]\`;
      debugLines.prepend(line);
      while (debugLines.children.length > 14) {
        debugLines.removeChild(debugLines.lastChild);
      }
    };
    if (debugEnabled) debugLog('init', ${debugMeta});
  `;
  const autoplayScript =
    autoplayMessages.length > 0
      ? `
      const autoplayMessages = ${JSON.stringify(autoplayMessages)};
      const autoplayDelay = ${autoplayDelay};
      const autoplayRetryMs = ${autoplayRetryMs};
      const autoplayRetries = ${autoplayRetries};
      let autoplayAttempts = 0;
      const sendAutoplay = () => {
        if (!frame || !frame.contentWindow) return;
        autoplayMessages.forEach((msg) => {
          frame.contentWindow.postMessage({ action: msg }, '*');
          frame.contentWindow.postMessage({ command: msg }, '*');
          frame.contentWindow.postMessage(msg, '*');
        });
      };
      const tryAutoplay = () => {
        if (autoplayAttempts >= autoplayRetries) return;
        autoplayAttempts += 1;
        debugLog('autoplay', { attempt: autoplayAttempts });
        sendAutoplay();
        setTimeout(tryAutoplay, autoplayRetryMs);
      };
      setTimeout(tryAutoplay, autoplayDelay);
      `
      : '';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Channel Embed</title>
    <style>
      html, body { height: 100%; margin: 0; background: #0a0f1a; }
      body { position: relative; overflow: hidden; font-family: "Oxanium", "Segoe UI", sans-serif; color: #e9f5ff; }
      #embed-frame { position: absolute; inset: 0; width: 100vw; height: 100vh; border: 0; display: block; background: #0a0f1a; }
      #embed-mask {
        position: absolute;
        border-radius: 14px;
        background: radial-gradient(circle at 30% 30%, rgba(18, 32, 56, 0.98), rgba(8, 14, 24, 0.98));
        box-shadow: 0 12px 26px rgba(2, 6, 12, 0.6);
        border: 1px solid rgba(126, 215, 255, 0.18);
        pointer-events: none;
      }
      ${maskStyle}
      .embed-overlay {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        background: radial-gradient(circle at 50% 30%, rgba(40, 80, 140, 0.55), rgba(6, 10, 18, 0.96));
        opacity: 0;
        transition: opacity 220ms ease;
        pointer-events: none;
      }
      .embed-overlay.is-visible { opacity: 1; }
      .embed-overlay.corner {
        background: transparent;
        display: flex;
        align-items: flex-start;
        justify-content: flex-end;
        padding: 24px;
      }
      .embed-panel {
        max-width: min(720px, 90vw);
        padding: 28px;
        border-radius: 18px;
        background: linear-gradient(160deg, rgba(18, 30, 54, 0.96), rgba(8, 14, 24, 0.98));
        border: 1px solid rgba(126, 215, 255, 0.35);
        box-shadow: 0 20px 40px rgba(2, 6, 12, 0.6);
        display: grid;
        gap: 16px;
        text-align: center;
        pointer-events: auto;
      }
      .embed-overlay.corner .embed-panel {
        max-width: min(360px, 44vw);
        padding: 18px;
        gap: 12px;
        text-align: center;
      }
      .embed-title {
        font-size: 1.4rem;
        letter-spacing: 0.3em;
        text-transform: uppercase;
      }
      .embed-overlay.corner .embed-title {
        font-size: 0.95rem;
        letter-spacing: 0.22em;
      }
      .embed-subtitle {
        color: rgba(200, 220, 255, 0.75);
        font-size: 0.9rem;
        letter-spacing: 0.2em;
        text-transform: uppercase;
      }
      .embed-overlay.corner .embed-subtitle {
        font-size: 0.7rem;
      }
      .embed-qr {
        margin: 0 auto;
        width: 200px;
        height: 200px;
        border-radius: 14px;
        padding: 8px;
        background: rgba(6, 10, 18, 0.85);
        border: 1px solid rgba(126, 215, 255, 0.3);
      }
      .embed-overlay.corner .embed-qr {
        width: 150px;
        height: 150px;
      }
      .embed-hint {
        font-size: 0.8rem;
        color: rgba(200, 220, 255, 0.8);
      }
      .embed-overlay.corner .embed-hint {
        font-size: 0.7rem;
      }
      .embed-dismiss {
        justify-self: center;
        padding: 8px 18px;
        border-radius: 999px;
        border: 1px solid rgba(126, 215, 255, 0.4);
        background: rgba(12, 20, 36, 0.85);
        color: #e9f5ff;
        font-size: 0.7rem;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        cursor: pointer;
      }
      .embed-debug {
        position: absolute;
        top: 12px;
        left: 12px;
        max-width: min(360px, 90vw);
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(6, 10, 18, 0.78);
        border: 1px solid rgba(126, 215, 255, 0.35);
        font-size: 12px;
        color: rgba(230, 240, 255, 0.92);
        z-index: 5;
        pointer-events: none;
      }
      .embed-debug-title {
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        font-size: 10px;
        margin-bottom: 6px;
      }
      .embed-debug-lines {
        display: grid;
        gap: 4px;
        font-family: "JetBrains Mono", "SFMono-Regular", ui-monospace, monospace;
        font-size: 10px;
        color: rgba(160, 210, 255, 0.9);
      }
    </style>
  </head>
  <body>
    <iframe id="embed-frame" src="${embed.url ?? ''}" allow="${allow}" ${sandbox}></iframe>
    <div id="embed-mask"></div>
    ${overlayHtml}
    ${debugPanel}
    <script>
      const frame = document.getElementById('embed-frame');
      ${debugSetup}
      if (frame && debugEnabled) {
        frame.addEventListener('load', () => debugLog('iframe', 'load'));
      }
      window.addEventListener('message', (event) => {
        if (debugEnabled) debugLog('message', event.data);
      });
      ${autoplayScript}
      ${overlayScript}
    </script>
  </body>
</html>`;
};

const buildProxyPage = (
  html: string,
  embed: ChannelEmbedConfig,
  debug?: { enabled: boolean; status?: number; url?: string }
) => {
  const selectors = embed.dismiss_selectors ?? [];
  const hideCss = selectors.length
    ? selectors.map((sel) => `${sel}{display:none !important; visibility:hidden !important;}`).join('')
    : '';
  const baseHref = embed.url ?? '';
  const debugEnabled = Boolean(debug?.enabled);
  const debugStatus =
    typeof debug?.status === 'number' ? debug.status : 'unknown';
  const debugUrl = debug?.url ?? embed.url ?? '';
  const debugStyle = debugEnabled
    ? `
      #embed-debug {
        position: fixed;
        bottom: 12px;
        left: 12px;
        z-index: 2147483647;
        max-width: min(420px, 94vw);
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(6, 10, 18, 0.82);
        border: 1px solid rgba(126, 215, 255, 0.35);
        font-family: "JetBrains Mono", "SFMono-Regular", ui-monospace, monospace;
        font-size: 11px;
        color: rgba(220, 235, 255, 0.92);
        pointer-events: none;
      }
    `
    : '';
  const debugScript = debugEnabled
    ? `
      <script>
        (() => {
          const meta = ${JSON.stringify({ status: debugStatus, url: debugUrl })};
          const panel = document.createElement('div');
          panel.id = 'embed-debug';
          panel.textContent = \`Embed proxy: \${meta.status} \${meta.url}\`;
          const mount = () => document.body && document.body.appendChild(panel);
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', mount);
          } else {
            mount();
          }
        })();
      </script>
    `
    : '';
  const injectScript = `
      <script>
        (() => {
          const baseOrigin = window.location.origin;
          const normalizeUrlArg = (url) => {
            if (!url) return url;
            if (typeof url === 'string') return url;
            if (typeof url === 'object' && url.href) return url.href;
            try {
              return String(url);
            } catch {
              return null;
            }
          };
          const safeHistory = (original) => function (state, title, url) {
            try {
              const normalized = normalizeUrlArg(url);
              if (typeof normalized === 'string' && normalized.length > 0) {
                const parsed = new URL(normalized, window.location.href);
                if (parsed.origin !== baseOrigin) {
                  const safeUrl = parsed.pathname + parsed.search + parsed.hash;
                  return original.call(this, state, title, safeUrl);
                }
                return original.call(this, state, title, normalized);
              }
              return original.call(this, state, title, url);
            } catch {
              return;
            }
          };
          try {
            if (History && History.prototype && History.prototype.replaceState) {
              History.prototype.replaceState = safeHistory(History.prototype.replaceState);
            }
            if (History && History.prototype && History.prototype.pushState) {
              History.prototype.pushState = safeHistory(History.prototype.pushState);
            }
          } catch {
            // ignore history override failures
          }
          const selectors = ${JSON.stringify(selectors)};
          const remove = () => {
            selectors.forEach((sel) => {
              document.querySelectorAll(sel).forEach((node) => node.remove());
            });
            document.documentElement.style.overflow = 'auto';
            document.body.style.overflow = 'auto';
          };
          const ready = () => {
            remove();
            if (selectors.length) {
              const observer = new MutationObserver(remove);
              observer.observe(document.body, { childList: true, subtree: true });
            }
          };
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', ready);
          } else {
            ready();
          }
        })();
      </script>
    `;
  let output = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');
  output = output.replace(/<base[^>]*>/gi, '');
  const injection = `<base href="${baseHref}"/><style>${hideCss}${debugStyle}</style>${injectScript}${debugScript}`;
  if (/<head[^>]*>/i.test(output)) {
    output = output.replace(/<head[^>]*>/i, (match) => `${match}${injection}`);
  } else {
    output = `${injection}${output}`;
  }
  return output;
};

const broadcast = (message: string) => {
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) {
      client.send(message);
    }
  });
};

async function rebuildIndex() {
  try {
    if (fs.existsSync(configPath)) {
      loadedConfig = await loadConfig(configPath);
      mediaRoots = loadedConfig.libraryRoots;
      guideIndex = buildIndexFromConfig(loadedConfig);
      console.log(`[index] rebuilt from TOML (${guideIndex.channels.length} channels)`);
      broadcast(JSON.stringify({ type: 'index', source: 'toml' }));
      return;
    }
    guideIndex = await buildIndexFromFile(sourcesFile);
    console.log(`[index] rebuilt from sources.json (${guideIndex.channels.length} channels)`);
    broadcast(JSON.stringify({ type: 'index', source: 'json' }));
  } catch (err) {
    console.error('[index] rebuild failed', (err as Error).message);
  }
}

void rebuildIndex();

const scheduleRebuild = () => {
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    void rebuildIndex();
  }, 200);
};

const watchConfig = async () => {
  configWatchers.forEach((watcher) => watcher.close());
  configWatchers = [];

  if (fs.existsSync(configPath)) {
    configWatchers.push(fs.watch(configPath, scheduleRebuild));
    try {
      const configDir = path.dirname(configPath);
      const raw = await fsp.readFile(configPath, 'utf-8');
      const match = raw.match(/manifest_dir\s*=\s*\"([^\"]+)\"/);
      if (match?.[1]) {
        const manifestDir = path.resolve(configDir, match[1]);
        if (fs.existsSync(manifestDir)) {
          configWatchers.push(fs.watch(manifestDir, scheduleRebuild));
        }
      }
    } catch {
      // ignore
    }
    return;
  }

  if (fs.existsSync(sourcesFile)) {
    configWatchers.push(fs.watch(sourcesFile, scheduleRebuild));
  }
};

void watchConfig();

const resolveManifestDirFromConfig = async () => {
  try {
    const configDir = path.dirname(configPath);
    const raw = await fsp.readFile(configPath, 'utf-8');
    const match = raw.match(/manifest_dir\s*=\s*\"([^\"]+)\"/);
    if (!match?.[1]) return null;
    return path.resolve(configDir, match[1]);
  } catch {
    return null;
  }
};

const computeConfigFingerprint = async () => {
  if (!fs.existsSync(configPath)) return '';
  try {
    const configStat = await fsp.stat(configPath);
    const manifestDir = await resolveManifestDirFromConfig();
    let entries: string[] = [];
    if (manifestDir && fs.existsSync(manifestDir)) {
      const files = (await fsp.readdir(manifestDir))
        .filter((file) => file.endsWith('.toml'))
        .sort();
      const stats = await Promise.all(
        files.map(async (file) => {
          const stat = await fsp.stat(path.join(manifestDir, file));
          return `${file}:${stat.mtimeMs}`;
        })
      );
      entries = stats;
    }
    return `${configStat.mtimeMs}|${entries.join('|')}`;
  } catch {
    return '';
  }
};

const startConfigPolling = () => {
  if (configPollTimer) clearInterval(configPollTimer);
  configPollTimer = setInterval(async () => {
    const fingerprint = await computeConfigFingerprint();
    if (!fingerprint) return;
    if (!lastConfigFingerprint) {
      lastConfigFingerprint = fingerprint;
      return;
    }
    if (fingerprint !== lastConfigFingerprint) {
      lastConfigFingerprint = fingerprint;
      scheduleRebuild();
    }
  }, 2000);
};

startConfigPolling();

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/index', (_req, res) => {
  if (!guideIndex) {
    res.status(503).json({ error: 'index_not_ready' });
    return;
  }
  res.json(guideIndex);
});

app.get('/api/debug/media', (_req, res) => {
  const uptimeSec = Math.floor((Date.now() - mediaStats.startedAt) / 1000);
  const topPaths = Array.from(mediaPathStats.values())
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 6);
  res.json({
    uptimeSec,
    active: mediaStats.active,
    requests: mediaStats.requests,
    completed: mediaStats.completed,
    bytesSent: mediaStats.bytesSent,
    bytesRequested: mediaStats.bytesRequested,
    errors: mediaStats.errors,
    lastRequestAt: mediaStats.lastRequestAt,
    lastPath: mediaStats.lastPath,
    topPaths,
  });
});

app.get('/api/remote', (req, res) => {
  const rawPort = req.query.guide_port ?? req.query.port;
  const guidePort =
    typeof rawPort === 'string' && rawPort.trim().length > 0
      ? Number(rawPort)
      : Array.isArray(rawPort) && typeof rawPort[0] === 'string'
        ? Number(rawPort[0])
        : null;
  const port = Number.isFinite(guidePort) ? guidePort : null;
  const scheme =
    typeof req.query.scheme === 'string'
      ? req.query.scheme.replace(':', '')
      : Array.isArray(req.query.scheme) && typeof req.query.scheme[0] === 'string'
        ? req.query.scheme[0].replace(':', '')
        : null;
  const baseUrl = getRemoteBaseUrl(req, { port, scheme });
  const remoteUrl = `${baseUrl}/remote`;
  const qrUrl = `${QR_BASE}${encodeURIComponent(remoteUrl)}`;
  res.json({ baseUrl, remoteUrl, qrUrl });
});

function isPathAllowed(target: string): boolean {
  if (!mediaRoots.length) return false;
  const resolved = path.resolve(target);
  return mediaRoots.some((root) => {
    const base = path.resolve(root);
    return resolved === base || resolved.startsWith(`${base}${path.sep}`);
  });
}

app.get('/media/:id', async (req, res) => {
  const rawPath = req.query.path;
  if (typeof rawPath !== 'string' || !rawPath) {
    res.status(400).send('missing_path');
    recordMediaError(null);
    return;
  }
  const decoded = decodeURIComponent(rawPath);
  if (!isPathAllowed(decoded)) {
    res.status(403).send('forbidden');
    recordMediaError(decoded);
    return;
  }
  let stat: fs.Stats;
  try {
    stat = await fsp.stat(decoded);
  } catch {
    res.status(404).send('not_found');
    recordMediaError(decoded);
    return;
  }
  if (!stat.isFile()) {
    res.status(404).send('not_found');
    recordMediaError(decoded);
    return;
  }

  const mimeType = mime.contentType(path.extname(decoded)) || 'application/octet-stream';
  const range = req.headers.range;

  if (!range) {
    mediaStats.requests += 1;
    mediaStats.active += 1;
    mediaStats.lastRequestAt = Date.now();
    mediaStats.lastPath = decoded;
    mediaStats.bytesRequested += stat.size;
    bumpPathStats(decoded, 0);
    res.status(200);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Accept-Ranges', 'bytes');
    const stream = fs.createReadStream(decoded);
    let completed = false;
    const done = () => {
      if (completed) return;
      completed = true;
      mediaStats.active = Math.max(0, mediaStats.active - 1);
      mediaStats.completed += 1;
    };
    stream.on('data', (chunk) => {
      mediaStats.bytesSent += chunk.length;
      const entry = mediaPathStats.get(decoded);
      if (entry) entry.bytes += chunk.length;
    });
    stream.on('error', (err) => {
      recordMediaError(decoded);
      console.warn('[media] stream error', decoded, err?.message ?? err);
      done();
      if (!res.headersSent) {
        res.status(500).end();
      } else {
        res.destroy(err as Error);
      }
    });
    res.on('close', done);
    res.on('finish', done);
    stream.pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(range);
  if (!match) {
    res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
    recordMediaError(decoded);
    return;
  }

  let start = match[1] ? Number.parseInt(match[1], 10) : NaN;
  let end = match[2] ? Number.parseInt(match[2], 10) : NaN;

  if (Number.isNaN(start)) {
    const suffix = Number.isNaN(end) ? 0 : end;
    start = Math.max(stat.size - suffix, 0);
    end = stat.size - 1;
  } else if (Number.isNaN(end)) {
    end = stat.size - 1;
  }

  if (start < 0 || end >= stat.size || start > end) {
    res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
    recordMediaError(decoded);
    return;
  }

  mediaStats.requests += 1;
  mediaStats.active += 1;
  mediaStats.lastRequestAt = Date.now();
  mediaStats.lastPath = decoded;
  mediaStats.bytesRequested += end - start + 1;
  bumpPathStats(decoded, 0);

  res.status(206);
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
  res.setHeader('Content-Length', end - start + 1);
  const stream = fs.createReadStream(decoded, { start, end });
  let completed = false;
  const done = () => {
    if (completed) return;
    completed = true;
    mediaStats.active = Math.max(0, mediaStats.active - 1);
    mediaStats.completed += 1;
  };
  stream.on('data', (chunk) => {
    mediaStats.bytesSent += chunk.length;
    const entry = mediaPathStats.get(decoded);
    if (entry) entry.bytes += chunk.length;
  });
  stream.on('error', (err) => {
    recordMediaError(decoded);
    console.warn('[media] stream error', decoded, err?.message ?? err);
    done();
    if (!res.headersSent) {
      res.status(500).end();
    } else {
      res.destroy(err as Error);
    }
  });
  res.on('close', done);
  res.on('finish', done);
  stream.pipe(res);
});

app.get('/api/controls/:appId', (req, res) => {
  const appId = req.params.appId;
  const schema = controlSchemas.get(appId);
  if (!schema) {
    res.status(404).json({ error: 'controls_not_found' });
    return;
  }
  res.json(schema);
});

app.get('/village.jpg', (_req, res) => {
  const frame = villageCapture.getFrame();
  if (!frame) {
    res.status(503).send('capture_not_ready');
    return;
  }
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.send(frame.buffer);
});

app.get('/village/live', (req, res) => {
  const hideMask =
    req.query.mask === '0' ||
    req.query.mask === 'false' ||
    req.query.mask === 'off';
  const sourceUrl = villageCapture.options.url;
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AI Village Live</title>
    <style>
      html, body {
        height: 100%;
        margin: 0;
        background: #0a0f1a;
      }
      body {
        position: relative;
        overflow: hidden;
      }
      #frame {
        position: absolute;
        inset: 0;
        width: 100vw;
        height: 100vh;
        border: 0;
        display: block;
        background: #0a0f1a;
      }
      #mask {
        position: absolute;
        top: 8px;
        right: 8px;
        width: 340px;
        height: 140px;
        border-radius: 14px;
        background: radial-gradient(circle at 30% 30%, rgba(18, 32, 56, 0.98), rgba(8, 14, 24, 0.98));
        box-shadow: 0 12px 26px rgba(2, 6, 12, 0.6);
        border: 1px solid rgba(126, 215, 255, 0.18);
        pointer-events: none;
      }
      #status {
        position: absolute;
        bottom: 12px;
        right: 12px;
        padding: 6px 10px;
        border-radius: 999px;
        font-family: "Alegreya Sans", "Segoe UI", sans-serif;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(230, 240, 255, 0.7);
        background: rgba(10, 18, 32, 0.6);
        border: 1px solid rgba(126, 215, 255, 0.25);
      }
    </style>
  </head>
  <body>
    <iframe id="frame" src="${sourceUrl}" allow="autoplay; fullscreen"></iframe>
    <div id="mask"></div>
    <div id="status">Live site</div>
    <script>
      if (${hideMask ? 'true' : 'false'}) {
        const mask = document.getElementById('mask');
        if (mask) mask.style.display = 'none';
      }
    </script>
  </body>
</html>`);
});

app.get('/village', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AI Village</title>
    <style>
      html, body {
        height: 100%;
        margin: 0;
        background: #0a0f1a;
      }
      body {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }
      #frame {
        width: 100vw;
        height: 100vh;
        object-fit: contain;
        object-position: center;
        display: block;
        background: #0a0f1a;
      }
      #status {
        position: absolute;
        top: 16px;
        right: 16px;
        padding: 6px 10px;
        border-radius: 999px;
        font-family: "Alegreya Sans", "Segoe UI", sans-serif;
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(230, 240, 255, 0.8);
        background: rgba(10, 18, 32, 0.6);
        border: 1px solid rgba(126, 215, 255, 0.35);
      }
    </style>
  </head>
  <body>
    <img id="frame" alt="AI Village feed" />
    <div id="status">Loading...</div>
    <script>
      const img = document.getElementById('frame');
      const status = document.getElementById('status');
      const refreshMs = ${villageCapture.options.intervalMs};
      const tick = () => {
        const ts = Date.now();
        img.src = '/village.jpg?ts=' + ts;
      };
      img.addEventListener('load', () => {
        status.textContent = 'Live';
      });
      img.addEventListener('error', () => {
        status.textContent = 'Connecting';
      });
      tick();
      setInterval(tick, refreshMs);
    </script>
  </body>
</html>`);
});

app.get('/embed/:id', async (req, res) => {
  const embed = getEmbedConfig(req.params.id);
  if (!embed?.url) {
    res.status(404).send('embed_not_found');
    return;
  }
  const embedDebug = parseBooleanQuery(req.query.embed_debug);
  if (embed.mode === 'proxy') {
    try {
      const upstream = await fetch(embed.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (ChibaCable)' },
      });
      const html = await upstream.text();
      if (embedDebug) {
        console.log(
          `[embed] proxy ${req.params.id} ${upstream.status} (${embed.url})`
        );
      }
      res.setHeader('Content-Type', 'text/html');
      res.send(
        buildProxyPage(html, embed, {
          enabled: embedDebug,
          status: upstream.status,
          url: embed.url,
        })
      );
    } catch (err) {
      res.status(502).send(`embed_proxy_failed: ${(err as Error).message}`);
    }
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.send(buildEmbedPage(embed, embedDebug));
});

app.get('/mars', (_req, res) => {
  const viewUrl =
    'https://vdo.ninja/?view=QQA3g6X316&room=Mars_Public_Access_Network&pw=marscollege&scene&api=1';
  const pushUrl =
    'https://vdo.ninja/?push=QQA3g6X316&room=Mars_Public_Access_Network&pw=marscollege';
  const qrUrl =
    'https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=0&data=' +
    encodeURIComponent(pushUrl);
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Mars Public Access Network</title>
    <style>
      html, body {
        height: 100%;
        margin: 0;
        background: #0a0f1a;
      }
      body {
        position: relative;
        overflow: hidden;
        font-family: "Oxanium", "Segoe UI", sans-serif;
        color: #e9f5ff;
      }
      #frame {
        position: absolute;
        inset: 0;
        width: 100vw;
        height: 100vh;
        border: 0;
        display: block;
        background: #0a0f1a;
      }
      #overlay {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        background: radial-gradient(circle at 50% 30%, rgba(40, 80, 140, 0.55), rgba(6, 10, 18, 0.96));
        color: #e9f5ff;
        opacity: 0;
        transition: opacity 220ms ease;
        pointer-events: none;
      }
      #overlay.is-visible {
        opacity: 1;
        pointer-events: auto;
      }
      .panel {
        max-width: min(720px, 90vw);
        padding: 28px;
        border-radius: 18px;
        background: linear-gradient(160deg, rgba(18, 30, 54, 0.96), rgba(8, 14, 24, 0.98));
        border: 1px solid rgba(126, 215, 255, 0.35);
        box-shadow: 0 20px 40px rgba(2, 6, 12, 0.6);
        display: grid;
        gap: 16px;
        text-align: center;
      }
      .title {
        font-size: 1.4rem;
        letter-spacing: 0.3em;
        text-transform: uppercase;
      }
      .subtitle {
        color: rgba(200, 220, 255, 0.75);
        font-size: 0.9rem;
        letter-spacing: 0.2em;
        text-transform: uppercase;
      }
      .qr {
        margin: 0 auto;
        width: 200px;
        height: 200px;
        border-radius: 14px;
        padding: 8px;
        background: rgba(6, 10, 18, 0.85);
        border: 1px solid rgba(126, 215, 255, 0.3);
      }
      .hint {
        font-size: 0.8rem;
        color: rgba(200, 220, 255, 0.8);
      }
      .dismiss {
        justify-self: center;
        padding: 8px 18px;
        border-radius: 999px;
        border: 1px solid rgba(126, 215, 255, 0.4);
        background: rgba(12, 20, 36, 0.85);
        color: #e9f5ff;
        font-size: 0.7rem;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <iframe id="frame" src="${viewUrl}" allow="autoplay; fullscreen; microphone; camera"></iframe>
    <div id="overlay" class="is-visible">
      <div class="panel">
        <div class="title">Mars Public Access Network</div>
        <div class="subtitle">Waiting for Broadcast</div>
        <img class="qr" src="${qrUrl}" alt="QR to broadcast" />
        <div class="hint">Scan to join and broadcast via VDO Ninja.</div>
        <button class="dismiss" id="dismiss">Hide Info</button>
      </div>
    </div>
    <script>
      const overlay = document.getElementById('overlay');
      const dismiss = document.getElementById('dismiss');
      const show = () => overlay.classList.add('is-visible');
      const hide = () => overlay.classList.remove('is-visible');
      dismiss.addEventListener('click', hide);
      window.addEventListener('message', () => hide());
      setTimeout(() => show(), 4000);
    </script>
  </body>
</html>`);
});

app.get('/roadmap', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Chiba Cable | Roadmap Channel 140</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Azeret+Mono:wght@300;400;500&display=swap');
      :root {
        color-scheme: dark;
        --bg: #07090f;
        --panel: rgba(12, 16, 26, 0.92);
        --panel-2: rgba(10, 14, 22, 0.86);
        --accent: #f3b24a;
        --accent-2: #77c4cf;
        --accent-3: #b7d88a;
        --accent-4: #e9a1a8;
        --glow: 0.6;
        --scan-opacity: 0.08;
        --ticker-duration: 26s;
      }
      * {
        box-sizing: border-box;
      }
      html, body {
        height: 100%;
        margin: 0;
        background: var(--bg);
      }
      body {
        font-family: "Azeret Mono", "Segoe UI", sans-serif;
        color: #f2efe8;
        display: grid;
        place-items: center;
        padding: 24px;
      }
      .app {
        width: min(1440px, 96vw);
        height: min(860px, 92vh);
        position: relative;
      }
      .screen {
        position: relative;
        width: 100%;
        height: 100%;
        border-radius: 22px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: linear-gradient(180deg, #0d111c 0%, #070a12 100%);
        box-shadow:
          0 24px 60px rgba(0, 0, 0, 0.6),
          0 0 calc(20px * var(--glow)) rgba(243, 178, 74, 0.2);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        gap: 18px;
        padding: 22px 24px 58px;
      }
      .screen::before {
        content: "";
        position: absolute;
        inset: 0;
        background: repeating-linear-gradient(
          180deg,
          rgba(255, 255, 255, 0.05) 0,
          rgba(255, 255, 255, 0.05) 1px,
          rgba(0, 0, 0, 0) 2px,
          rgba(0, 0, 0, 0) 6px
        );
        opacity: var(--scan-opacity);
        mix-blend-mode: screen;
        pointer-events: none;
        z-index: 1;
      }
      .screen.glitch {
        animation: glitch 0.6s linear;
      }
      .screen > * {
        position: relative;
        z-index: 2;
      }
      .topbar {
        display: grid;
        grid-template-columns: 1.4fr 0.6fr 1.2fr;
        gap: 16px;
        align-items: center;
        text-transform: uppercase;
      }
      .brand-title {
        font-family: "Rajdhani", "Azeret Mono", sans-serif;
        font-size: clamp(1.4rem, 2.4vw, 2.1rem);
        letter-spacing: 0.18em;
        color: #f6e3c2;
      }
      .brand-sub {
        font-size: 0.68rem;
        letter-spacing: 0.34em;
        color: rgba(240, 220, 190, 0.55);
        margin-top: 6px;
      }
      .channel-badge {
        justify-self: center;
        padding: 10px 16px;
        border-radius: 14px;
        background: rgba(12, 16, 24, 0.8);
        border: 1px solid rgba(243, 178, 74, 0.35);
        text-align: center;
      }
      .channel-number {
        font-family: "Rajdhani", "Azeret Mono", sans-serif;
        font-size: 1.7rem;
        letter-spacing: 0.14em;
        font-weight: 600;
      }
      .channel-call {
        font-size: 0.65rem;
        letter-spacing: 0.34em;
        color: rgba(240, 220, 190, 0.6);
      }
      .status {
        display: grid;
        gap: 6px;
        justify-items: end;
        font-size: 0.7rem;
        letter-spacing: 0.18em;
        color: rgba(230, 235, 245, 0.68);
      }
      .status-row {
        display: flex;
        gap: 12px;
        align-items: center;
      }
      .pill {
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 0.6rem;
        letter-spacing: 0.3em;
        background: rgba(12, 18, 32, 0.8);
        border: 1px solid rgba(255, 255, 255, 0.16);
      }
      .pill.live {
        color: #1b1207;
        background: var(--accent);
        border: 0;
      }
      .hero {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        padding: 16px 18px;
        border-radius: 16px;
        background: rgba(11, 15, 24, 0.7);
        border: 1px solid rgba(255, 255, 255, 0.1);
      }
      .hero-title {
        font-family: "Rajdhani", "Azeret Mono", sans-serif;
        font-size: clamp(1.5rem, 2.2vw, 2.3rem);
        letter-spacing: 0.22em;
        text-transform: uppercase;
      }
      .hero-sub {
        font-size: 0.78rem;
        letter-spacing: 0.2em;
        color: rgba(210, 220, 235, 0.6);
        max-width: 420px;
        text-transform: uppercase;
      }
      .main {
        flex: 1;
        display: grid;
        grid-template-columns: 2.2fr 1fr;
        gap: 18px;
        min-height: 0;
      }
      .schedule-panel {
        background: var(--panel);
        border-radius: 18px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        padding: 18px;
        display: grid;
        gap: 16px;
        min-height: 0;
      }
      .schedule {
        display: grid;
        grid-template-columns: 140px repeat(3, minmax(0, 1fr));
        gap: 12px;
        font-size: 0.8rem;
      }
      .schedule-header {
        display: contents;
        text-transform: uppercase;
        letter-spacing: 0.24em;
        color: rgba(240, 220, 190, 0.45);
      }
      .schedule-header .slot {
        padding-bottom: 8px;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      }
      .schedule-row {
        display: contents;
        --row-accent: var(--accent);
      }
      .schedule-row[data-category="dev"] { --row-accent: var(--accent-3); }
      .schedule-row[data-category="curatorial"] { --row-accent: var(--accent-2); }
      .schedule-row[data-category="physical"] { --row-accent: var(--accent-4); }
      .slot-label {
        font-size: 0.72rem;
        letter-spacing: 0.28em;
        text-transform: uppercase;
        align-self: center;
        color: rgba(230, 235, 245, 0.6);
      }
      .slot-card {
        position: relative;
        padding: 16px 16px 18px 18px;
        border-radius: 14px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-left: 2px solid var(--row-accent);
        background: rgba(9, 12, 18, 0.85);
        min-height: 96px;
        display: grid;
        gap: 6px;
      }
      .slot-tag {
        font-size: 0.55rem;
        letter-spacing: 0.26em;
        text-transform: uppercase;
        color: var(--row-accent);
      }
      .slot-title {
        font-family: "Rajdhani", "Azeret Mono", sans-serif;
        font-size: 1rem;
        letter-spacing: 0.08em;
        font-weight: 600;
      }
      .slot-detail {
        font-size: 0.7rem;
        color: rgba(220, 230, 245, 0.62);
        line-height: 1.4;
      }
      .side-panel {
        display: grid;
        gap: 14px;
        min-height: 0;
      }
      .panel-card {
        background: var(--panel-2);
        border-radius: 16px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        padding: 16px;
        display: grid;
        gap: 10px;
      }
      .panel-title {
        font-size: 0.65rem;
        letter-spacing: 0.32em;
        text-transform: uppercase;
        color: rgba(240, 220, 190, 0.55);
      }
      .note {
        font-size: 0.78rem;
        line-height: 1.5;
      }
      .note small {
        color: rgba(255, 255, 255, 0.55);
      }
      .signal {
        display: flex;
        align-items: flex-end;
        gap: 6px;
        height: 46px;
      }
      .signal span {
        flex: 1;
        border-radius: 6px;
        background: linear-gradient(180deg, rgba(243, 178, 74, 0.7), rgba(243, 178, 74, 0.2));
        opacity: 0.7;
        animation: pulse 2.6s ease-in-out infinite;
      }
      .signal span:nth-child(2) { animation-delay: 0.2s; }
      .signal span:nth-child(3) { animation-delay: 0.4s; }
      .signal span:nth-child(4) { animation-delay: 0.6s; }
      .signal span:nth-child(5) { animation-delay: 0.8s; }
      .signal-label {
        font-size: 0.62rem;
        letter-spacing: 0.24em;
        text-transform: uppercase;
        color: rgba(230, 235, 245, 0.55);
      }
      .remote-chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        border-radius: 999px;
        font-size: 0.6rem;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        background: rgba(7, 10, 16, 0.8);
        border: 1px solid rgba(255, 255, 255, 0.16);
      }
      .ticker {
        position: absolute;
        left: 22px;
        right: 22px;
        bottom: 18px;
        height: 26px;
        border-radius: 999px;
        background: rgba(7, 10, 16, 0.7);
        border: 1px solid rgba(255, 255, 255, 0.08);
        overflow: hidden;
        display: flex;
        align-items: center;
        padding: 0 12px;
      }
      .ticker-track {
        display: flex;
        gap: 36px;
        white-space: nowrap;
        animation: ticker var(--ticker-duration) linear infinite;
        font-size: 0.65rem;
        letter-spacing: 0.26em;
        text-transform: uppercase;
      }
      .ticker-track span {
        color: rgba(240, 220, 190, 0.64);
      }
      .app[data-focus="dev"] .schedule-row:not([data-category="dev"]),
      .app[data-focus="curatorial"] .schedule-row:not([data-category="curatorial"]),
      .app[data-focus="physical"] .schedule-row:not([data-category="physical"]) {
        opacity: 0.4;
        filter: grayscale(0.6);
      }
      .app[data-layout="stack"] .schedule {
        grid-template-columns: 1fr;
      }
      .app[data-layout="stack"] .schedule-header {
        display: none;
      }
      .app[data-layout="stack"] .slot-label {
        grid-column: 1 / -1;
        padding-top: 12px;
        font-size: 0.85rem;
      }
      .app[data-layout="stack"] .slot-card {
        grid-column: 1 / -1;
      }
      @keyframes ticker {
        0% { transform: translateX(0); }
        100% { transform: translateX(-50%); }
      }
      @keyframes pulse {
        0%, 100% { transform: scaleY(0.5); opacity: 0.4; }
        50% { transform: scaleY(1); opacity: 0.9; }
      }
      @keyframes glitch {
        0% { transform: translate(0, 0); filter: hue-rotate(0deg); }
        20% { transform: translate(-2px, 1px); filter: hue-rotate(6deg); }
        40% { transform: translate(2px, -1px); filter: hue-rotate(-8deg); }
        60% { transform: translate(-1px, 2px); filter: hue-rotate(4deg); }
        80% { transform: translate(1px, -2px); filter: hue-rotate(-6deg); }
        100% { transform: translate(0, 0); filter: hue-rotate(0deg); }
      }
      @media (max-width: 980px) {
        body {
          padding: 12px;
        }
        .screen {
          padding: 18px 16px 56px;
        }
        .main {
          grid-template-columns: 1fr;
        }
        .topbar {
          grid-template-columns: 1fr;
          text-align: center;
        }
        .status {
          justify-items: center;
        }
      }
    </style>
  </head>
  <body>
    <div id="app" class="app" data-focus="all" data-layout="grid">
      <div class="screen" id="screen">
        <header class="topbar">
          <div>
            <div class="brand-title">Chiba Cable</div>
            <div class="brand-sub">Roadmap Channel</div>
          </div>
          <div class="channel-badge">
            <div class="channel-number">140</div>
            <div class="channel-call">RMAP</div>
          </div>
          <div class="status">
            <div class="status-row">
              <span class="pill live">On Air</span>
              <span id="ws-status">Remote: connecting</span>
            </div>
            <div class="status-row">
              <span id="focus-status">Focus: all</span>
              <span id="clock">--:--</span>
            </div>
          </div>
        </header>

        <section class="hero">
          <div class="hero-title">Roadmap Transmission</div>
          <div class="hero-sub">Signal view of what is next for Chiba Cable.</div>
        </section>

        <div class="main">
          <section class="schedule-panel">
            <div class="schedule">
              <div class="schedule-header">
                <div class="slot-label">Track</div>
                <div class="slot">Now</div>
                <div class="slot">Next</div>
                <div class="slot">Later</div>
              </div>

              <div class="schedule-row" data-category="dev">
                <div class="slot-label">Dev</div>
                <div class="slot-card">
                  <div class="slot-tag">Now</div>
                  <div class="slot-title">Channel Editor Agent</div>
                  <div class="slot-detail">Let Chiba edit listings, swap channels, and tune the grid live.</div>
                </div>
                <div class="slot-card">
                  <div class="slot-tag">Next</div>
                  <div class="slot-title">Bumpers & Commercials</div>
                  <div class="slot-detail">Modular bumpers, stingers, sponsor breaks, and interstitials.</div>
                </div>
                <div class="slot-card">
                  <div class="slot-tag">Later</div>
                  <div class="slot-title">Class AV Streams</div>
                  <div class="slot-detail">Connect live AV feeds for classes and workshops.</div>
                </div>
              </div>

              <div class="schedule-row" data-category="curatorial">
                <div class="slot-label">Curatorial</div>
                <div class="slot-card">
                  <div class="slot-tag">Now</div>
                  <div class="slot-title">More Channels</div>
                  <div class="slot-detail">Expand the lineup with new editorial and experimental lanes.</div>
                </div>
                <div class="slot-card">
                  <div class="slot-tag">Next</div>
                  <div class="slot-title">Curate the NAS</div>
                  <div class="slot-detail">Tag, label, and surface hidden archives in the media vault.</div>
                </div>
                <div class="slot-card">
                  <div class="slot-tag">Later</div>
                  <div class="slot-title">Creative Rotations</div>
                  <div class="slot-detail">Seasonal mixes, themed takeovers, guest curators.</div>
                </div>
              </div>

              <div class="schedule-row" data-category="physical">
                <div class="slot-label">Physical</div>
                <div class="slot-card">
                  <div class="slot-tag">Now</div>
                  <div class="slot-title">Satellite Screens</div>
                  <div class="slot-detail">Install Chiba Cable screens in kitchens and camp clubhouses.</div>
                </div>
                <div class="slot-card">
                  <div class="slot-tag">Next</div>
                  <div class="slot-title">Call-In Shows</div>
                  <div class="slot-detail">Phone system integration for live call-ins and request lines.</div>
                </div>
                <div class="slot-card">
                  <div class="slot-tag">Later</div>
                  <div class="slot-title">Biennale Room</div>
                  <div class="slot-detail">Set up a dedicated Chiba Cable room for the Biennale.</div>
                </div>
              </div>
            </div>
          </section>

          <aside class="side-panel">
            <div class="panel-card">
              <div class="panel-title">Studio Notes</div>
              <div class="note">Weekly channel scans, editing passes, and clear lineup gaps.</div>
              <div class="note">Add new "roadmap" promos between blocks.</div>
              <div class="note"><small>Priority: build momentum with bumpers + remote control moments.</small></div>
            </div>
            <div class="panel-card">
              <div class="panel-title">Signal Meter</div>
              <div class="signal">
                <span style="height: 28px"></span>
                <span style="height: 36px"></span>
                <span style="height: 42px"></span>
                <span style="height: 32px"></span>
                <span style="height: 46px"></span>
              </div>
              <div class="signal-label">140 • Roadmap</div>
            </div>
            <div class="panel-card">
              <div class="panel-title">Phone Controls</div>
              <div class="note">
                <span class="remote-chip">/remote?app=roadmap</span>
              </div>
              <div class="note"><small>Focus, layout, scanlines, glow, glitch.</small></div>
            </div>
          </aside>
        </div>

        <div class="ticker" id="ticker">
          <div class="ticker-track">
            <span>Chiba Cable Roadmap • Channel 140 • Remote controls live • More channels incoming • Call-in shows + AV streams • Curate the NAS • Biennale buildout •</span>
            <span>Chiba Cable Roadmap • Channel 140 • Remote controls live • More channels incoming • Call-in shows + AV streams • Curate the NAS • Biennale buildout •</span>
          </div>
        </div>
      </div>
    </div>

    <script>
      const app = document.getElementById("app");
      const screen = document.getElementById("screen");
      const clock = document.getElementById("clock");
      const focusStatus = document.getElementById("focus-status");
      const wsStatus = document.getElementById("ws-status");
      const ticker = document.getElementById("ticker");
      const root = document.documentElement;

      const controlSchema = [
        {
          id: "focus",
          label: "Focus",
          type: "select",
          value: "all",
          options: [
            { value: "all", label: "All" },
            { value: "dev", label: "Dev" },
            { value: "curatorial", label: "Curatorial" },
            { value: "physical", label: "Physical" },
            { value: "cycle", label: "Cycle" },
          ],
        },
        {
          id: "layout",
          label: "Layout",
          type: "select",
          value: "grid",
          options: [
            { value: "grid", label: "Grid" },
            { value: "stack", label: "Stack" },
          ],
        },
        {
          id: "tempo",
          label: "Tempo",
          type: "range",
          min: 1,
          max: 10,
          step: 1,
          value: 6,
        },
        {
          id: "scan",
          label: "Scanlines",
          type: "range",
          min: 0,
          max: 1,
          step: 0.05,
          value: 0.35,
        },
        {
          id: "glow",
          label: "Glow",
          type: "range",
          min: 0.6,
          max: 1.6,
          step: 0.05,
          value: 1,
        },
        {
          id: "ticker",
          label: "Ticker",
          type: "toggle",
          value: true,
        },
        {
          id: "glitch",
          label: "Glitch",
          type: "button",
        },
      ];

      const state = {
        focus: "all",
        layout: "grid",
        tempo: 6,
        scan: 0.35,
        glow: 1,
        ticker: true,
      };

      const cycleOrder = ["dev", "curatorial", "physical"];
      let cycleTimer = null;

      function updateClock() {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, "0");
        const minutes = String(now.getMinutes()).padStart(2, "0");
        clock.textContent = hours + ":" + minutes;
      }

      function formatFocus(value) {
        if (!value) return "All";
        if (value === "all") return "All";
        return value.charAt(0).toUpperCase() + value.slice(1);
      }

      function setTickerSpeed() {
        const duration = Math.max(10, 34 - state.tempo * 2.2);
        root.style.setProperty("--ticker-duration", duration.toFixed(1) + "s");
      }

      function stopCycle() {
        if (cycleTimer) {
          clearInterval(cycleTimer);
          cycleTimer = null;
        }
      }

      function startCycle() {
        stopCycle();
        let index = 0;
        const interval = Math.max(1800, 8000 - state.tempo * 500);
        const tick = () => {
          const next = cycleOrder[index % cycleOrder.length];
          app.dataset.focus = next;
          focusStatus.textContent = "Focus: " + formatFocus(next) + " (cycle)";
          index += 1;
        };
        tick();
        cycleTimer = setInterval(tick, interval);
      }

      function applyFocus() {
        if (state.focus === "cycle") {
          startCycle();
          return;
        }
        stopCycle();
        app.dataset.focus = state.focus;
        focusStatus.textContent = "Focus: " + formatFocus(state.focus);
      }

      function applyState() {
        app.dataset.layout = state.layout;
        root.style.setProperty("--scan-opacity", state.scan.toFixed(2));
        root.style.setProperty("--glow", state.glow.toFixed(2));
        ticker.style.display = state.ticker ? "flex" : "none";
        setTickerSpeed();
        applyFocus();
      }

      function triggerGlitch() {
        screen.classList.remove("glitch");
        void screen.offsetWidth;
        screen.classList.add("glitch");
      }

      function coerceValue(control, value) {
        if (control.type === "range") return Number(value);
        if (control.type === "toggle") return Boolean(value);
        return value;
      }

      function applyControl(controlId, value) {
        if (controlId === "glitch") {
          triggerGlitch();
          return;
        }
        if (controlId in state) {
          state[controlId] = value;
          applyState();
        }
      }

      function bootRemote() {
        const params = new URLSearchParams(window.location.search);
        const appId = params.get("appId") || params.get("app") || "roadmap";
        const wsParam = params.get("ws");
        const protocol = window.location.protocol === "https:" ? "wss" : "ws";
        const wsUrl = wsParam || protocol + "://" + window.location.host + "/ws";
        const socket = new WebSocket(wsUrl);

        socket.addEventListener("open", () => {
          wsStatus.textContent = "Remote: linked";
          socket.send(
            JSON.stringify({
              type: "controls",
              appId: appId,
              controls: controlSchema,
            })
          );
        });

        socket.addEventListener("close", () => {
          wsStatus.textContent = "Remote: offline";
        });

        socket.addEventListener("error", () => {
          wsStatus.textContent = "Remote: error";
        });

        socket.addEventListener("message", (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type !== "control" || msg.appId !== appId) return;
            const control = controlSchema.find((item) => item.id === msg.controlId);
            if (!control) return;
            applyControl(control.id, coerceValue(control, msg.value));
          } catch (err) {
            console.warn("remote message failed", err);
          }
        });
      }

      updateClock();
      setInterval(updateClock, 1000 * 30);
      applyState();
      bootRemote();
    </script>
  </body>
</html>`);
});

app.get('/weatherstar.jpg', (_req, res) => {
  const frame = weatherstarCapture.getFrame();
  if (!frame) {
    res.status(503).send('capture_not_ready');
    return;
  }
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.send(frame.buffer);
});

app.get('/weatherstar', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>WeatherStar</title>
    <style>
      html, body {
        height: 100%;
        margin: 0;
        background: #05060a;
      }
      body {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
      }
      #frame {
        width: 100vw;
        height: 100vh;
        object-fit: cover;
        object-position: center;
        display: block;
        background: #05060a;
      }
      #status {
        position: absolute;
        top: 16px;
        right: 16px;
        padding: 6px 10px;
        border-radius: 999px;
        font-family: "Alegreya Sans", "Segoe UI", sans-serif;
        font-size: 12px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(230, 240, 255, 0.8);
        background: rgba(6, 12, 24, 0.55);
        border: 1px solid rgba(120, 200, 255, 0.35);
      }
    </style>
  </head>
  <body>
    <img id="frame" alt="WeatherStar feed" />
    <div id="status">Loading...</div>
    <script>
      const img = document.getElementById('frame');
      const status = document.getElementById('status');
      const refreshMs = ${weatherstarCapture.options.intervalMs};
      const tick = () => {
        const ts = Date.now();
        img.src = '/weatherstar.jpg?ts=' + ts;
      };
      img.addEventListener('load', () => {
        status.textContent = 'Live';
      });
      img.addEventListener('error', () => {
        status.textContent = 'Connecting';
      });
      tick();
      setInterval(tick, refreshMs);
    </script>
  </body>
</html>`);
});

app.use(express.static(distDir, { index: false }));

function getBaseUrl(req: express.Request): string {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(forwardedProto)
    ? forwardedProto[0]
    : forwardedProto?.split(',')[0];
  const scheme = proto ?? (req.secure ? 'https' : 'http');
  const host = req.headers.host ?? `localhost:${PORT}`;
  return `${scheme}://${host}`;
}

const QR_BASE =
  'https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=0&data=';

type RemoteBaseOptions = {
  scheme?: string | null;
  port?: number | null;
};

function getLanAddress(): string | null {
  const nets = os.networkInterfaces();
  const candidates: Array<{ addr: string; score: number }> = [];
  for (const entries of Object.values(nets)) {
    for (const info of entries ?? []) {
      if (!info) continue;
      if (info.family !== 'IPv4' || info.internal) continue;
      const addr = info.address;
      if (addr.startsWith('169.254.')) continue;
      let score = 1;
      if (addr.startsWith('192.168.')) score = 4;
      else if (addr.startsWith('10.')) score = 3;
      else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(addr)) score = 3;
      else if (addr.startsWith('100.')) score = 2;
      candidates.push({ addr, score });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.addr ?? null;
}

function normalizeRemoteBase(input: string, fallback: string): string {
  const trimmed = input.trim();
  if (!trimmed) return fallback;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

function getRemoteBaseUrl(
  req: express.Request,
  options: RemoteBaseOptions = {}
): string {
  const configured =
    loadedConfig?.config?.server?.remote_url ??
    process.env.CHIBA_REMOTE_URL ??
    '';
  const fallback = getBaseUrl(req);
  if (configured) {
    return normalizeRemoteBase(configured, fallback);
  }
  const scheme =
    options.scheme ??
    (req.secure ? 'https' : 'http');
  const port = options.port ?? PORT;
  const lan = getLanAddress();
  if (lan) {
    return `${scheme}://${lan}${port ? `:${port}` : ''}`;
  }
  return fallback;
}

async function sendIndex(req: express.Request, res: express.Response) {
  try {
    const html = await fsp.readFile(indexFile, 'utf-8');
    const remoteBaseUrl = getRemoteBaseUrl(req, { port: PORT });
    const payload = html.replace('__REMOTE_URL__', remoteBaseUrl);
    res.setHeader('Content-Type', 'text/html');
    res.send(payload);
  } catch (err) {
    res.status(500).send('Missing guide build. Run: pnpm -C apps/guide build');
  }
}

app.get('*', (req, res) => {
  if (req.path.startsWith('/ws')) {
    res.status(426).send('WebSocket only');
    return;
  }
  sendIndex(req, res);
});

const heartbeatTimer = setInterval(() => {
  wss.clients.forEach((client) => {
    const alive = wsAlive.get(client);
    if (alive === false) {
      console.warn('[ws] terminating stale client');
      client.terminate();
      return;
    }
    wsAlive.set(client, false);
    try {
      client.ping();
    } catch (err) {
      console.warn('[ws] ping failed', (err as Error).message);
    }
  });
}, WS_HEARTBEAT_MS);

wss.on('connection', (socket, req) => {
  wsAlive.set(socket, true);
  console.log('[ws] client connected', req.socket.remoteAddress ?? 'unknown');
  socket.on('pong', () => {
    wsAlive.set(socket, true);
  });
  socket.on('close', (code, reason) => {
    const detail = reason?.toString?.() ?? '';
    console.log('[ws] client closed', code, detail);
  });
  socket.on('error', (err) => {
    console.warn('[ws] client error', err.message);
  });
  socket.on('message', (data) => {
    const message = data.toString();
    try {
      const parsed = JSON.parse(message) as { type?: string; appId?: string; controls?: RemoteControl[] };
      if (parsed?.type === 'controls' && parsed.appId && Array.isArray(parsed.controls)) {
        controlSchemas.set(parsed.appId, {
          appId: parsed.appId,
          controls: parsed.controls,
          updatedAt: Date.now(),
        });
      }
    } catch {
      // ignore parse errors
    }
    wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(message);
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`Guide server running on http://localhost:${PORT}`);
  void villageCapture.start();
  void weatherstarCapture.start();
});

server.on('close', () => {
  clearInterval(heartbeatTimer);
});
