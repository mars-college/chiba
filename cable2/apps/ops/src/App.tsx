import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyTarget,
  fetchCatalog,
  fetchFleet,
  fetchGuideIndex,
  fetchPiHealth,
  fetchProfiles,
  openFleetStream,
  openGuide,
  type FleetStreamMeta,
} from "./lib/api";
import type {
  FleetPi,
  FleetPiHealth,
  GuideIndex,
  OpsApplyTarget,
  OpsProfile,
} from "./types";

function fmtAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

function Pill({
  kind,
  label,
}: {
  kind: "ok" | "warn" | "bad" | "muted";
  label: string;
}) {
  return <span className={`pill pill-${kind}`}>{label}</span>;
}

function rowKind(
  pi: FleetPi | FleetPiHealth | null
): "ok" | "warn" | "bad" | "muted" {
  if (!pi) return "muted";
  // Registry can contain external/unaddressable nodes with host="".
  // When static IPs are configured, `ip` may be present even if `host` is empty.
  const addr = (pi as any).ip || (pi as any).host;
  if (!addr) return "muted";
  if (!("dnsOk" in pi)) return "muted";
  if (!pi.dnsOk) return "bad";
  const anyTcpOk = pi.tcp.ssh22.ok || pi.tcp.node8080.ok || pi.tcp.cable8787.ok;
  if (!anyTcpOk && !pi.ping.ok) return "bad";
  if (pi.needsUpdate === true) return "warn";
  return "ok";
}

type ToggleValue = "inherit" | "on" | "off";
type HudModeValue = "inherit" | "always" | "start" | "never";
type TargetOverrideValue =
  | "inherit"
  | "media"
  | "playlist"
  | "block"
  | "channel";
type TargetKind = "media" | "playlist" | "block" | "channel";

type CatalogMaps = {
  channelsById: Map<string, any>;
  blocksById: Map<string, any>;
  playlistsById: Map<string, any>;
  mediaById: Map<string, any>;
  mediaBySource: Map<string, string>;
};

type ResolvedTargetDeps = {
  targetKind: TargetKind;
  targetId: string;
  channelIds: string[];
  blockIds: string[];
  playlistIds: string[];
  mediaIds: string[];
};

function toOptionalBool(value: ToggleValue): boolean | undefined {
  if (value === "inherit") return undefined;
  return value === "on";
}

function toOptionalNumber(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function toOptionalTargetKind(
  value: TargetOverrideValue
): "media" | "playlist" | "block" | "channel" | undefined {
  if (value === "inherit") return undefined;
  return value;
}

function compactRecord(
  input: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" && v.trim().length === 0) continue;
    out[k] = v;
  }
  return out;
}

function toCatalogMaps(catalog: any): CatalogMaps {
  const channelsById = new Map<string, any>();
  const blocksById = new Map<string, any>();
  const playlistsById = new Map<string, any>();
  const mediaById = new Map<string, any>();
  const mediaBySource = new Map<string, string>();

  for (const channel of Array.isArray(catalog?.channels)
    ? catalog.channels
    : []) {
    const id = String(channel?.id ?? "").trim();
    if (id) channelsById.set(id, channel);
  }
  for (const block of Array.isArray(catalog?.blocks) ? catalog.blocks : []) {
    const id = String(block?.id ?? "").trim();
    if (id) blocksById.set(id, block);
  }
  for (const playlist of Array.isArray(catalog?.playlists)
    ? catalog.playlists
    : []) {
    const id = String(playlist?.id ?? "").trim();
    if (id) playlistsById.set(id, playlist);
  }
  for (const media of Array.isArray(catalog?.media) ? catalog.media : []) {
    const id = String(media?.id ?? "").trim();
    if (!id) continue;
    mediaById.set(id, media);
    const source = String(media?.source ?? "").trim();
    if (source && !mediaBySource.has(source)) mediaBySource.set(source, id);
  }

  return { channelsById, blocksById, playlistsById, mediaById, mediaBySource };
}

function parseKioskTarget(params: Array<[string, string]> | null): {
  kind?: TargetKind;
  id?: string;
} {
  if (!params) return {};
  const get = (k: string) => params.find(([kk]) => kk === k)?.[1]?.trim() ?? "";
  const rawKind = get("targetKind") || get("target_kind");
  const kind =
    rawKind === "media" ||
    rawKind === "playlist" ||
    rawKind === "block" ||
    rawKind === "channel"
      ? rawKind
      : undefined;
  const id =
    get("targetId") ||
    get("target_id") ||
    (kind === "channel" ? get("channel") : "");
  if (kind && id) return { kind, id };
  const channel = get("channel");
  if (channel) return { kind: "channel", id: channel };
  return {};
}

function resolveTargetDeps(
  maps: CatalogMaps | null,
  target: { kind?: TargetKind; id?: string }
): ResolvedTargetDeps | null {
  if (!maps || !target.kind || !target.id) return null;

  const channelIds = new Set<string>();
  const blockIds = new Set<string>();
  const playlistIds = new Set<string>();
  const mediaIds = new Set<string>();
  const visitedPlaylists = new Set<string>();
  const visitedBlocks = new Set<string>();
  const visitedChannels = new Set<string>();

  const addMedia = (id: unknown) => {
    const mediaId = String(id ?? "").trim();
    if (!mediaId) return;
    mediaIds.add(mediaId);
  };
  const addMediaFromSource = (source: unknown) => {
    const src = String(source ?? "").trim();
    if (!src) return;
    const mediaId = maps.mediaBySource.get(src);
    if (mediaId) mediaIds.add(mediaId);
  };
  const visitPlaylist = (playlistId: unknown) => {
    const id = String(playlistId ?? "").trim();
    if (!id || visitedPlaylists.has(id)) return;
    visitedPlaylists.add(id);
    playlistIds.add(id);
    const playlist = maps.playlistsById.get(id);
    if (!playlist) return;
    for (const item of Array.isArray(playlist?.items) ? playlist.items : []) {
      addMedia(item?.media);
      addMediaFromSource(item?.source);
      visitPlaylist(item?.playlist);
    }
  };
  const visitBlock = (blockId: unknown) => {
    const id = String(blockId ?? "").trim();
    if (!id || visitedBlocks.has(id)) return;
    visitedBlocks.add(id);
    blockIds.add(id);
    const block = maps.blocksById.get(id);
    if (!block) return;
    visitPlaylist(block?.playlist);
    addMedia(block?.media);
    addMediaFromSource(block?.source);
    for (const item of Array.isArray(block?.items) ? block.items : []) {
      addMedia(item?.media);
      addMediaFromSource(item?.source);
      visitPlaylist(item?.playlist);
    }
  };
  const visitChannel = (channelId: unknown) => {
    const id = String(channelId ?? "").trim();
    if (!id || visitedChannels.has(id)) return;
    visitedChannels.add(id);
    channelIds.add(id);
    const channel = maps.channelsById.get(id);
    if (!channel) return;
    for (const blockId of Array.isArray(channel?.blocks)
      ? channel.blocks
      : []) {
      visitBlock(blockId);
    }
    for (const program of Array.isArray(channel?.programs)
      ? channel.programs
      : []) {
      visitPlaylist(program?.playlist);
      addMedia(program?.media);
      addMediaFromSource(program?.source);
    }
  };

  if (target.kind === "media") addMedia(target.id);
  if (target.kind === "playlist") visitPlaylist(target.id);
  if (target.kind === "block") visitBlock(target.id);
  if (target.kind === "channel") visitChannel(target.id);

  return {
    targetKind: target.kind,
    targetId: target.id,
    channelIds: Array.from(channelIds),
    blockIds: Array.from(blockIds),
    playlistIds: Array.from(playlistIds),
    mediaIds: Array.from(mediaIds),
  };
}

export default function App() {
  type ControlPanelKey = "apply" | "options" | "quick";
  const [view, setView] = useState<"fleet" | "catalog">("fleet");
  const [meta, setMeta] = useState<FleetStreamMeta | null>(null);
  const [healthById, setHealthById] = useState<Record<string, FleetPiHealth>>(
    {}
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [filter, setFilter] = useState<"all" | "bad" | "warn" | "ok">("all");
  const [checkingById, setCheckingById] = useState<Record<string, boolean>>({});
  const [profiles, setProfiles] = useState<OpsProfile[]>([]);
  const [guideIndex, setGuideIndex] = useState<GuideIndex | null>(null);
  const [selectedById, setSelectedById] = useState<Record<string, boolean>>({});
  const [applyKind, setApplyKind] = useState<OpsApplyTarget>("profile");
  const [applyId, setApplyId] = useState<string>("");
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);
  const [targetPickerFilter, setTargetPickerFilter] = useState("");
  const [optMode, setOptMode] = useState<"inherit" | "guide" | "gallery">(
    "inherit"
  );
  const [optTargetKind, setOptTargetKind] =
    useState<TargetOverrideValue>("inherit");
  const [optTargetId, setOptTargetId] = useState<string>("");
  const [optChannel, setOptChannel] = useState<string>("");
  const [optLock, setOptLock] = useState<ToggleValue>("inherit");
  const [optQr, setOptQr] = useState<ToggleValue>("inherit");
  const [optPlaylist, setOptPlaylist] = useState<ToggleValue>("inherit");
  const [optNosplash, setOptNosplash] = useState<ToggleValue>("inherit");
  const [optHudMode, setOptHudMode] = useState<HudModeValue>("inherit");
  const [optHudShowSec, setOptHudShowSec] = useState<string>("");
  const [optTheme, setOptTheme] = useState<string>("");
  const [optScale, setOptScale] = useState<string>("");
  const [optTextScale, setOptTextScale] = useState<string>("");
  const [optHours, setOptHours] = useState<string>("");
  const [controlBusy, setControlBusy] = useState(false);
  const [controlMsg, setControlMsg] = useState<string | null>(null);
  const [controlErr, setControlErr] = useState<string | null>(null);
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({});
  const [catalog, setCatalog] = useState<any | null>(null);
  const [catalogErr, setCatalogErr] = useState<string | null>(null);
  const [catalogTab, setCatalogTab] = useState<
    "channels" | "blocks" | "playlists" | "media"
  >("channels");
  const [catalogFilter, setCatalogFilter] = useState<string>("");
  const [openControlPanels, setOpenControlPanels] = useState<
    Record<ControlPanelKey, boolean>
  >({
    apply: false,
    options: false,
    quick: false,
  });
  const abortRef = useRef<AbortController | null>(null);
  const streamRef = useRef<{ close: () => void } | null>(null);

  const toggleControlPanel = (key: ControlPanelKey) => {
    setOpenControlPanels((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleExpanded = (id: string) => {
    setExpandedById((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const closeStream = () => {
    streamRef.current?.close();
    streamRef.current = null;
  };

  const startStream = (opts?: { reset?: boolean }) => {
    closeStream();
    setLoading(true);
    setError(null);
    if (opts?.reset !== false) setHealthById({});
    streamRef.current = openFleetStream({
      // You can tune these without redeploying:
      // timeoutMs: 650,
      // parallel: 12,
      onMeta: (m) => {
        setMeta(m);
        setLoading(false);
      },
      onPi: (pi) => {
        setHealthById((prev) =>
          prev[pi.id] === pi ? prev : { ...prev, [pi.id]: pi }
        );
      },
      onDone: () => {
        // no-op; keep last results on screen
      },
      onError: (msg) => {
        setError(msg);
      },
    });
  };

  // Fallback for environments where SSE is blocked.
  const loadSnapshot = async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchFleet(ac.signal);
      setMeta({ now: res.now, local: res.local, pis: res.pis });
      const map: Record<string, FleetPiHealth> = {};
      for (const pi of res.pis) map[pi.id] = pi;
      setHealthById(map);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const refreshOne = async (id: string) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setError(null);
    setCheckingById((prev) => ({ ...prev, [id]: true }));
    try {
      const health = await fetchPiHealth(id, ac.signal);
      setHealthById((prev) => ({ ...prev, [id]: health }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCheckingById((prev) => ({ ...prev, [id]: false }));
    }
  };

  const loadCatalog = async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setCatalogErr(null);
    try {
      const res = await fetchCatalog(ac.signal);
      if (!(res as any)?.ok) {
        setCatalogErr((res as any)?.error ?? "catalog_failed");
        return;
      }
      setCatalog(res);
    } catch (e) {
      setCatalogErr((e as Error).message);
    }
  };

  useEffect(() => {
    startStream({ reset: true });
    return () => {
      closeStream();
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (view !== "catalog") return;
    if (catalog) return;
    void loadCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // Load catalog opportunistically so the Fleet row details can resolve
  // channel -> blocks -> playlists -> media without switching views.
  useEffect(() => {
    if (catalog || catalogErr) return;
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetchCatalog(ac.signal);
        if ((res as any)?.ok) setCatalog(res);
      } catch {
        // ignore
      }
    })();
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Load static-ish ops data once (profiles + channel index).
    const ac = new AbortController();
    (async () => {
      try {
        const [p, idx] = await Promise.all([
          fetchProfiles(ac.signal),
          fetchGuideIndex(ac.signal),
        ]);
        setProfiles(p.profiles ?? []);
        setGuideIndex(idx);
      } catch (e) {
        // Don't block fleet health UI if these fail.
        // eslint-disable-next-line no-console
        console.warn("[ops] preload failed", e);
      }
    })();
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const t = window.setInterval(() => {
      startStream({ reset: false });
    }, 8000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh]);

  useEffect(() => {
    if (!targetPickerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setTargetPickerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [targetPickerOpen]);

  const rows = useMemo(() => {
    const base = meta?.pis ?? [];
    const joined = base.map((p) => healthById[p.id] ?? p);
    const filtered = joined.filter((pi) => {
      const kind = rowKind(pi as any);
      if (filter === "all") return true;
      if (filter === "bad") return kind === "bad";
      if (filter === "warn") return kind === "warn";
      return kind === "ok";
    });
    filtered.sort((a, b) => {
      const ka = rowKind(a as any);
      const kb = rowKind(b as any);
      const rank = (k: string) =>
        k === "bad" ? 0 : k === "warn" ? 1 : k === "muted" ? 3 : 2;
      const r = rank(ka) - rank(kb);
      if (r !== 0) return r;
      return a.id.localeCompare(b.id);
    });
    return filtered;
  }, [meta, healthById, filter]);

  const now = meta?.now ?? Date.now();
  const selectedIds = useMemo(
    () =>
      Object.entries(selectedById)
        .filter(([, v]) => v)
        .map(([k]) => k),
    [selectedById]
  );

  const visibleIds = useMemo(() => rows.map((r) => r.id), [rows]);

  const allChannels = useMemo(() => guideIndex?.channels ?? [], [guideIndex]);
  const channelOptions = useMemo(() => {
    const items = allChannels
      .map((c) => {
        const labelBits = [
          c.number ? String(c.number).trim() : "",
          c.name ? String(c.name).trim() : "",
          c.id,
        ]
          .filter(Boolean)
          .join(" ");
        return { id: c.id, label: labelBits };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
    return items;
  }, [allChannels]);

  const profileOptions = useMemo(
    () =>
      profiles
        .map((profile) => ({ id: profile.id, label: profile.id }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [profiles]
  );

  const catalogChannels = useMemo(() => {
    const channels: any[] = Array.isArray((catalog as any)?.channels)
      ? (catalog as any).channels
      : [];
    return channels
      .map((channel) => {
        const id = String(channel?.id ?? "").trim();
        if (!id) return null;
        const number = String(channel?.number ?? "").trim();
        const name = String(channel?.name ?? "").trim();
        const label = [number, name, id].filter(Boolean).join(" ");
        return { id, label: label || id };
      })
      .filter((entry): entry is { id: string; label: string } => Boolean(entry))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [catalog]);

  const catalogBlocks = useMemo(() => {
    const blocks: any[] = Array.isArray((catalog as any)?.blocks)
      ? (catalog as any).blocks
      : [];
    return blocks
      .map((block) => {
        const id = String(block?.id ?? "").trim();
        if (!id) return null;
        const title = String(block?.title ?? block?.name ?? "").trim();
        const label = [id, title].filter(Boolean).join(" ");
        return { id, label: label || id };
      })
      .filter((entry): entry is { id: string; label: string } => Boolean(entry))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [catalog]);

  const catalogPlaylists = useMemo(() => {
    const playlists: any[] = Array.isArray((catalog as any)?.playlists)
      ? (catalog as any).playlists
      : [];
    return playlists
      .map((playlist) => {
        const id = String(playlist?.id ?? "").trim();
        if (!id) return null;
        const title = String(playlist?.title ?? playlist?.name ?? "").trim();
        const label = [id, title].filter(Boolean).join(" ");
        return { id, label: label || id };
      })
      .filter((entry): entry is { id: string; label: string } => Boolean(entry))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [catalog]);

  const catalogMedia = useMemo(() => {
    const media: any[] = Array.isArray((catalog as any)?.media)
      ? (catalog as any).media
      : [];
    return media
      .map((item) => {
        const id = String(item?.id ?? "").trim();
        if (!id) return null;
        const title = String(item?.title ?? item?.name ?? "").trim();
        const label = [id, title].filter(Boolean).join(" ");
        return { id, label: label || id };
      })
      .filter((entry): entry is { id: string; label: string } => Boolean(entry))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [catalog]);

  const catalogMaps = useMemo(() => {
    if (!catalog) return null;
    return toCatalogMaps(catalog);
  }, [catalog]);

  const applyOptions = useMemo(() => {
    if (applyKind === "profile") return profileOptions;
    if (applyKind === "channel")
      return catalogChannels.length ? catalogChannels : channelOptions;
    if (applyKind === "block") return catalogBlocks;
    if (applyKind === "playlist") return catalogPlaylists;
    return catalogMedia;
  }, [
    applyKind,
    catalogBlocks,
    catalogChannels,
    catalogMedia,
    catalogPlaylists,
    channelOptions,
    profileOptions,
  ]);

  const filteredApplyOptions = useMemo(() => {
    const query = targetPickerFilter.trim().toLowerCase();
    if (!query) return applyOptions;
    return applyOptions.filter((entry) => {
      const id = entry.id.toLowerCase();
      const label = entry.label.toLowerCase();
      return id.includes(query) || label.includes(query);
    });
  }, [applyOptions, targetPickerFilter]);

  useEffect(() => {
    if (!applyOptions.length) {
      if (applyId) setApplyId("");
      return;
    }
    if (!applyOptions.some((option) => option.id === applyId)) {
      setApplyId(applyOptions[0].id);
    }
  }, [applyOptions, applyId]);

  const targetKindOverride = toOptionalTargetKind(optTargetKind);
  const targetIdOverride = optTargetId.trim() || undefined;
  const showChannelFallback =
    applyKind === "profile" &&
    targetKindOverride === undefined &&
    !targetIdOverride;
  const channelFallbackOverride = showChannelFallback
    ? optChannel.trim() || undefined
    : undefined;

  const applyPayloadPreview = useMemo(() => {
    const mode = optMode === "inherit" ? undefined : optMode;
    const payload = compactRecord({
      target: applyKind,
      id: applyId || undefined,
      piIds: selectedIds.length > 0 ? selectedIds : undefined,
      mode,
      targetKind: targetKindOverride,
      targetId: targetIdOverride,
      channel: channelFallbackOverride,
      lock: toOptionalBool(optLock),
      showQr: toOptionalBool(optQr),
      playlist: toOptionalBool(optPlaylist),
      nosplash: toOptionalBool(optNosplash),
      hudMode: optHudMode === "inherit" ? undefined : optHudMode,
      hudShowSec: toOptionalNumber(optHudShowSec),
      theme: optTheme.trim() || undefined,
      scale: toOptionalNumber(optScale),
      textScale: toOptionalNumber(optTextScale),
      hours: toOptionalNumber(optHours),
    });
    return payload;
  }, [
    applyKind,
    applyId,
    selectedIds,
    optMode,
    targetKindOverride,
    targetIdOverride,
    channelFallbackOverride,
    optLock,
    optQr,
    optPlaylist,
    optNosplash,
    optHudMode,
    optHudShowSec,
    optTheme,
    optScale,
    optTextScale,
    optHours,
  ]);

  const applyTargetSummary = useMemo(() => {
    if (applyKind === "profile") {
      if (targetKindOverride && targetIdOverride)
        return `${targetKindOverride}:${targetIdOverride} (profile override)`;
      if (targetKindOverride && !targetIdOverride)
        return `${targetKindOverride}:<required id>`;
      if (targetIdOverride)
        return `profile target id override: ${targetIdOverride}`;
      if (channelFallbackOverride)
        return `channel:${channelFallbackOverride} (profile fallback)`;
      return "profile-defined target";
    }
    const kind = targetKindOverride ?? applyKind;
    const id = targetIdOverride ?? applyId;
    return id ? `${kind}:${id}` : `${kind}:<missing id>`;
  }, [
    applyKind,
    applyId,
    channelFallbackOverride,
    targetIdOverride,
    targetKindOverride,
  ]);

  const selectedApplyOptionLabel = useMemo(() => {
    const option = applyOptions.find((entry) => entry.id === applyId);
    return option?.label ?? applyId;
  }, [applyId, applyOptions]);

  const summarizeResults = (
    results: Array<{ ok: boolean; id: string; error?: string | null }>
  ) => {
    const ok = results.filter((r) => r.ok).length;
    const bad = results.length - ok;
    if (!results.length) return "No targets.";
    if (bad === 0) return `Applied to ${ok}/${results.length}.`;
    const firstErr = results.find((r) => !r.ok)?.error ?? "unknown_error";
    return `Applied to ${ok}/${results.length}. Failures: ${bad}. First error: ${firstErr}`;
  };

  const runApply = async (
    fn: () => Promise<{
      ok: boolean;
      results: Array<{ id: string; ok: boolean; error: string | null }>;
    }>
  ) => {
    if (!selectedIds.length) {
      setControlErr("Select at least one node.");
      return;
    }
    setControlBusy(true);
    setControlErr(null);
    setControlMsg(null);
    try {
      const res = await fn();
      if (!res.ok) {
        setControlErr("request_failed");
        return;
      }
      if (!res.results.length) {
        setControlErr(
          `No results returned for selected nodes (${selectedIds.join(", ")})`
        );
        return;
      }
      setControlMsg(summarizeResults(res.results));
      // Refresh health so the table reflects new kiosk urls quickly.
      startStream({ reset: false });
    } catch (e) {
      setControlErr((e as Error).message);
    } finally {
      setControlBusy(false);
    }
  };

  const runApplyTarget = () =>
    runApply(async () => {
      const mode = optMode === "inherit" ? undefined : optMode;
      return await applyTarget({
        target: applyKind,
        id: applyId,
        piIds: selectedIds,
        mode,
        targetKind: targetKindOverride,
        targetId: targetIdOverride,
        channel: channelFallbackOverride,
        lock: toOptionalBool(optLock),
        showQr: toOptionalBool(optQr),
        playlist: toOptionalBool(optPlaylist),
        nosplash: toOptionalBool(optNosplash),
        hudMode: optHudMode === "inherit" ? undefined : optHudMode,
        hudShowSec: toOptionalNumber(optHudShowSec),
        theme: optTheme.trim() || undefined,
        scale: toOptionalNumber(optScale),
        textScale: toOptionalNumber(optTextScale),
        hours: toOptionalNumber(optHours),
      });
    });

  const runReturnToGuide = () =>
    runApply(
      async () =>
        await openGuide({
          piIds: selectedIds,
          lock: toOptionalBool(optLock),
          showQr: toOptionalBool(optQr),
          nosplash: toOptionalBool(optNosplash),
        })
    );

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand">
            <div className="brand-mark" aria-hidden />
            <div className="brand-text">
              <div className="brand-title">CHIBA</div>
              <div className="brand-subtitle">CABLE OPS</div>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button
            className={`nav-btn ${
              view === "fleet" && filter === "all" ? "active" : ""
            }`}
            onClick={() => {
              setView("fleet");
              setFilter("all");
            }}
          >
            Fleet
          </button>
          <button
            className={`nav-btn ${
              view === "fleet" && filter === "bad" ? "active" : ""
            }`}
            onClick={() => {
              setView("fleet");
              setFilter("bad");
            }}
          >
            Offline
          </button>
          <button
            className={`nav-btn ${
              view === "fleet" && filter === "warn" ? "active" : ""
            }`}
            onClick={() => {
              setView("fleet");
              setFilter("warn");
            }}
          >
            Needs Update
          </button>
          <button
            className={`nav-btn ${
              view === "fleet" && filter === "ok" ? "active" : ""
            }`}
            onClick={() => {
              setView("fleet");
              setFilter("ok");
            }}
          >
            Healthy
          </button>
          <button
            className={`nav-btn ${view === "catalog" ? "active" : ""}`}
            onClick={() => setView("catalog")}
          >
            Catalog
          </button>
        </nav>

        <div className="sidebar-footer">
          <div>registry: {meta?.local.registryPath ?? "not set"}</div>
          <div>local git: {meta?.local.gitSha ?? "unknown"}</div>
        </div>
      </aside>

      <main className="main-content">
        {view === "catalog" ? (
          <>
            <div className="page-header">
              <div className="page-header-row">
                <div>
                  <h1 className="page-title">Config Catalog</h1>
                  <div className="page-subtitle">
                    media, playlists, blocks, channels (from the cable server)
                  </div>
                </div>
                <div className="actions">
                  <button
                    className="btn"
                    onClick={() => {
                      setCatalog(null);
                      void loadCatalog();
                    }}
                  >
                    Refresh
                  </button>
                </div>
              </div>
              {catalogErr ? (
                <div className="alert alert-error">Catalog: {catalogErr}</div>
              ) : null}
            </div>

            <div className="card control-card">
              <div className="card-header">
                <div className="card-title">Browse</div>
                <div className="card-meta">
                  {catalog?.counts ? (
                    <span className="mono">
                      ch {catalog.counts.channels} | blk {catalog.counts.blocks}{" "}
                      | pl {catalog.counts.playlists} | media{" "}
                      {catalog.counts.media}
                    </span>
                  ) : (
                    <span className="muted">loading…</span>
                  )}
                </div>
              </div>
              <div className="control-body">
                <div className="control-row">
                  <button
                    className={`btn btn-small ${
                      catalogTab === "channels" ? "active" : ""
                    }`}
                    onClick={() => setCatalogTab("channels")}
                  >
                    Channels
                  </button>
                  <button
                    className={`btn btn-small ${
                      catalogTab === "blocks" ? "active" : ""
                    }`}
                    onClick={() => setCatalogTab("blocks")}
                  >
                    Blocks
                  </button>
                  <button
                    className={`btn btn-small ${
                      catalogTab === "playlists" ? "active" : ""
                    }`}
                    onClick={() => setCatalogTab("playlists")}
                  >
                    Playlists
                  </button>
                  <button
                    className={`btn btn-small ${
                      catalogTab === "media" ? "active" : ""
                    }`}
                    onClick={() => setCatalogTab("media")}
                  >
                    Media
                  </button>
                  <input
                    className="input"
                    placeholder="filter by id/title…"
                    value={catalogFilter}
                    onChange={(e) => setCatalogFilter(e.target.value)}
                  />
                </div>

                {(() => {
                  const items: any[] = Array.isArray(
                    (catalog as any)?.[catalogTab]
                  )
                    ? (catalog as any)[catalogTab]
                    : [];
                  const q = catalogFilter.trim().toLowerCase();
                  const filtered = q
                    ? items.filter((it) => {
                        const id = String(it?.id ?? "").toLowerCase();
                        const title = String(
                          it?.title ?? it?.name ?? ""
                        ).toLowerCase();
                        return id.includes(q) || title.includes(q);
                      })
                    : items;

                  return (
                    <div className="catalog-list">
                      {filtered.map((it) => (
                        <details
                          key={String(it?.id ?? Math.random())}
                          className="catalog-item"
                        >
                          <summary>
                            <span className="mono">
                              {String(it?.id ?? "(no id)")}
                            </span>
                            {it?.title || it?.name ? (
                              <span className="muted">
                                {" "}
                                {String(it.title ?? it.name)}
                              </span>
                            ) : null}
                          </summary>
                          <pre className="catalog-pre">
                            {JSON.stringify(it, null, 2)}
                          </pre>
                        </details>
                      ))}
                      {!filtered.length ? (
                        <div className="muted">No items.</div>
                      ) : null}
                    </div>
                  );
                })()}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="page-header">
              <div className="page-header-row">
                <div>
                  <h1 className="page-title">Fleet Health</h1>
                  <div className="page-subtitle">
                    Active probes: addr (static IP preferred), ping (best
                    effort), TCP(22/8080/8787), HTTP(/status, /api/version)
                  </div>
                </div>
                <div className="actions">
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={autoRefresh}
                      onChange={(e) => setAutoRefresh(e.target.checked)}
                    />
                    <span>Auto refresh (all)</span>
                  </label>
                  <button
                    className="btn"
                    onClick={() => startStream({ reset: false })}
                    disabled={loading}
                  >
                    Refresh all
                  </button>
                  <button
                    className="btn"
                    onClick={() => loadSnapshot()}
                    disabled={loading}
                  >
                    Snapshot
                  </button>
                </div>
              </div>

              {error ? (
                <div className="alert alert-error">Error: {error}</div>
              ) : null}
              {controlErr ? (
                <div className="alert alert-error">Control: {controlErr}</div>
              ) : null}
              {controlMsg ? (
                <div className="alert">Control: {controlMsg}</div>
              ) : null}
            </div>

            <div className="card control-card">
              <div className="card-header">
                <div className="card-title">Control</div>
                <div className="card-meta">
                  Selected: <span className="mono">{selectedIds.length}</span> /
                  visible: <span className="mono">{visibleIds.length}</span>
                </div>
              </div>
              <div className="control-body">
                <div className="control-row control-row-top">
                  <div className="control-row-group">
                    <button
                      className="btn btn-small"
                      onClick={() => {
                        const next: Record<string, boolean> = {};
                        for (const id of visibleIds) next[id] = true;
                        setSelectedById(next);
                      }}
                      disabled={controlBusy || loading || !visibleIds.length}
                    >
                      Select visible
                    </button>
                    <button
                      className="btn btn-small"
                      onClick={() => setSelectedById({})}
                      disabled={controlBusy || loading}
                    >
                      Clear
                    </button>
                  </div>
                  <button
                    className="btn btn-cta"
                    onClick={runApplyTarget}
                    disabled={controlBusy || !applyId || selectedIds.length === 0}
                  >
                    Apply
                  </button>
                </div>

                <div className="control-stack">
                  <section className="control-panel">
                    <button
                      type="button"
                      className="control-panel-header"
                      onClick={() => toggleControlPanel("apply")}
                      aria-expanded={openControlPanels.apply}
                    >
                      <div>
                        <div className="control-panel-title">Apply Target</div>
                        <div className="control-panel-subtitle mono">
                          {applyKind} · {selectedApplyOptionLabel || "(none)"}
                        </div>
                      </div>
                      <span className="control-panel-chevron">
                        {openControlPanels.apply ? "v" : ">"}
                      </span>
                    </button>
                    {openControlPanels.apply ? (
                      <div className="control-panel-body">
                        <div className="control-fields">
                          <select
                            className="input"
                            value={applyKind}
                            onChange={(e) =>
                              setApplyKind(e.target.value as OpsApplyTarget)
                            }
                            disabled={controlBusy}
                          >
                            <option value="profile">profile</option>
                            <option value="channel">channel</option>
                            <option value="block">block</option>
                            <option value="playlist">playlist</option>
                            <option value="media">media</option>
                          </select>
                        </div>
                        <div className="control-fields">
                          <button
                            type="button"
                            className="input picker-trigger"
                            onClick={() => {
                              setTargetPickerFilter("");
                              setTargetPickerOpen(true);
                            }}
                            disabled={controlBusy || !applyOptions.length}
                          >
                            <span className="picker-trigger-label">
                              {selectedApplyOptionLabel || "(no target selected)"}
                            </span>
                            <span className="picker-trigger-meta">
                              {applyOptions.length} targets
                            </span>
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </section>
                </div>

                <section className="control-panel control-block-options">
                  <button
                    type="button"
                    className="control-panel-header"
                    onClick={() => toggleControlPanel("options")}
                    aria-expanded={openControlPanels.options}
                  >
                    <div>
                      <div className="control-panel-title">Options</div>
                      <div className="control-panel-subtitle mono">
                        {applyTargetSummary}
                      </div>
                    </div>
                    <span className="control-panel-chevron">
                      {openControlPanels.options ? "v" : ">"}
                    </span>
                  </button>
                  {openControlPanels.options ? (
                    <div className="control-panel-body">
                      <div className="options-stack">
                        <div className="option-group">
                          <div className="option-group-title">Launch</div>
                          <div className="option-grid option-grid-2">
                            <label className="field">
                              <span className="field-label">mode</span>
                              <select
                                className="input"
                                value={optMode}
                                onChange={(e) =>
                                  setOptMode(
                                    e.target.value as
                                      | "inherit"
                                      | "guide"
                                      | "gallery"
                                  )
                                }
                                disabled={controlBusy}
                              >
                                <option value="inherit">inherit</option>
                                <option value="guide">guide</option>
                                <option value="gallery">gallery</option>
                              </select>
                            </label>
                            {showChannelFallback ? (
                              <label className="field">
                                <span className="field-label">
                                  channel fallback
                                </span>
                                <select
                                  className="input"
                                  value={optChannel}
                                  onChange={(e) =>
                                    setOptChannel(e.target.value)
                                  }
                                  disabled={controlBusy}
                                >
                                  <option value="">auto</option>
                                  {channelOptions.map((option) => (
                                    <option key={option.id} value={option.id}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ) : (
                              <div className="field field-note">
                                <span className="field-label">
                                  channel fallback
                                </span>
                                <div className="field-note-text">
                                  Hidden while explicit target override is
                                  active.
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="option-group">
                          <div className="option-group-title">
                            Target Override
                          </div>
                          <div className="option-grid option-grid-2">
                            <label className="field">
                              <span className="field-label">target kind</span>
                              <select
                                className="input"
                                value={optTargetKind}
                                onChange={(e) =>
                                  setOptTargetKind(
                                    e.target.value as TargetOverrideValue
                                  )
                                }
                                disabled={controlBusy}
                              >
                                <option value="inherit">inherit</option>
                                <option value="media">media</option>
                                <option value="playlist">playlist</option>
                                <option value="block">block</option>
                                <option value="channel">channel</option>
                              </select>
                            </label>
                            <label className="field">
                              <span className="field-label">target id</span>
                              <input
                                className="input"
                                value={optTargetId}
                                onChange={(e) => setOptTargetId(e.target.value)}
                                placeholder="optional override"
                                disabled={controlBusy}
                              />
                            </label>
                          </div>
                        </div>

                        <div className="option-group">
                          <div className="option-group-title">Behavior</div>
                          <div className="option-grid option-grid-2">
                            <label className="field">
                              <span className="field-label">lock</span>
                              <select
                                className="input"
                                value={optLock}
                                onChange={(e) =>
                                  setOptLock(e.target.value as ToggleValue)
                                }
                                disabled={controlBusy}
                              >
                                <option value="inherit">inherit</option>
                                <option value="on">on</option>
                                <option value="off">off</option>
                              </select>
                            </label>
                            <label className="field">
                              <span className="field-label">qr</span>
                              <select
                                className="input"
                                value={optQr}
                                onChange={(e) =>
                                  setOptQr(e.target.value as ToggleValue)
                                }
                                disabled={controlBusy}
                              >
                                <option value="inherit">inherit</option>
                                <option value="on">on</option>
                                <option value="off">off</option>
                              </select>
                            </label>
                            <label className="field">
                              <span className="field-label">playlist</span>
                              <select
                                className="input"
                                value={optPlaylist}
                                onChange={(e) =>
                                  setOptPlaylist(e.target.value as ToggleValue)
                                }
                                disabled={controlBusy}
                              >
                                <option value="inherit">inherit</option>
                                <option value="on">on</option>
                                <option value="off">off</option>
                              </select>
                            </label>
                            <label className="field">
                              <span className="field-label">nosplash</span>
                              <select
                                className="input"
                                value={optNosplash}
                                onChange={(e) =>
                                  setOptNosplash(e.target.value as ToggleValue)
                                }
                                disabled={controlBusy}
                              >
                                <option value="inherit">inherit</option>
                                <option value="on">on</option>
                                <option value="off">off</option>
                              </select>
                            </label>
                            <label className="field">
                              <span className="field-label">info box</span>
                              <select
                                className="input"
                                value={optHudMode}
                                onChange={(e) =>
                                  setOptHudMode(e.target.value as HudModeValue)
                                }
                                disabled={controlBusy}
                              >
                                <option value="inherit">inherit</option>
                                <option value="always">always</option>
                                <option value="start">start</option>
                                <option value="never">never</option>
                              </select>
                            </label>
                            <label className="field">
                              <span className="field-label">info box sec</span>
                              <input
                                className="input"
                                value={optHudShowSec}
                                onChange={(e) =>
                                  setOptHudShowSec(e.target.value)
                                }
                                placeholder="e.g. 8"
                                disabled={controlBusy}
                              />
                            </label>
                          </div>
                        </div>

                        <div className="option-group">
                          <div className="option-group-title">
                            Display (Optional)
                          </div>
                          <div className="option-grid option-grid-3">
                            <label className="field field-span-3">
                              <span className="field-label">theme</span>
                              <input
                                className="input"
                                value={optTheme}
                                onChange={(e) => setOptTheme(e.target.value)}
                                placeholder="theme id"
                                disabled={controlBusy}
                              />
                            </label>
                            <label className="field">
                              <span className="field-label">scale</span>
                              <input
                                className="input"
                                value={optScale}
                                onChange={(e) => setOptScale(e.target.value)}
                                placeholder="1.0"
                                disabled={controlBusy}
                              />
                            </label>
                            <label className="field">
                              <span className="field-label">text scale</span>
                              <input
                                className="input"
                                value={optTextScale}
                                onChange={(e) =>
                                  setOptTextScale(e.target.value)
                                }
                                placeholder="1.0"
                                disabled={controlBusy}
                              />
                            </label>
                            <label className="field">
                              <span className="field-label">hours</span>
                              <input
                                className="input"
                                value={optHours}
                                onChange={(e) => setOptHours(e.target.value)}
                                placeholder="24"
                                disabled={controlBusy}
                              />
                            </label>
                          </div>
                        </div>

                        <div className="option-group option-preview">
                          <div className="option-group-title">
                            Effective Apply
                          </div>
                          <div className="option-preview-summary mono">
                            {applyTargetSummary}
                          </div>
                          <pre className="option-preview-payload mono">
                            {JSON.stringify(applyPayloadPreview, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </section>

                <section className="control-panel">
                  <button
                    type="button"
                    className="control-panel-header"
                    onClick={() => toggleControlPanel("quick")}
                    aria-expanded={openControlPanels.quick}
                  >
                    <div>
                      <div className="control-panel-title">Quick Actions</div>
                      <div className="control-panel-subtitle">
                        Guide and safety actions
                      </div>
                    </div>
                    <span className="control-panel-chevron">
                      {openControlPanels.quick ? "v" : ">"}
                    </span>
                  </button>
                  {openControlPanels.quick ? (
                    <div className="control-panel-body">
                      <div className="control-fields">
                        <button
                          className="btn btn-small"
                          onClick={runReturnToGuide}
                          disabled={controlBusy || selectedIds.length === 0}
                        >
                          Return To Guide
                        </button>
                      </div>
                      <div className="muted small">
                        Uses current option overrides for{" "}
                        <span className="mono">lock / qr / nosplash</span>.
                      </div>
                    </div>
                  ) : null}
                </section>
              </div>
            </div>

            {targetPickerOpen ? (
              <div
                className="picker-modal-backdrop"
                onClick={() => setTargetPickerOpen(false)}
              >
                <div
                  className="picker-modal"
                  onClick={(event) => event.stopPropagation()}
                  role="dialog"
                  aria-modal="true"
                  aria-label="Select apply target"
                >
                  <div className="picker-modal-header">
                    <div>
                      <div className="control-panel-title">Select Target</div>
                      <div className="control-panel-subtitle mono">
                        {applyKind} · {applyOptions.length} total
                      </div>
                    </div>
                    <button
                      className="btn btn-small"
                      onClick={() => setTargetPickerOpen(false)}
                    >
                      Close
                    </button>
                  </div>
                  <input
                    className="input"
                    placeholder="Filter by id or label..."
                    value={targetPickerFilter}
                    onChange={(e) => setTargetPickerFilter(e.target.value)}
                    autoFocus
                  />
                  <div className="picker-modal-list">
                    {filteredApplyOptions.length ? (
                      filteredApplyOptions.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          className={`picker-option ${
                            option.id === applyId ? "selected" : ""
                          }`}
                          onClick={() => {
                            setApplyId(option.id);
                            setTargetPickerOpen(false);
                          }}
                        >
                          <span className="picker-option-id mono">
                            {option.id}
                          </span>
                          <span className="picker-option-label">
                            {option.label}
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="muted">No targets match your filter.</div>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="card">
              <div className="card-header">
                <div className="card-title">
                  {loading ? "Checking..." : `${rows.length} nodes`}
                </div>
                <div className="card-meta">
                  Last tick: {fmtAge(Date.now() - now)} ago
                </div>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="sel-col col-sel">
                        <input
                          type="checkbox"
                          checked={
                            visibleIds.length > 0 &&
                            visibleIds.every((id) => selectedById[id])
                          }
                          onChange={(e) => {
                            if (e.target.checked) {
                              const next: Record<string, boolean> = {
                                ...selectedById,
                              };
                              for (const id of visibleIds) next[id] = true;
                              setSelectedById(next);
                            } else {
                              const next: Record<string, boolean> = {
                                ...selectedById,
                              };
                              for (const id of visibleIds) delete next[id];
                              setSelectedById(next);
                            }
                          }}
                          disabled={
                            controlBusy || loading || !visibleIds.length
                          }
                          aria-label="Select visible nodes"
                          title="Select visible rows"
                        />
                      </th>
                      <th>Node</th>
                      <th>Host</th>
                      <th>DNS</th>
                      <th>Ping</th>
                      <th>SSH</th>
                      <th>Node</th>
                      <th>Cable</th>
                      <th>Versions</th>
                      <th>Last</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((pi) => {
                      const health =
                        (pi as any).dnsOk !== undefined
                          ? (pi as FleetPiHealth)
                          : null;
                      const kind = rowKind(health ?? (pi as FleetPi));
                      const statusPill =
                        kind === "muted" ? (
                          <Pill kind="muted" label="EXTERNAL" />
                        ) : kind === "bad" ? (
                          <Pill kind="bad" label="OFFLINE" />
                        ) : kind === "warn" ? (
                          <Pill kind="warn" label="UPDATE" />
                        ) : (
                          <Pill kind="ok" label="OK" />
                        );

                      const expanded = Boolean(expandedById[pi.id]);
                      const kioskUrl = health?.chibaNode?.kioskUrl ?? "";
                      const kioskParams: Array<[string, string]> | null =
                        (() => {
                          if (!kioskUrl) return null;
                          try {
                            const u = new URL(kioskUrl);
                            return Array.from(u.searchParams.entries()).sort(
                              (a, b) => a[0].localeCompare(b[0])
                            );
                          } catch {
                            return null;
                          }
                        })();

                      const kioskSummary = (() => {
                        if (!kioskUrl) return null;
                        const entries = kioskParams ?? [];
                        const get = (k: string) =>
                          entries.find(([kk]) => kk === k)?.[1] ?? "";
                        const channel = get("channel");
                        const targetKind = get("targetKind");
                        const targetId = get("targetId");
                        const gallery = get("gallery");
                        const playlist = get("playlist");
                        const nosplash = get("nosplash");
                        const bits = [
                          targetKind ? `t=${targetKind}` : "",
                          targetId ? `id=${targetId}` : "",
                          channel ? `ch=${channel}` : "",
                          gallery ? `g=${gallery}` : "",
                          playlist ? `pl=${playlist}` : "",
                          nosplash ? `ns=${nosplash}` : "",
                        ].filter(Boolean);
                        return bits.length
                          ? `kiosk: ${bits.join(" ")}`
                          : "kiosk: (set)";
                      })();

                      const resolvedDeps = resolveTargetDeps(
                        catalogMaps,
                        parseKioskTarget(kioskParams)
                      );

                      return [
                        <tr key={pi.id} className={`row-${kind}`}>
                          <td className="sel-col col-sel">
                            <input
                              type="checkbox"
                              checked={Boolean(selectedById[pi.id])}
                              onChange={(e) =>
                                setSelectedById((prev) => ({
                                  ...prev,
                                  [pi.id]: e.target.checked,
                                }))
                              }
                              disabled={controlBusy || loading}
                              title={`Select ${pi.id}`}
                            />
                          </td>
                          <td className="col-node">
                            <div className="node-cell">
                              <div className="node-name">
                                <button
                                  type="button"
                                  className="twirl"
                                  onClick={() => toggleExpanded(pi.id)}
                                  title={
                                    expanded
                                      ? "Collapse details"
                                      : "Expand details"
                                  }
                                >
                                  {expanded ? "v" : ">"}
                                </button>
                                <span>{pi.nodeName || pi.id}</span>
                              </div>
                              <div className="node-meta">
                                {statusPill}
                                {pi.cable?.orientation ? (
                                  <span className="muted">
                                    {pi.cable.orientation}
                                  </span>
                                ) : null}
                                {pi.cable?.channel ? (
                                  <span className="muted">
                                    ch {pi.cable.channel}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td className="col-host">
                            <div className="mono">{pi.host || "-"}</div>
                            <div className="muted mono">
                              {pi.ip ?? health?.resolvedIp ?? ""}
                            </div>
                          </td>
                          <td className="col-mini">
                            {kind === "muted" ? (
                              <Pill kind="muted" label="-" />
                            ) : health ? (
                              health.dnsOk ? (
                                <Pill kind="ok" label="OK" />
                              ) : (
                                <Pill kind="bad" label="NO" />
                              )
                            ) : (
                              <Pill kind="muted" label="..." />
                            )}
                          </td>
                          <td className="col-mini">
                            {health?.ping?.ok ? (
                              <Pill
                                kind="ok"
                                label={`${health.ping.ms ?? 0}ms`}
                              />
                            ) : (
                              <Pill kind="muted" label={health ? "-" : "..."} />
                            )}
                          </td>
                          <td className="col-mini">
                            {health?.tcp?.ssh22?.ok ? (
                              <Pill kind="ok" label="22" />
                            ) : (
                              <Pill kind="muted" label={health ? "-" : "..."} />
                            )}
                          </td>
                          <td className="col-mini">
                            {health?.http?.nodeStatus?.ok ? (
                              <Pill kind="ok" label="status" />
                            ) : (
                              <Pill kind="muted" label={health ? "-" : "..."} />
                            )}
                          </td>
                          <td className="col-mini">
                            {health?.http?.cableVersion?.ok ? (
                              <Pill kind="ok" label="version" />
                            ) : (
                              <Pill kind="muted" label={health ? "-" : "..."} />
                            )}
                          </td>
                          <td className="col-vers">
                            <div className="muted mono">
                              node: {health?.chibaNode?.version ?? "?"}
                            </div>
                            <div className="muted mono">
                              cable: {health?.cableServer?.version ?? "?"}
                            </div>
                            <div className="muted mono">
                              sha: {health?.cableServer?.gitSha ?? "-"}
                            </div>
                            {kioskSummary ? (
                              <div
                                className="muted mono truncate"
                                title={kioskUrl}
                              >
                                {kioskSummary}
                              </div>
                            ) : null}
                          </td>
                          <td className="muted col-last">
                            {health
                              ? `${fmtAge(
                                  Date.now() - health.lastCheckedAt
                                )} ago`
                              : "..."}
                          </td>
                          <td className="actions-cell col-act">
                            {pi.ip || pi.host ? (
                              <button
                                className="btn btn-small"
                                onClick={() => refreshOne(pi.id)}
                                disabled={checkingById[pi.id] || loading}
                                title="Probe this node only"
                              >
                                {checkingById[pi.id] ? "Checking…" : "Check"}
                              </button>
                            ) : (
                              <span className="muted">-</span>
                            )}
                          </td>
                        </tr>,
                        expanded ? (
                          <tr
                            key={`${pi.id}:detail`}
                            className={`row-detail row-${kind}`}
                          >
                            <td colSpan={11}>
                              <div className="detail-panel">
                                <div className="detail-title">Kiosk URL</div>
                                <div className="detail-grid">
                                  <div>
                                    <div className="muted small">raw</div>
                                    <div className="mono wrap">
                                      {kioskUrl || "-"}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="muted small">params</div>
                                    {kioskParams && kioskParams.length ? (
                                      <table className="kv">
                                        <tbody>
                                          {kioskParams.map(([k, v], idx) => (
                                            <tr key={`${k}:${idx}`}>
                                              <td className="mono k">{k}</td>
                                              <td className="mono v">{v}</td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    ) : (
                                      <div className="muted small">
                                        {kioskUrl
                                          ? "(none or unparseable)"
                                          : "(no kiosk url)"}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div style={{ marginTop: 14 }}>
                                  <div className="detail-title">
                                    Resolved Content (New Model)
                                  </div>
                                  {resolvedDeps ? (
                                    <div className="detail-grid">
                                      <div>
                                        <div className="muted small">
                                          target
                                        </div>
                                        <div className="mono">
                                          {resolvedDeps.targetKind}:
                                          {resolvedDeps.targetId}
                                        </div>
                                        <div className="muted small">
                                          channels
                                        </div>
                                        <div className="mono wrap">
                                          {resolvedDeps.channelIds.length
                                            ? resolvedDeps.channelIds.join(", ")
                                            : "(none)"}
                                        </div>
                                        <div className="muted small">
                                          blocks
                                        </div>
                                        <div className="mono wrap">
                                          {resolvedDeps.blockIds.length
                                            ? resolvedDeps.blockIds.join(", ")
                                            : "(none)"}
                                        </div>
                                        <div className="muted small">
                                          playlists
                                        </div>
                                        <div className="mono wrap">
                                          {resolvedDeps.playlistIds.length
                                            ? resolvedDeps.playlistIds.join(
                                                ", "
                                              )
                                            : "(none)"}
                                        </div>
                                      </div>
                                      <div>
                                        <div className="muted small">
                                          media deps
                                        </div>
                                        <div className="mono">
                                          {resolvedDeps.mediaIds.length} items
                                        </div>
                                        <div className="muted small">
                                          first few
                                        </div>
                                        <div className="mono wrap">
                                          {resolvedDeps.mediaIds
                                            .slice(0, 6)
                                            .join(", ") || "(none)"}
                                        </div>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="muted small">
                                      {catalog
                                        ? "No target catalog match (or target not set)."
                                        : "Catalog not loaded yet."}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null,
                      ];
                    })}
                    {!rows.length ? (
                      <tr>
                        <td colSpan={11} className="empty">
                          {loading
                            ? "Loading..."
                            : "No nodes (check registry config on the server)."}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
