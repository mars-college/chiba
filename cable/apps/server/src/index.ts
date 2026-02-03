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
  embedId: string,
  debug?: { enabled: boolean; status?: number; url?: string }
) => {
  const selectors = embed.dismiss_selectors ?? [];
  const hideCss = selectors.length
    ? selectors.map((sel) => `${sel}{display:none !important; visibility:hidden !important;}`).join('')
    : '';
  const baseHref = embed.url ?? '';
  const proxyPrefix = `/embed/${embedId}/proxy`;
  const upstreamOrigin = embed.url ? new URL(embed.url).origin : '';
  const upstreamHost = embed.url ? new URL(embed.url).host : '';
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
          const proxyBase = baseOrigin + window.location.pathname.replace(/\\/$/, '') + '/proxy';
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
          const upstreamOrigin = ${JSON.stringify(upstreamOrigin)} || null;
          const rewriteUrl = (input) => {
            try {
              const raw = normalizeUrlArg(input);
              if (!raw) return input;
              if (typeof raw === 'string' && raw.startsWith(proxyBase)) {
                return raw;
              }
              if (upstreamOrigin && typeof raw === 'string' && raw.startsWith('/')) {
                return proxyBase + raw;
              }
              const resolved = new URL(raw, document.baseURI);
              if (!upstreamOrigin) return input;
              if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return input;
              if (resolved.origin !== upstreamOrigin) return input;
              return proxyBase + resolved.pathname + resolved.search + resolved.hash;
            } catch {
              return input;
            }
          };
          const rewriteAsset = (input) => {
            try {
              const raw = normalizeUrlArg(input);
              if (!raw) return input;
              if (typeof raw === 'string' && raw.startsWith(proxyBase)) {
                return raw;
              }
              if (
                typeof raw === 'string' &&
                (raw.startsWith('data:') ||
                  raw.startsWith('blob:') ||
                  raw.startsWith('mailto:') ||
                  raw.startsWith('javascript:') ||
                  raw.startsWith('#'))
              ) {
                return input;
              }
              if (upstreamOrigin && typeof raw === 'string' && raw.startsWith('/')) {
                return proxyBase + raw;
              }
              const resolved = new URL(raw, document.baseURI);
              if (!upstreamOrigin) return input;
              if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return input;
              if (resolved.origin !== upstreamOrigin) return input;
              return proxyBase + resolved.pathname + resolved.search + resolved.hash;
            } catch {
              return input;
            }
          };
          try {
            const locProto = Object.getPrototypeOf(window.location);
            if (locProto?.assign) {
              const originalAssign = locProto.assign;
              locProto.assign = function (url) {
                return originalAssign.call(this, rewriteUrl(url));
              };
            }
            if (locProto?.replace) {
              const originalReplace = locProto.replace;
              locProto.replace = function (url) {
                return originalReplace.call(this, rewriteUrl(url));
              };
            }
          } catch {
            // ignore location override failures
          }
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
          try {
            const originalFetch = window.fetch ? window.fetch.bind(window) : null;
            if (originalFetch) {
              window.fetch = (input, init) => {
                if (input instanceof Request) {
                  const rewrittenUrl = rewriteUrl(input.url);
                  if (typeof rewrittenUrl === 'string' && rewrittenUrl !== input.url) {
                    const nextRequest = new Request(rewrittenUrl, input);
                    return originalFetch(nextRequest, init);
                  }
                  return originalFetch(input, init);
                }
                const rewritten = rewriteUrl(input);
                if (rewritten !== input) {
                  return originalFetch(rewritten, init);
                }
                return originalFetch(input, init);
              };
            }
          } catch {
            // ignore fetch override failures
          }
          try {
            const originalOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function (method, url, ...rest) {
              const rewritten = rewriteUrl(url);
              return originalOpen.call(this, method, rewritten, ...rest);
            };
          } catch {
            // ignore xhr override failures
          }
          const patchAttr = (proto, prop, rewrite) => {
            try {
              const desc = Object.getOwnPropertyDescriptor(proto, prop);
              if (!desc || !desc.set) return;
              Object.defineProperty(proto, prop, {
                ...desc,
                set(value) {
                  return desc.set.call(this, rewrite(value));
                },
              });
            } catch {
              // ignore attribute override failures
            }
          };
          patchAttr(HTMLScriptElement.prototype, 'src', rewriteAsset);
          patchAttr(HTMLLinkElement.prototype, 'href', rewriteAsset);
          patchAttr(HTMLImageElement.prototype, 'src', rewriteAsset);
          try {
            const originalSetAttribute = Element.prototype.setAttribute;
            Element.prototype.setAttribute = function (name, value) {
              if (typeof name === 'string') {
                const lower = name.toLowerCase();
                if (lower === 'src' || lower === 'href') {
                  return originalSetAttribute.call(this, name, rewriteAsset(value));
                }
              }
              return originalSetAttribute.call(this, name, value);
            };
          } catch {
            // ignore setAttribute override failures
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
  const rewriteAssetUrl = (url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return url;
    if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('mailto:') || trimmed.startsWith('javascript:') || trimmed.startsWith('#')) {
      return url;
    }
    if (trimmed.startsWith(proxyPrefix)) return url;
    if (upstreamOrigin && trimmed.startsWith(upstreamOrigin)) {
      return `${proxyPrefix}${trimmed.slice(upstreamOrigin.length)}`;
    }
    if (upstreamHost && trimmed.startsWith(`//${upstreamHost}`)) {
      return `${proxyPrefix}${trimmed.slice(2 + upstreamHost.length)}`;
    }
    if (trimmed.startsWith('/')) {
      return `${proxyPrefix}${trimmed}`;
    }
    return url;
  };
  const rewriteSrcset = (value: string) => {
    return value
      .split(',')
      .map((part) => {
        const [urlPart, descriptor] = part.trim().split(/\s+/, 2);
        if (!urlPart) return part;
        const rewritten = rewriteAssetUrl(urlPart);
        return descriptor ? `${rewritten} ${descriptor}` : rewritten;
      })
      .join(', ');
  };
  let output = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');
  output = output.replace(/<base[^>]*>/gi, '');
  output = output.replace(/\s(src|href)=["']([^"']+)["']/gi, (match, attr, value) => {
    const rewritten = rewriteAssetUrl(value);
    return ` ${attr}="${rewritten}"`;
  });
  output = output.replace(/\s(srcset)=["']([^"']+)["']/gi, (match, attr, value) => {
    const rewritten = rewriteSrcset(value);
    return ` ${attr}="${rewritten}"`;
  });
  const injection = `<base href="${proxyPrefix}/"/><style>${hideCss}${debugStyle}</style>${injectScript}${debugScript}`;
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
  const wsBaseUrl = getRemoteBaseUrl(req, { port: PORT, scheme });
  let wsUrl = '';
  try {
    const wsParsed = new URL(wsBaseUrl);
    wsParsed.protocol = wsParsed.protocol === 'https:' ? 'wss:' : 'ws:';
    wsUrl = `${wsParsed.origin}/ws`;
  } catch {
    wsUrl = '';
  }
  const remoteUrl = wsUrl
    ? `${baseUrl}/remote?ws=${encodeURIComponent(wsUrl)}`
    : `${baseUrl}/remote`;
  const qrUrl = `${QR_BASE}${encodeURIComponent(remoteUrl)}`;
  res.json({ baseUrl, remoteUrl, qrUrl, wsUrl });
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

app.all('/embed/:id/proxy/*', async (req, res) => {
  const embed = getEmbedConfig(req.params.id);
  if (!embed?.url) {
    res.status(404).send('embed_not_found');
    return;
  }
  const base = new URL(embed.url);
  const prefix = `/embed/${req.params.id}/proxy`;
  const rawSuffix = req.originalUrl.startsWith(prefix)
    ? req.originalUrl.slice(prefix.length)
    : req.originalUrl.replace(`/embed/${req.params.id}/proxy`, "");
  const suffix = rawSuffix || "/";
  const targetUrl = new URL(suffix, base);
  const method = req.method.toUpperCase();
  const headers = new Headers();
  Object.entries(req.headers).forEach(([key, value]) => {
    if (!value) return;
    if (key.toLowerCase() === "host") return;
    if (Array.isArray(value)) {
      headers.set(key, value.join(","));
    } else {
      headers.set(key, value);
    }
  });
  headers.set("User-Agent", "Mozilla/5.0 (ChibaCable)");
  let body: Buffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    body = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  try {
    const upstream = await fetch(targetUrl, {
      method,
      headers,
      body: body as any,
      redirect: "follow",
    });
    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (lower === "content-encoding") return;
      if (lower === "content-length") return;
      if (lower === "transfer-encoding") return;
      res.setHeader(key, value);
    });
    const data = Buffer.from(await upstream.arrayBuffer());
    res.send(data);
  } catch (err) {
    res.status(502).send(`embed_proxy_failed: ${(err as Error).message}`);
  }
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
        buildProxyPage(html, embed, req.params.id, {
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
      @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');
      :root {
        color-scheme: dark;
        --bg: #040506;
        --ink: #f9f4ea;
        --ink-soft: rgba(249, 244, 234, 0.6);
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
        font-family: "Press Start 2P", monospace;
        color: var(--ink);
        display: grid;
        place-items: center;
        padding: 0;
      }
      .stage {
        width: 100vw;
        height: 100vh;
        display: grid;
        place-items: center;
        background: #000;
      }
      .frame {
        position: relative;
        width: min(1200px, 96vw);
        aspect-ratio: 1024 / 666;
        background: #000;
        overflow: hidden;
      }
      .frame img {
        width: 100%;
        height: 100%;
        object-fit: contain;
        image-rendering: pixelated;
      }
      .frame.glitch {
        animation: glitch 0.5s linear;
      }
      .overlay {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        pointer-events: none;
        padding-bottom: 12%;
      }
      .title {
        --title-size: clamp(1.2rem, 2.4vw, 2.8rem);
        font-size: var(--title-size);
        letter-spacing: 0.12em;
        line-height: 1.35;
        text-align: center;
        white-space: pre-line;
        text-transform: uppercase;
        color: var(--ink);
        text-shadow: 0 3px 0 rgba(0, 0, 0, 0.6);
        max-width: 82%;
      }
      @keyframes glitch {
        0% { transform: translate(0, 0); filter: hue-rotate(0deg); }
        20% { transform: translate(-2px, 1px); filter: hue-rotate(6deg); }
        40% { transform: translate(2px, -1px); filter: hue-rotate(-8deg); }
        60% { transform: translate(-1px, 2px); filter: hue-rotate(4deg); }
        80% { transform: translate(1px, -2px); filter: hue-rotate(-6deg); }
        100% { transform: translate(0, 0); filter: hue-rotate(0deg); }
      }
      @media (max-width: 900px) {
        .frame {
          width: 100vw;
        }
        .title {
          max-width: 90%;
        }
      }
    </style>
  </head>
  <body>
    <div class="stage">
      <div class="frame" id="image-shell">
        <img id="frame" src="/assets/roadmap/remote-idle-1.jpg" alt="Roadmap teletext" />
        <div class="overlay">
          <div class="title" id="slide-title"></div>
        </div>
      </div>
    </div>

    <script>
      const frame = document.getElementById("frame");
      const slideTitle = document.getElementById("slide-title");
      const imageShell = document.getElementById("image-shell");

      const frames = {
        idle: [
          "/assets/roadmap/remote-idle-1.jpg",
          "/assets/roadmap/remote-idle-2.jpg",
        ],
        anim: "/assets/roadmap/remote-anim-1.jpg",
      };

      const slides = [
        "ROADMAP",
        "LET CHIBA CONTROL THE TV",
        "BUMPERS / COMMERCIALS MODULE",
        "AV STREAMS OF CLASSES",
        "MORE CHANNELS! (I NEED HELP)",
        "CURATE THE NAS",
        "CHIBA CABLE SCREENS AROUND CAMP",
        "CALL-IN SHOWS WITH PHONES",
        "CALL THE TV STATION TO ADD FEATURES TO THE APP",
        "CHIBA CABLE AT BIENNALE",
      ];

      const idleIntervalMs = 500;
      const transitionMs = 840;
      const typeIntervalMs = 38;

      let idleTimer = null;
      let transitionTimer = null;
      let typeTimer = null;
      let idleIndex = 0;
      let slideIndex = 0;
      let isTransitioning = false;

      function wrapText(text, maxLen) {
        const words = text.split(" ");
        const lines = [];
        let line = "";
        words.forEach((word) => {
          const next = line ? line + " " + word : word;
          if (next.length > maxLen && line) {
            lines.push(line);
            line = word;
          } else {
            line = next;
          }
        });
        if (line) lines.push(line);
        return lines;
      }

      function computeTitleSize(lines) {
        const longest = lines.reduce((max, line) => Math.max(max, line.length), 0);
        let size = 2.6;
        if (longest <= 10) size = 3.0;
        else if (longest <= 16) size = 2.5;
        else if (longest <= 22) size = 2.0;
        else if (longest <= 28) size = 1.6;
        else size = 1.3;
        if (lines.length >= 3) size *= 0.9;
        return size.toFixed(2) + "rem";
      }

      function stopTyping() {
        if (typeTimer) {
          clearInterval(typeTimer);
          typeTimer = null;
        }
      }

      function renderTitle(text) {
        stopTyping();
        const lines = wrapText(text, 22);
        const fullText = lines.join("\\n");
        slideTitle.style.setProperty("--title-size", computeTitleSize(lines));
        slideTitle.textContent = "";
        let index = 0;
        typeTimer = setInterval(() => {
          index += 1;
          slideTitle.textContent = fullText.slice(0, index);
          if (index >= fullText.length) {
            stopTyping();
          }
        }, typeIntervalMs);
      }

      function clampIndex(index) {
        const count = slides.length;
        return ((index % count) + count) % count;
      }

      function updateSlide(index) {
        slideIndex = clampIndex(index);
        renderTitle(slides[slideIndex]);
      }

      function stopIdle() {
        if (idleTimer) {
          clearInterval(idleTimer);
          idleTimer = null;
        }
      }

      function startIdle() {
        stopIdle();
        idleIndex = 0;
        frame.src = frames.idle[idleIndex];
        idleTimer = setInterval(() => {
          idleIndex = (idleIndex + 1) % frames.idle.length;
          frame.src = frames.idle[idleIndex];
        }, idleIntervalMs);
      }

      function playTransition(nextIndex) {
        if (isTransitioning) return;
        isTransitioning = true;
        stopTyping();
        stopIdle();
        frame.src = frames.anim;
        updateSlide(nextIndex);
        if (transitionTimer) clearTimeout(transitionTimer);
        transitionTimer = setTimeout(() => {
          frame.src = frames.idle[0];
          startIdle();
          isTransitioning = false;
        }, transitionMs);
      }

      function nextSlide() {
        playTransition(slideIndex + 1);
      }

      function prevSlide() {
        playTransition(slideIndex - 1);
      }

      function triggerGlitch() {
        imageShell.classList.remove("glitch");
        void imageShell.offsetWidth;
        imageShell.classList.add("glitch");
        setTimeout(() => imageShell.classList.remove("glitch"), 500);
      }

      function bootRemote() {
        const params = new URLSearchParams(window.location.search);
        const appId = params.get("appId") || params.get("app") || "roadmap";
        const wsParam = params.get("ws");
        const protocol = window.location.protocol === "https:" ? "wss" : "ws";
        const wsUrl = wsParam || protocol + "://" + window.location.host + "/ws";
        const socket = new WebSocket(wsUrl);

        const controlSchema = [
          { id: "next", label: "Next", type: "button" },
          { id: "prev", label: "Prev", type: "button" },
          { id: "glitch", label: "Glitch", type: "button" },
        ];

        socket.addEventListener("open", () => {
          socket.send(
            JSON.stringify({
              type: "controls",
              appId: appId,
              controls: controlSchema,
            })
          );
        });

        socket.addEventListener("message", (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type !== "control" || msg.appId !== appId) return;
            if (msg.controlId === "next") nextSlide();
            if (msg.controlId === "prev") prevSlide();
            if (msg.controlId === "glitch") triggerGlitch();
          } catch (err) {
            console.warn("remote message failed", err);
          }
        });
      }

      document.addEventListener("keydown", (event) => {
        if (event.key === "ArrowRight") nextSlide();
        if (event.key === "ArrowLeft") prevSlide();
      });

      updateSlide(0);
      startIdle();
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

app.use(
  '/assets',
  express.static(path.resolve(__dirname, '../../guide/public/assets'), {
    index: false,
  })
);
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
  const remoteAddr = req.socket.remoteAddress ?? 'unknown';
  wsAlive.set(socket, true);
  console.log('[ws] client connected', remoteAddr);
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
      const parsed = JSON.parse(message) as {
        type?: string;
        role?: string;
        origin?: string;
        path?: string;
        appId?: string;
        controls?: RemoteControl[];
      };
      if (parsed?.type === 'hello' && parsed.role) {
        console.log('[ws] hello', remoteAddr, parsed.role, parsed.origin ?? '', parsed.path ?? '');
      }
      if (parsed?.type === 'mouse' || parsed?.type === 'keyboard') {
        console.log('[ws] input', remoteAddr, parsed.type);
      }
      if (parsed?.type === 'controls' && parsed.appId && Array.isArray(parsed.controls)) {
        controlSchemas.set(parsed.appId, {
          appId: parsed.appId,
          controls: parsed.controls,
          updatedAt: Date.now(),
        });
      }
    } catch {
      // ignore parse errors
      console.warn('[ws] message parse failed', message);
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
