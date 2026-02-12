import type { MediaKind } from "../types/guide";

export function getMediaKind(url: string): MediaKind {
  const cleaned = url.split("?")[0]?.split("#")[0]?.toLowerCase() ?? "";
  if (/\.(png|jpg|jpeg|gif|webp|avif)$/i.test(cleaned)) return "image";
  if (/\.(mp4|webm|ogg|m4v|mov)$/i.test(cleaned)) return "video";
  if (/\.(mp3|wav|aac|m4a|flac|oga)$/i.test(cleaned)) return "audio";
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
