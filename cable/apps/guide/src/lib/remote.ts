import { PARAM_WS } from "../constants/params";

const QR_BASE =
  "https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=0&data=";

export function getWsUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const wsParam = params.get(PARAM_WS);
  if (wsParam) return wsParam;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
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
  const qrUrl = `${QR_BASE}${encodeURIComponent(remoteUrl)}`;
  return { baseUrl, remoteUrl, qrUrl };
}
