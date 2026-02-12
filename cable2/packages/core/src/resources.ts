import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import toml from "@iarna/toml";
import { findRepoRoot } from "./registry.js";

export type SourceRef = {
  type: "path" | "url";
  value: string;
  cache?: boolean;
};

export type MediaDef = {
  id: string;
  filePath: string;
  title?: string;
  source?: SourceRef;
};

export type PlaylistItemDef = {
  media?: string;
  source?: SourceRef;
};

export type PlaylistDef = {
  id: string;
  filePath: string;
  title?: string;
  items: PlaylistItemDef[];
};

export type BlockProgramDef = {
  source?: SourceRef;
};

export type BlockDef = {
  id: string;
  filePath: string;
  mode?: "loop" | "once" | "clocked";
  playlist?: string;
  programs: BlockProgramDef[];
};

export type ChannelProgramDef = {
  source?: SourceRef;
};

export type ChannelDef = {
  id: string;
  filePath: string;
  title?: string;
  blocks: string[];
  programs: ChannelProgramDef[];
};

export type ProfileModeDef = {
  mode?: "gallery" | "guide";
  channel?: string;
  playlist?: boolean;
  lock?: boolean;
  qr?: boolean;
  nosplash?: boolean;
  theme?: string;
  scale?: number;
  text_scale?: number;
  hours?: number;
  prefetch_channels?: string[];
};

export type ProfileDef = {
  id: string;
  filePath: string;
  defaults: ProfileModeDef;
  pis: Record<string, ProfileModeDef>;
};

export type ResourceStore = {
  repoRoot: string;
  configRoot: string;
  mediaById: Record<string, MediaDef>;
  playlistsById: Record<string, PlaylistDef>;
  blocksById: Record<string, BlockDef>;
  channelsById: Record<string, ChannelDef>;
  profilesById: Record<string, ProfileDef>;
};

export type LoadResourceStoreOptions = {
  repoRoot?: string;
  configRoot?: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function coerceString(value: unknown): string | undefined {
  if (!isNonEmptyString(value)) return undefined;
  return value.trim();
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function coerceStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (!isNonEmptyString(item)) continue;
    out.push(item.trim());
  }
  return Array.from(new Set(out));
}

function ensureArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value === undefined || value === null) return [];
  return [value as T];
}

function parseSource(raw: unknown): SourceRef | undefined {
  if (!isObject(raw)) return undefined;
  const type = raw.type;
  const value = raw.value;
  if ((type !== "path" && type !== "url") || !isNonEmptyString(value)) return undefined;
  const out: SourceRef = {
    type,
    value: value.trim(),
  };
  const cache = coerceBoolean(raw.cache);
  if (cache !== undefined) out.cache = cache;
  return out;
}

function parseProfileMode(raw: unknown): ProfileModeDef {
  if (!isObject(raw)) return {};
  const modeRaw = coerceString(raw.mode);
  const mode = modeRaw === "gallery" || modeRaw === "guide" ? modeRaw : undefined;
  const out: ProfileModeDef = {};
  const channel = coerceString(raw.channel);
  const playlist = coerceBoolean(raw.playlist);
  const lock = coerceBoolean(raw.lock);
  const qr = coerceBoolean(raw.qr);
  const nosplash = coerceBoolean(raw.nosplash);
  const theme = coerceString(raw.theme);
  const scale = coerceNumber(raw.scale);
  const textScale = coerceNumber(raw.text_scale);
  const hours = coerceNumber(raw.hours);
  const prefetchChannels = coerceStringArray(raw.prefetch_channels);

  if (mode !== undefined) out.mode = mode;
  if (channel !== undefined) out.channel = channel;
  if (playlist !== undefined) out.playlist = playlist;
  if (lock !== undefined) out.lock = lock;
  if (qr !== undefined) out.qr = qr;
  if (nosplash !== undefined) out.nosplash = nosplash;
  if (theme !== undefined) out.theme = theme;
  if (scale !== undefined) out.scale = scale;
  if (textScale !== undefined) out.text_scale = textScale;
  if (hours !== undefined) out.hours = hours;
  if (prefetchChannels.length > 0) out.prefetch_channels = prefetchChannels;

  return out;
}

async function readTomlDir(dirPath: string): Promise<Array<{ filePath: string; parsed: Record<string, unknown> }>> {
  let names: string[] = [];
  try {
    names = (await fs.readdir(dirPath)).filter((name) => name.endsWith(".toml"));
  } catch {
    return [];
  }

  const out: Array<{ filePath: string; parsed: Record<string, unknown> }> = [];
  for (const name of names) {
    const filePath = path.join(dirPath, name);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const parsed = toml.parse(raw) as unknown;
      if (!isObject(parsed)) continue;
      out.push({ filePath, parsed });
    } catch {
      // Skip invalid files in scaffold stage.
    }
  }
  return out;
}

export async function loadResourceStore(options: LoadResourceStoreOptions = {}): Promise<ResourceStore> {
  const repoRoot = options.repoRoot ?? findRepoRoot();
  const defaultConfigRoot = options.configRoot ?? (() => {
    const candidates = ["config", "cable2/config"];
    for (const candidate of candidates) {
      if (fsSync.existsSync(path.join(repoRoot, candidate))) {
        return candidate;
      }
    }
    return "config";
  })();
  const configRoot = path.resolve(repoRoot, defaultConfigRoot);

  const mediaById: Record<string, MediaDef> = {};
  const playlistsById: Record<string, PlaylistDef> = {};
  const blocksById: Record<string, BlockDef> = {};
  const channelsById: Record<string, ChannelDef> = {};
  const profilesById: Record<string, ProfileDef> = {};

  const [mediaRows, playlistRows, blockRows, channelRows, profileRows] = await Promise.all([
    readTomlDir(path.join(configRoot, "media")),
    readTomlDir(path.join(configRoot, "playlists")),
    readTomlDir(path.join(configRoot, "blocks")),
    readTomlDir(path.join(configRoot, "channels")),
    readTomlDir(path.join(configRoot, "profiles")),
  ]);

  for (const row of mediaRows) {
    const id = coerceString(row.parsed.id) ?? path.basename(row.filePath, ".toml");
    const entry: MediaDef = {
      id,
      filePath: row.filePath,
    };
    const title = coerceString(row.parsed.title) ?? coerceString(row.parsed.name);
    const source = parseSource(row.parsed.source) ?? parseSource(row.parsed);
    if (title !== undefined) entry.title = title;
    if (source !== undefined) entry.source = source;
    mediaById[id] = entry;
  }

  for (const row of playlistRows) {
    const id = coerceString(row.parsed.id) ?? path.basename(row.filePath, ".toml");
    const itemsRaw = ensureArray<Record<string, unknown>>(row.parsed.items ?? row.parsed.item);
    const items: PlaylistItemDef[] = itemsRaw.map((item) => {
      const out: PlaylistItemDef = {};
      const media = coerceString(item.media);
      const source = parseSource(item.source);
      if (media !== undefined) out.media = media;
      if (source !== undefined) out.source = source;
      return out;
    });

    const entry: PlaylistDef = {
      id,
      filePath: row.filePath,
      items,
    };
    const title = coerceString(row.parsed.name) ?? coerceString(row.parsed.title);
    if (title !== undefined) entry.title = title;
    playlistsById[id] = entry;
  }

  for (const row of blockRows) {
    const id = coerceString(row.parsed.id) ?? path.basename(row.filePath, ".toml");
    const modeRaw = coerceString(row.parsed.mode);
    const mode = modeRaw === "loop" || modeRaw === "once" || modeRaw === "clocked" ? modeRaw : undefined;
    const programsRaw = ensureArray<Record<string, unknown>>(row.parsed.programs ?? row.parsed.program);
    const programs: BlockProgramDef[] = programsRaw.map((program) => {
      const out: BlockProgramDef = {};
      const source = parseSource(program.source);
      if (source !== undefined) out.source = source;
      return out;
    });

    const entry: BlockDef = {
      id,
      filePath: row.filePath,
      programs,
    };
    const playlist = coerceString(row.parsed.playlist);
    if (mode !== undefined) entry.mode = mode;
    if (playlist !== undefined) entry.playlist = playlist;
    blocksById[id] = entry;
  }

  for (const row of channelRows) {
    const id = coerceString(row.parsed.id) ?? path.basename(row.filePath, ".toml");
    const blocksArray = coerceStringArray(row.parsed.blocks);
    const blockTables = ensureArray<Record<string, unknown>>(row.parsed.block)
      .map((table) => coerceString(table.id))
      .filter((value): value is string => Boolean(value));
    const blocks = Array.from(new Set([...blocksArray, ...blockTables]));

    const programsRaw = ensureArray<Record<string, unknown>>(row.parsed.programs ?? row.parsed.program);
    const programs: ChannelProgramDef[] = programsRaw.map((program) => {
      const out: ChannelProgramDef = {};
      const source = parseSource(program.source);
      if (source !== undefined) out.source = source;
      return out;
    });

    const entry: ChannelDef = {
      id,
      filePath: row.filePath,
      blocks,
      programs,
    };
    const title = coerceString(row.parsed.name) ?? coerceString(row.parsed.title);
    if (title !== undefined) entry.title = title;
    channelsById[id] = entry;
  }

  for (const row of profileRows) {
    const id = path.basename(row.filePath, ".toml");
    const defaults = parseProfileMode(isObject(row.parsed.defaults) ? row.parsed.defaults.cable : undefined);

    const pisRaw = isObject(row.parsed.pis) ? row.parsed.pis : {};
    const pis: Record<string, ProfileModeDef> = {};
    for (const [piId, piConfig] of Object.entries(pisRaw)) {
      const mode = parseProfileMode(isObject(piConfig) ? piConfig.cable : undefined);
      pis[piId] = mode;
    }

    profilesById[id] = {
      id,
      filePath: row.filePath,
      defaults,
      pis,
    };
  }

  return {
    repoRoot,
    configRoot,
    mediaById,
    playlistsById,
    blocksById,
    channelsById,
    profilesById,
  };
}
