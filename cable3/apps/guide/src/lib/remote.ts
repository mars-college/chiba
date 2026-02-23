import { PARAM_WS } from "../constants/params";

const QR_BASE =
  "https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=0&data=";

const WS_STORAGE_KEY = "chiba:ws";

function readScreenId(params: URLSearchParams): string {
  const raw = params.get("screenId") ?? params.get("screen") ?? "";
  return raw.trim();
}

function withScreenId(wsUrl: string, screenId: string): string {
  if (!screenId) return wsUrl;
  try {
    const parsed = new URL(wsUrl);
    if (!parsed.searchParams.get("screenId")) {
      parsed.searchParams.set("screenId", screenId);
    }
    return parsed.toString();
  } catch {
    const join = wsUrl.includes("?") ? "&" : "?";
    return `${wsUrl}${join}screenId=${encodeURIComponent(screenId)}`;
  }
}

export function getWsUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const screenId = readScreenId(params);
  const wsParam = params.get(PARAM_WS);
  if (wsParam) return withScreenId(wsParam, screenId);
  // In kiosk/gallery mode, ignore persisted WS targets. These are usually set
  // during debugging and can cause a kiosk to "stick" to a stale LAN host.
  const gallery = (params.get("gallery") ?? "").trim().toLowerCase();
  const isGallery =
    gallery === "1" || gallery === "true" || gallery === "yes" || gallery === "on";
  if (!isGallery) {
    try {
      const stored = window.localStorage.getItem(WS_STORAGE_KEY);
      if (stored && stored.trim().length > 0) {
        return withScreenId(stored.trim(), screenId);
      }
    } catch {
      // ignore storage errors
    }
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const base = `${protocol}//${window.location.host}/ws`;
  return withScreenId(base, screenId);
}

type RemoteUrlOptions = {
  hostOverride?: string | null;
  forceHttps?: boolean;
  metaRemote?: string | null;
  location?: Location;
};

const isPrivateHost = (host: string) =>
  host === "localhost" ||
  host.endsWith(".local") ||
  /^10\./.test(host) ||
  /^192\.168\./.test(host) ||
  /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);

const normalizeBase = (input: string, forceHttps: boolean) => {
  const withScheme = input.includes("://") ? input : `http://${input}`;
  try {
    const url = new URL(withScheme);
    if (!forceHttps && isPrivateHost(url.hostname)) {
      url.protocol = "http:";
    }
    return url.origin;
  } catch {
    return withScheme;
  }
};

export function resolveRemoteBaseUrl(options: RemoteUrlOptions): string {
  const location = options.location ?? window.location;
  const metaRemote = options.metaRemote ?? "";
  const hasMeta = metaRemote && !metaRemote.includes("__REMOTE_URL__");
  const forceHttps = Boolean(options.forceHttps);

  if (options.hostOverride) {
    const host = options.hostOverride;
    const withPort = host.includes(":") ? host : `${host}:${location.port}`;
    return normalizeBase(withPort, forceHttps);
  }
  if (hasMeta) {
    return normalizeBase(metaRemote, forceHttps);
  }
  return normalizeBase(`${location.protocol}//${location.host}`, forceHttps);
}

export function buildRemoteUrls(options: RemoteUrlOptions) {
  const baseUrl = resolveRemoteBaseUrl(options);
  const remoteUrl = `${baseUrl}/remote`;
  const qrUrl = buildQrUrl(remoteUrl);
  return { baseUrl, remoteUrl, qrUrl };
}

export function buildQrUrl(remoteUrl: string): string {
  return `${QR_BASE}${encodeURIComponent(remoteUrl)}`;
}
