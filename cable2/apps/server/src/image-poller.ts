type ImagePollerOptions = {
  url: string;
  intervalMs: number;
  timeoutMs?: number;
  userAgent?: string;
};

export type PolledImageFrame = {
  buffer: Buffer;
  contentType: string;
  fetchedAt: number;
  sourceUrl: string;
};

export type ImagePoller = {
  options: Readonly<ImagePollerOptions>;
  start: () => Promise<void>;
  stop: () => void;
  getFrame: () => PolledImageFrame | null;
};

function clampMs(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(250, Math.floor(value));
}

export function createImagePoller(
  options: ImagePollerOptions,
  overrides: Partial<ImagePollerOptions> = {}
): ImagePoller {
  const merged: ImagePollerOptions = {
    url: overrides.url ?? options.url,
    intervalMs: clampMs(overrides.intervalMs ?? options.intervalMs, 30_000),
    timeoutMs: clampMs(overrides.timeoutMs ?? options.timeoutMs ?? 12_000, 12_000),
    userAgent:
      overrides.userAgent ??
      options.userAgent ??
      "Mozilla/5.0 (ChibaCable ImagePoller)",
  };

  let timer: NodeJS.Timeout | null = null;
  let frame: PolledImageFrame | null = null;
  let starting: Promise<void> | null = null;
  let stopped = false;

  const fetchOnce = async () => {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), merged.timeoutMs ?? 12_000);
    try {
      const res = await fetch(merged.url, {
        signal: ac.signal,
        headers: { "User-Agent": merged.userAgent ?? "" },
      });
      if (!res.ok) throw new Error(`http_${res.status}`);
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().startsWith("image/")) {
        throw new Error(`not_image:${contentType || "unknown"}`);
      }
      const ab = await res.arrayBuffer();
      frame = {
        buffer: Buffer.from(ab),
        contentType,
        fetchedAt: Date.now(),
        sourceUrl: merged.url,
      };
    } finally {
      clearTimeout(t);
    }
  };

  const tick = async () => {
    if (stopped) return;
    try {
      await fetchOnce();
    } catch (err) {
      // Keep last good frame; this is a best-effort feed.
      // eslint-disable-next-line no-console
      console.warn("[image-poller] fetch failed", merged.url, (err as Error).message);
    }
  };

  const schedule = () => {
    if (stopped) return;
    if (timer) clearInterval(timer);
    // Fire-and-forget tick; interval continues even if an individual fetch stalls or fails.
    timer = setInterval(() => void tick(), merged.intervalMs);
  };

  return {
    options: merged,
    start: async () => {
      if (starting) return await starting;
      stopped = false;
      starting = (async () => {
        await tick();
        schedule();
      })();
      try {
        await starting;
      } finally {
        starting = null;
      }
    },
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
    getFrame: () => frame,
  };
}

