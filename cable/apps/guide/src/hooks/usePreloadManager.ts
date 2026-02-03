import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  PRELOAD_AFTER_PLAY_MS,
  PRELOAD_CACHE_LIMIT,
  PRELOAD_CACHE_TTL_MS,
  PRELOAD_DEBOUNCE_MS,
  PRELOAD_MODE,
} from "../constants/guide";
import { clamp } from "../lib/guide";
import { getMediaKind } from "../lib/media";
import type {
  GuideChannel,
  MediaKind,
  PreloadEntry,
  ViewMode,
} from "../types/guide";

type UsePreloadManagerArgs = {
  viewMode: ViewMode;
  selectedProgramUrl: string | null;
  selectedChannelPreviewUrl?: string | null;
  playerOpen: boolean;
  playerUrl: string | null;
  setPlayerUrl: (url: string | null) => void;
  setPlayerReady: (ready: boolean) => void;
  channels: GuideChannel[];
  playerChannelIndex: number | null;
  activeRow: number;
  currentSlotIndex: number;
};

export type PreloadManager = {
  hasPreviewMedia: boolean;
  posterImageReady: boolean;
  setPosterImageReady: (ready: boolean) => void;
  previewContainerRef: RefObject<HTMLDivElement | null>;
};

export function usePreloadManager({
  viewMode,
  selectedProgramUrl,
  selectedChannelPreviewUrl,
  playerOpen,
  playerUrl,
  setPlayerUrl,
  setPlayerReady,
  channels,
  playerChannelIndex,
  activeRow,
  currentSlotIndex,
}: UsePreloadManagerArgs): PreloadManager {
  const [preloadUrl, setPreloadUrl] = useState<string | null>(null);
  const [preloadTick, setPreloadTick] = useState(0);
  const [hasPreviewMedia, setHasPreviewMedia] = useState(false);
  const [posterImageReady, setPosterImageReady] = useState(false);

  const preloadTimerRef = useRef<number | null>(null);
  const preloadCacheRef = useRef<Map<string, PreloadEntry>>(new Map());
  const preloadContainerRef = useRef<HTMLDivElement | null>(null);
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const previewAttachedRef = useRef<HTMLElement | null>(null);

  const shouldPreload = useCallback((kind: MediaKind) => {
    if (PRELOAD_MODE === "all") return true;
    if (PRELOAD_MODE === "image") return kind === "image";
    return false;
  }, []);

  const ensurePreloadContainer = useCallback(() => {
    if (preloadContainerRef.current) return preloadContainerRef.current;
    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-9999px";
    container.style.top = "0";
    container.style.width = "1px";
    container.style.height = "1px";
    container.style.overflow = "hidden";
    container.style.pointerEvents = "none";
    container.style.opacity = "0";
    document.body.appendChild(container);
    preloadContainerRef.current = container;
    return container;
  }, []);

  const prunePreloadCache = useCallback(() => {
    const nowTs = Date.now();
    const cache = preloadCacheRef.current;
    for (const [key, entry] of cache.entries()) {
      if (nowTs - entry.lastUsed > PRELOAD_CACHE_TTL_MS) {
        entry.element.remove();
        cache.delete(key);
      }
    }
    if (cache.size <= PRELOAD_CACHE_LIMIT) return;
    const entries = Array.from(cache.values()).sort(
      (a, b) => a.lastUsed - b.lastUsed
    );
    const overflow = cache.size - PRELOAD_CACHE_LIMIT;
    for (let i = 0; i < overflow; i += 1) {
      const entry = entries[i];
      entry?.element.remove();
      if (entry) {
        cache.delete(entry.url);
      }
    }
  }, []);

  const queuePreload = useCallback(
    (url: string) => {
      if (!url) return;
      const cache = preloadCacheRef.current;
      const kind = getMediaKind(url);
      if (!shouldPreload(kind)) return;
      const existing = cache.get(url);
      const nowTs = Date.now();
      if (existing) {
        existing.lastUsed = nowTs;
        return;
      }
      const container = ensurePreloadContainer();
      let element: HTMLElement;
      if (kind === "image") {
        const img = document.createElement("img");
        img.src = url;
        element = img;
      } else if (kind === "video") {
        const video = document.createElement("video");
        video.src = url;
        video.muted = true;
        video.preload = "auto";
        video.playsInline = true;
        element = video;
      } else if (kind === "audio") {
        const audio = document.createElement("audio");
        audio.src = url;
        audio.muted = true;
        audio.preload = "auto";
        element = audio;
      } else {
        const frame = document.createElement("iframe");
        frame.src = url;
        frame.setAttribute(
          "sandbox",
          "allow-scripts allow-same-origin allow-pointer-lock"
        );
        frame.setAttribute("allow", "autoplay; fullscreen");
        frame.setAttribute("loading", "eager");
        element = frame;
      }
      element.style.position = "absolute";
      element.style.left = "-9999px";
      element.style.top = "0";
      element.style.width = "1px";
      element.style.height = "1px";
      element.style.opacity = "0";
      element.style.pointerEvents = "none";
      element.setAttribute("aria-hidden", "true");
      container.appendChild(element);

      const entry: PreloadEntry = {
        url,
        kind,
        status: "loading",
        element,
        lastUsed: nowTs,
      };
      cache.set(url, entry);

      if (kind === "image") {
        (element as HTMLImageElement).onload = () => {
          entry.status = "ready";
          entry.lastUsed = Date.now();
          setPreloadTick((prev) => prev + 1);
        };
        (element as HTMLImageElement).onerror = () => {
          entry.status = "error";
          setPreloadTick((prev) => prev + 1);
        };
      } else if (kind === "video") {
        (element as HTMLVideoElement).onloadeddata = () => {
          entry.status = "ready";
          entry.lastUsed = Date.now();
          setPreloadTick((prev) => prev + 1);
        };
        (element as HTMLVideoElement).onerror = () => {
          entry.status = "error";
          setPreloadTick((prev) => prev + 1);
        };
      } else if (kind === "audio") {
        (element as HTMLAudioElement).oncanplaythrough = () => {
          entry.status = "ready";
          entry.lastUsed = Date.now();
          setPreloadTick((prev) => prev + 1);
        };
        (element as HTMLAudioElement).onerror = () => {
          entry.status = "error";
          setPreloadTick((prev) => prev + 1);
        };
      } else {
        (element as HTMLIFrameElement).onload = () => {
          entry.status = "ready";
          entry.lastUsed = Date.now();
          setPreloadTick((prev) => prev + 1);
        };
        (element as HTMLIFrameElement).onerror = () => {
          entry.status = "error";
          setPreloadTick((prev) => prev + 1);
        };
      }

      prunePreloadCache();
    },
    [ensurePreloadContainer, prunePreloadCache, shouldPreload]
  );

  useEffect(() => {
    const cache = preloadCacheRef.current;
    const container = preloadContainerRef.current;
    return () => {
      cache.forEach((entry) => entry.element.remove());
      cache.clear();
      container?.remove();
    };
  }, []);

  useEffect(() => {
    if (viewMode !== "guide") return;
    const container = previewContainerRef.current;
    if (!container) return;
    if (PRELOAD_MODE !== "all") {
      const cacheContainer = ensurePreloadContainer();
      if (previewAttachedRef.current) {
        const element = previewAttachedRef.current;
        element.style.position = "absolute";
        element.style.left = "-9999px";
        element.style.top = "0";
        element.style.width = "1px";
        element.style.height = "1px";
        element.style.opacity = "0";
        element.style.pointerEvents = "none";
        if (element instanceof HTMLVideoElement) {
          element.pause();
        }
        cacheContainer.appendChild(element);
        previewAttachedRef.current = null;
      }
      setHasPreviewMedia(false);
      return;
    }
    const cacheContainer = ensurePreloadContainer();
    const currentUrl = selectedProgramUrl ?? null;
    const cacheEntry = currentUrl
      ? preloadCacheRef.current.get(currentUrl)
      : null;
    const readyEntry =
      cacheEntry?.status === "ready" && cacheEntry.kind !== "audio"
        ? cacheEntry
        : null;
    const readyElement = readyEntry?.element ?? null;

    const setHiddenStyles = (element: HTMLElement) => {
      element.style.position = "absolute";
      element.style.left = "-9999px";
      element.style.top = "0";
      element.style.width = "1px";
      element.style.height = "1px";
      element.style.opacity = "0";
      element.style.pointerEvents = "none";
      if (element instanceof HTMLVideoElement) {
        element.pause();
      }
    };

    const setPreviewStyles = (element: HTMLElement) => {
      element.style.position = "absolute";
      element.style.left = "0";
      element.style.top = "0";
      element.style.width = "100%";
      element.style.height = "100%";
      element.style.opacity = "1";
      element.style.pointerEvents = "none";
    };

    if (readyElement && readyEntry) {
      if (
        previewAttachedRef.current &&
        previewAttachedRef.current !== readyElement
      ) {
        setHiddenStyles(previewAttachedRef.current);
        cacheContainer.appendChild(previewAttachedRef.current);
      }
      if (readyElement.parentElement !== container) {
        const previewClass =
          readyEntry.kind === "iframe"
            ? "poster-preview-frame"
            : "poster-preview-media";
        readyElement.classList.add(previewClass);
        setPreviewStyles(readyElement);
        container.appendChild(readyElement);
      }
      if (readyEntry.kind === "video") {
        const video = readyElement as HTMLVideoElement;
        video.muted = true;
        video.playsInline = true;
        video.loop = false;
        try {
          if (Number.isFinite(video.duration) && video.duration > 0) {
            video.currentTime = 0;
          }
        } catch {
          // ignore seek failures on some browsers
        }
        video.pause();
      }
      previewAttachedRef.current = readyElement;
      setHasPreviewMedia(true);
      return;
    }

    if (previewAttachedRef.current) {
      setHiddenStyles(previewAttachedRef.current);
      cacheContainer.appendChild(previewAttachedRef.current);
      previewAttachedRef.current = null;
    }
    setHasPreviewMedia(false);
  }, [viewMode, selectedProgramUrl, preloadTick, ensurePreloadContainer]);

  useEffect(() => {
    if (!playerOpen || !playerUrl) return;
    if (!channels.length) return;
    const baseIndex =
      playerChannelIndex ??
      clamp(activeRow, 0, Math.max(0, channels.length - 1));
    if (!Number.isFinite(baseIndex)) return;
    if (PRELOAD_MODE !== "all") return;
    const neighborRows = [
      (baseIndex - 1 + channels.length) % channels.length,
      (baseIndex + 1) % channels.length,
    ];
    const neighborUrls = neighborRows
      .map((row) => {
        const channel = channels[row];
        const program =
          channel?.schedule.find(
            (slot) =>
              currentSlotIndex >= slot.start &&
              currentSlotIndex <= slot.end
          ) ?? channel?.schedule[0];
        return program?.url ?? null;
      })
      .filter(
        (url, index, all): url is string =>
          Boolean(url) && url !== playerUrl && all.indexOf(url) === index
      );
    if (!neighborUrls.length) return;
    const timer = window.setTimeout(() => {
      neighborUrls.forEach((url) => queuePreload(url));
    }, PRELOAD_AFTER_PLAY_MS);
    return () => window.clearTimeout(timer);
  }, [
    playerOpen,
    playerUrl,
    channels,
    playerChannelIndex,
    activeRow,
    currentSlotIndex,
    queuePreload,
  ]);

  useEffect(() => {
    if (viewMode !== "guide") return;
    if (playerOpen) return;
    const url = selectedProgramUrl ?? null;
    if (!url) {
      setPreloadUrl(null);
      return;
    }
    const kind = getMediaKind(url);
    if (!shouldPreload(kind)) {
      setPreloadUrl(null);
      return;
    }
    if (preloadTimerRef.current) {
      window.clearTimeout(preloadTimerRef.current);
    }
    preloadTimerRef.current = window.setTimeout(() => {
      setPreloadUrl(url);
      queuePreload(url);
    }, PRELOAD_DEBOUNCE_MS);
    return () => {
      if (preloadTimerRef.current) {
        window.clearTimeout(preloadTimerRef.current);
      }
    };
  }, [viewMode, playerOpen, selectedProgramUrl, queuePreload, shouldPreload]);

  useEffect(() => {
    if (!preloadUrl || playerOpen) return;
    if (PRELOAD_MODE !== "all") return;
    if (preloadUrl === playerUrl) return;
    setPlayerReady(false);
    setPlayerUrl(preloadUrl);
  }, [preloadUrl, playerOpen, playerUrl, setPlayerReady, setPlayerUrl]);

  useEffect(() => {
    setPosterImageReady(false);
  }, [selectedChannelPreviewUrl]);

  return {
    hasPreviewMedia,
    posterImageReady,
    setPosterImageReady,
    previewContainerRef,
  };
}
