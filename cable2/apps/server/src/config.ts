import fs from "node:fs/promises";
import path from "node:path";
import toml from "@iarna/toml";

export type ChannelProgramSource = {
  type: "path" | "url";
  value: string;
  cache?: boolean;
};

// ---- New, composable config model (compatible with existing channels) ----
export type MediaKind = "image" | "video" | "audio" | "web" | "unknown";

export type MediaManifest = {
  id: string;
  kind?: MediaKind;
  title?: string;
  subtitle?: string;
  tag?: string;
  artist?: string;
  description?: string;
  source: ChannelProgramSource;
};

export type PlaylistItem = {
  // Prefer referencing a media object for reuse.
  media?: string;
  // Inline source is allowed as an escape hatch.
  source?: ChannelProgramSource;

  title?: string;
  subtitle?: string;
  tag?: string;
  artist?: string;
  info_title?: string;
  description?: string;
  info_mode?: "always" | "start" | "never";
  show_sec?: number;
  duration_slots?: number;
  remote_controls?: RemoteRegistration[];
};

export type PlaylistManifest = {
  id: string;
  name?: string;
  // TOML accepts `[[item]]` or `[[items]]`.
  items: PlaylistItem[];
};

export type BlockMode = "loop" | "once" | "clocked";

export type BlockManifest = {
  id: string;
  mode?: BlockMode;
  playlist?: string;
  // Blocks can also inline legacy programs.
  programs?: ChannelProgram[];
};

export type RemoteRegistration = "mic" | "app" | "keyboard_mouse";

export type ChannelInfoCard = {
  // Defaults for the player info card (HUD) when a program starts.
  artist?: string;
  title?: string;
  description?: string;
  mode?: "always" | "start" | "never";
  show_sec?: number;
};

export type ChannelProgram = {
  title: string;
  subtitle?: string;
  tag?: string;
  artist?: string;
  info_title?: string;
  description?: string;
  info_mode?: "always" | "start" | "never";
  show_sec?: number;
  duration_slots?: number;
  remote_controls?: RemoteRegistration[];
  source?: ChannelProgramSource;
};

export type ChannelManifest = {
  id: string;
  number: string;
  name: string;
  call_sign: string;
  accent?: string;
  description?: string;
  info?: ChannelInfoCard;
  audio_source?: ChannelProgramSource;
  audio_volume?: number;
  audio_offset_min_sec?: number;
  audio_offset_max_sec?: number;
  embed?: ChannelEmbedConfig;
  // V2 channel scheduling: resolve these block ids into programs.
  blocks?: string[];
  programs: ChannelProgram[];
};

export type ChannelEmbedOverlay = {
  title?: string;
  subtitle?: string;
  hint?: string;
  qr?: string;
  button?: string;
  show_delay_ms?: number;
  hide_on_message?: boolean;
  mode?: "center" | "corner";
};

export type ChannelEmbedMask = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  width?: number;
  height?: number;
};

export type ChannelEmbedConfig = {
  mode?: "iframe" | "proxy";
  url?: string;
  allow?: string;
  sandbox?: string;
  autoplay_messages?: string[];
  autoplay_delay_ms?: number;
  autoplay_retry_ms?: number;
  autoplay_retries?: number;
  dismiss_selectors?: string[];
  mask?: ChannelEmbedMask;
  overlay?: ChannelEmbedOverlay;
};

export type ChibaConfig = {
  server?: {
    host?: string;
    port?: number;
    remote_url?: string;
  };
  library: {
    roots: string[];
  };
  index?: {
    scan_interval_sec?: number;
    full_scan_on_start?: boolean;
  };
  // Optional composable definition directories (defaults to "media/", "playlists/", "blocks/"
  // next to this config file).
  media?: {
    manifest_dir?: string;
  };
  playlists?: {
    manifest_dir?: string;
  };
  blocks?: {
    manifest_dir?: string;
  };
  channels: {
    manifest_dir: string;
    slot_minutes: number;
    slot_count: number;
    start_time: string;
  };
};

export type LoadedConfig = {
  config: ChibaConfig;
  configPath: string;
  manifestDir: string;
  libraryRoots: string[];
  channels: ChannelManifest[];
  // Optional composable definitions (loaded if directories exist).
  mediaById: Record<string, MediaManifest>;
  playlistsById: Record<string, PlaylistManifest>;
  blocksById: Record<string, BlockManifest>;
};

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function ensureArray<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function resolvePath(baseDir: string, target: string): string {
  if (path.isAbsolute(target)) return target;
  return path.resolve(baseDir, target);
}

function normalizePrograms(programs: ChannelProgram[] | undefined): ChannelProgram[] {
  return ensureArray(programs ?? []).map((program) => ({
    ...program,
    artist: isString((program as any).artist) ? (program as any).artist : undefined,
    info_title: isString((program as any).info_title) ? (program as any).info_title : undefined,
    description: isString((program as any).description) ? (program as any).description : undefined,
    info_mode:
      (program as any).info_mode === "always" ||
      (program as any).info_mode === "start" ||
      (program as any).info_mode === "never"
        ? ((program as any).info_mode as any)
        : undefined,
    duration_slots:
      typeof program.duration_slots === "number" && program.duration_slots > 0
        ? program.duration_slots
        : 1,
    show_sec:
      typeof program.show_sec === "number" && program.show_sec >= 0
        ? program.show_sec
        : undefined,
    remote_controls: normalizeRemoteControls(program.remote_controls),
  }));
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function normalizeRemoteControls(
  value: unknown
): RemoteRegistration[] | undefined {
  const raw = ensureArray(value).filter(isString);
  if (!raw.length) return undefined;
  const normalized = raw
    .map((entry) => entry.trim().toLowerCase())
    .map((entry) => {
      if (entry === "keyboard-mouse" || entry === "keyboard/mouse") {
        return "keyboard_mouse";
      }
      if (entry === "app-controls" || entry === "app_controls") {
        return "app";
      }
      if (entry === "microphone") {
        return "mic";
      }
      return entry;
    })
    .filter(
      (entry): entry is RemoteRegistration =>
        entry === "mic" || entry === "app" || entry === "keyboard_mouse"
    );
  if (!normalized.length) return undefined;
  return Array.from(new Set(normalized));
}

function normalizeEmbed(value: unknown): ChannelEmbedConfig | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const overlayRaw =
    raw.overlay && typeof raw.overlay === "object"
      ? (raw.overlay as Record<string, unknown>)
      : undefined;
  const maskRaw =
    raw.mask && typeof raw.mask === "object"
      ? (raw.mask as Record<string, unknown>)
      : undefined;
  const embed: ChannelEmbedConfig = {
    mode:
      raw.mode === "proxy" || raw.mode === "iframe"
        ? raw.mode
        : undefined,
    url: isString(raw.url) ? raw.url : undefined,
    allow: isString(raw.allow) ? raw.allow : undefined,
    sandbox: isString(raw.sandbox) ? raw.sandbox : undefined,
    autoplay_messages: ensureArray(raw.autoplay_messages).filter(isString),
    autoplay_delay_ms: normalizeNumber(raw.autoplay_delay_ms),
    autoplay_retry_ms: normalizeNumber(raw.autoplay_retry_ms),
    autoplay_retries: normalizeNumber(raw.autoplay_retries),
    dismiss_selectors: ensureArray(raw.dismiss_selectors).filter(isString),
    mask: maskRaw
      ? {
          top: normalizeNumber(maskRaw.top),
          right: normalizeNumber(maskRaw.right),
          bottom: normalizeNumber(maskRaw.bottom),
          left: normalizeNumber(maskRaw.left),
          width: normalizeNumber(maskRaw.width),
          height: normalizeNumber(maskRaw.height),
        }
      : undefined,
    overlay: overlayRaw
      ? {
          title: isString(overlayRaw.title) ? overlayRaw.title : undefined,
          subtitle: isString(overlayRaw.subtitle) ? overlayRaw.subtitle : undefined,
          hint: isString(overlayRaw.hint) ? overlayRaw.hint : undefined,
          qr: isString(overlayRaw.qr) ? overlayRaw.qr : undefined,
          button: isString(overlayRaw.button) ? overlayRaw.button : undefined,
          show_delay_ms: normalizeNumber(overlayRaw.show_delay_ms),
          hide_on_message:
            typeof overlayRaw.hide_on_message === "boolean"
              ? overlayRaw.hide_on_message
              : undefined,
          mode:
            overlayRaw.mode === "corner" || overlayRaw.mode === "center"
              ? overlayRaw.mode
              : undefined,
        }
      : undefined,
  };
  if (!embed.mode && !embed.url) return undefined;
  return embed;
}

function normalizeInfo(value: unknown): ChannelInfoCard | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const info: ChannelInfoCard = {
    artist: isString(raw.artist) ? (raw.artist as string) : undefined,
    title: isString(raw.title) ? (raw.title as string) : undefined,
    description: isString(raw.description) ? (raw.description as string) : undefined,
    mode:
      raw.mode === "always" || raw.mode === "start" || raw.mode === "never"
        ? (raw.mode as any)
        : undefined,
    show_sec: normalizeNumber(raw.show_sec),
  };
  if (
    !info.artist &&
    !info.title &&
    !info.description &&
    info.mode === undefined &&
    info.show_sec === undefined
  ) {
    return undefined;
  }
  if (typeof info.show_sec === "number" && info.show_sec < 0) {
    info.show_sec = 0;
  }
  return info;
}

function normalizeIds(value: unknown): string[] | undefined {
  const raw = ensureArray(value).filter(isString).map((s) => s.trim());
  if (!raw.length) return undefined;
  return Array.from(new Set(raw));
}

function normalizeSource(value: unknown): ChannelProgramSource | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as any;
  const t = raw.type === "path" || raw.type === "url" ? raw.type : null;
  const v = isString(raw.value) ? String(raw.value).trim() : "";
  if (!t || !v) return undefined;
  const cache = typeof raw.cache === "boolean" ? raw.cache : undefined;
  return { type: t, value: v, cache };
}

function normalizePlaylistItems(items: PlaylistItem[] | undefined): PlaylistItem[] {
  return ensureArray(items ?? []).map((item) => ({
    ...item,
    media: isString((item as any).media) ? String((item as any).media).trim() : undefined,
    source: normalizeSource((item as any).source) ?? (item as any).source,
    title: isString((item as any).title) ? (item as any).title : undefined,
    subtitle: isString((item as any).subtitle) ? (item as any).subtitle : undefined,
    tag: isString((item as any).tag) ? (item as any).tag : undefined,
    artist: isString((item as any).artist) ? (item as any).artist : undefined,
    info_title: isString((item as any).info_title) ? (item as any).info_title : undefined,
    description: isString((item as any).description) ? (item as any).description : undefined,
    info_mode:
      (item as any).info_mode === "always" ||
      (item as any).info_mode === "start" ||
      (item as any).info_mode === "never"
        ? ((item as any).info_mode as any)
        : undefined,
    duration_slots:
      typeof (item as any).duration_slots === "number" && (item as any).duration_slots > 0
        ? (item as any).duration_slots
        : 1,
    show_sec:
      typeof (item as any).show_sec === "number" && (item as any).show_sec >= 0
        ? (item as any).show_sec
        : undefined,
    remote_controls: normalizeRemoteControls((item as any).remote_controls),
  }));
}

async function loadChannelManifest(filePath: string): Promise<ChannelManifest> {
  const raw = await fs.readFile(filePath, "utf-8");
  const parsed = toml.parse(raw) as Partial<ChannelManifest> & {
    program?: ChannelProgram[] | ChannelProgram;
    blocks?: string[] | string;
    block?: Array<{ id?: string }> | { id?: string };
  };

  const programs = normalizePrograms(
    (parsed.programs ?? parsed.program) as ChannelProgram[] | undefined
  );

  const blocksFromArray = normalizeIds((parsed as any).blocks);
  const blocksFromTables = normalizeIds(
    ensureArray((parsed as any).block).map((b: any) => b?.id).filter(Boolean)
  );
  const blocks = normalizeIds([...(blocksFromArray ?? []), ...(blocksFromTables ?? [])]);

  return {
    id: parsed.id ?? path.basename(filePath, path.extname(filePath)),
    number: parsed.number ?? "",
    name: parsed.name ?? parsed.id ?? "Channel",
    call_sign: parsed.call_sign ?? "",
    accent: parsed.accent,
    description: parsed.description,
    info: normalizeInfo((parsed as any).info),
    audio_source: parsed.audio_source,
    audio_volume: normalizeNumber(parsed.audio_volume),
    audio_offset_min_sec: normalizeNumber(parsed.audio_offset_min_sec),
    audio_offset_max_sec: normalizeNumber(parsed.audio_offset_max_sec),
    embed: normalizeEmbed(parsed.embed),
    blocks,
    programs,
  };
}

async function loadManifestsFromDir<T>(dirPath: string, loadOne: (filePath: string) => Promise<T>): Promise<T[]> {
  let files: string[] = [];
  try {
    files = (await fs.readdir(dirPath))
      .filter((file) => file.endsWith(".toml"))
      .map((file) => path.join(dirPath, file));
  } catch {
    files = [];
  }
  return await Promise.all(files.map((file) => loadOne(file)));
}

async function loadMediaManifest(filePath: string): Promise<MediaManifest> {
  const raw = await fs.readFile(filePath, "utf-8");
  const parsed = toml.parse(raw) as any;
  const id = isString(parsed?.id)
    ? String(parsed.id).trim()
    : path.basename(filePath, path.extname(filePath));
  const source = normalizeSource(parsed?.source) ?? normalizeSource(parsed) ?? undefined;
  if (!source) {
    throw new Error(`Media missing source: ${path.basename(filePath)}`);
  }
  const kindRaw = isString(parsed?.kind) ? String(parsed.kind).trim().toLowerCase() : "";
  const kind: MediaKind | undefined =
    kindRaw === "image" || kindRaw === "video" || kindRaw === "audio" || kindRaw === "web"
      ? (kindRaw as any)
      : kindRaw
        ? "unknown"
        : undefined;
  return {
    id,
    kind,
    title: isString(parsed?.title) ? parsed.title : undefined,
    subtitle: isString(parsed?.subtitle) ? parsed.subtitle : undefined,
    tag: isString(parsed?.tag) ? parsed.tag : undefined,
    artist: isString(parsed?.artist) ? parsed.artist : undefined,
    description: isString(parsed?.description) ? parsed.description : undefined,
    source,
  };
}

async function loadPlaylistManifest(filePath: string): Promise<PlaylistManifest> {
  const raw = await fs.readFile(filePath, "utf-8");
  const parsed = toml.parse(raw) as any;
  const id = isString(parsed?.id)
    ? String(parsed.id).trim()
    : path.basename(filePath, path.extname(filePath));
  const items = normalizePlaylistItems(
    (parsed?.items ?? parsed?.item ?? []) as PlaylistItem[] | undefined
  );
  return {
    id,
    name: isString(parsed?.name) ? parsed.name : undefined,
    items,
  };
}

async function loadBlockManifest(filePath: string): Promise<BlockManifest> {
  const raw = await fs.readFile(filePath, "utf-8");
  const parsed = toml.parse(raw) as any;
  const id = isString(parsed?.id)
    ? String(parsed.id).trim()
    : path.basename(filePath, path.extname(filePath));
  const modeRaw = isString(parsed?.mode) ? String(parsed.mode).trim().toLowerCase() : "";
  const mode: BlockMode | undefined =
    modeRaw === "loop" || modeRaw === "once" || modeRaw === "clocked"
      ? (modeRaw as any)
      : undefined;
  const playlist = isString(parsed?.playlist) ? String(parsed.playlist).trim() : undefined;
  const programs = normalizePrograms(
    (parsed?.programs ?? parsed?.program) as ChannelProgram[] | undefined
  );
  return {
    id,
    mode,
    playlist,
    programs: programs.length ? programs : undefined,
  };
}

export async function loadConfig(configPath: string): Promise<LoadedConfig> {
  const configRaw = await fs.readFile(configPath, "utf-8");
  const parsed = toml.parse(configRaw) as ChibaConfig;
  if (!parsed.library || !parsed.channels) {
    throw new Error("Config missing [library] or [channels] sections.");
  }
  const baseDir = path.dirname(configPath);
  const manifestDir = resolvePath(baseDir, parsed.channels.manifest_dir);
  const mediaManifestDir = resolvePath(
    baseDir,
    (parsed as any).media?.manifest_dir ?? "media"
  );
  const playlistsManifestDir = resolvePath(
    baseDir,
    (parsed as any).playlists?.manifest_dir ?? "playlists"
  );
  const blocksManifestDir = resolvePath(
    baseDir,
    (parsed as any).blocks?.manifest_dir ?? "blocks"
  );

  const rootCandidates = ensureArray(parsed.library.roots).filter(isString);
  const libraryRoots = rootCandidates.map((root) => resolvePath(baseDir, root));

  let channelFiles: string[] = [];
  try {
    channelFiles = (await fs.readdir(manifestDir))
      .filter((file) => file.endsWith(".toml"))
      .map((file) => path.join(manifestDir, file));
  } catch {
    channelFiles = [];
  }

  const channels = await Promise.all(
    channelFiles.map((file) => loadChannelManifest(file))
  );

  const [mediaList, playlistList, blockList] = await Promise.all([
    loadManifestsFromDir(mediaManifestDir, loadMediaManifest).catch(() => []),
    loadManifestsFromDir(playlistsManifestDir, loadPlaylistManifest).catch(() => []),
    loadManifestsFromDir(blocksManifestDir, loadBlockManifest).catch(() => []),
  ]);

  const mediaById: Record<string, MediaManifest> = {};
  for (const m of mediaList) {
    if (!m?.id) continue;
    mediaById[m.id] = m;
  }
  const playlistsById: Record<string, PlaylistManifest> = {};
  for (const p of playlistList) {
    if (!p?.id) continue;
    playlistsById[p.id] = p;
  }
  const blocksById: Record<string, BlockManifest> = {};
  for (const b of blockList) {
    if (!b?.id) continue;
    blocksById[b.id] = b;
  }

  return {
    config: parsed,
    configPath,
    manifestDir,
    libraryRoots,
    channels,
    mediaById,
    playlistsById,
    blocksById,
  };
}
