import type { MediaKind } from "../types/guide";

function inferKindFromPathLike(value: string | null | undefined): MediaKind | null {
  if (!value) return null;
  const cleaned = value.split("?")[0]?.split("#")[0]?.toLowerCase() ?? "";
  if (!cleaned) return null;
  if (/\.(png|jpg|jpeg|gif|webp|avif|bmp|svg)$/i.test(cleaned)) return "image";
  if (/\.(mp4|webm|ogg|m4v|mov|mkv|m3u8)$/i.test(cleaned)) return "video";
  if (/\.(mp3|wav|aac|m4a|flac|oga)$/i.test(cleaned)) return "audio";
  return null;
}

function safeDecode(value: string | null): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function getMediaKind(url: string): MediaKind {
  const direct = inferKindFromPathLike(url);
  if (direct) return direct;

  try {
    const parsed = new URL(url, window.location.origin);
    const fromPath = inferKindFromPathLike(parsed.pathname);
    if (fromPath) return fromPath;

    // Proxy endpoints like /stash/raw and /cache/raw encode the true media path/url in query params.
    const queryCandidates = [
      safeDecode(parsed.searchParams.get("path")),
      safeDecode(parsed.searchParams.get("url")),
      safeDecode(parsed.searchParams.get("src")),
    ];
    for (const candidate of queryCandidates) {
      const inferred = inferKindFromPathLike(candidate);
      if (inferred) return inferred;
    }
  } catch {
    // Fall through to iframe default.
  }

  return "iframe";
}

export function getAppIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.searchParams.get("appId") ?? parsed.searchParams.get("app");
  } catch {
    return null;
  }
}
