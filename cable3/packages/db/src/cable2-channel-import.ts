import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import TOML from "@iarna/toml";
import {
  ResourceImportPayloadSchema,
  type BlockResource,
  type ChannelResource,
  type MediaResource,
  type PlaylistResource,
  type ResourceImportPayload,
} from "@chiba-cable3/contracts";
import type { Cable3Db } from "./db.js";
import { importResources } from "./resource-store.js";

type Cable2MediaDef = {
  id: string;
  title?: string;
  artist?: string;
  description?: string;
  sourceType: "path" | "url";
  sourceValue: string;
  cache: boolean;
};

type Cable2PlaylistDef = {
  id: string;
  title?: string;
  artist?: string;
  description?: string;
  items: Array<{ index: number; mediaId?: string; playlistId?: string; durationSlots?: number }>;
};

type Cable2BlockDef = {
  id: string;
  mode?: "loop" | "once" | "clocked";
  playlistId?: string;
  items: Array<{ index: number; mediaId?: string; playlistId?: string; durationSlots?: number }>;
};

type Cable2ChannelDef = {
  id: string;
  number?: string;
  name?: string;
  blockIds: string[];
  programSources: string[];
  embedUrl?: string;
};

type Cable2ParsedCatalog = {
  mediaById: Map<string, Cable2MediaDef>;
  playlistsById: Map<string, Cable2PlaylistDef>;
  blocksById: Map<string, Cable2BlockDef>;
  channelsById: Map<string, Cable2ChannelDef>;
};

export type BuildCable2ImportArgs = {
  configRoot: string;
  channelIds?: string[];
  guideBaseUrl?: string;
  slotDurationSec?: number;
};

export type BuildCable2ImportResult = {
  payload: ResourceImportPayload;
  warnings: string[];
};

type ParsedToml = Record<string, unknown>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => asString(item))
    .filter((item): item is string => Boolean(item));
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value === undefined || value === null) return [];
  return [value as T];
}

async function readTomlDir(dirPath: string): Promise<Array<{ filePath: string; parsed: ParsedToml }>> {
  let files: string[] = [];
  try {
    files = (await readdir(dirPath)).filter((name) => name.endsWith(".toml"));
  } catch {
    return [];
  }

  const rows: Array<{ filePath: string; parsed: ParsedToml }> = [];
  for (const fileName of files) {
    const filePath = path.join(dirPath, fileName);
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = TOML.parse(raw) as unknown;
      if (!isObject(parsed)) continue;
      rows.push({ filePath, parsed });
    } catch {
      // Skip malformed rows.
    }
  }
  return rows;
}

function normalizeGuideUrl(baseUrlRaw: string | undefined): string | null {
  const raw = repairMissingScheme((baseUrlRaw ?? "").trim());
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.toString();
  } catch {
    return null;
  }
}

function repairMissingScheme(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  return raw.replace(/^([a-z][a-z0-9+.-]*)\/\//i, "$1://");
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function rewriteLoopbackUrl(baseUrl: string | null, sourceValue: string): string {
  if (!baseUrl) return sourceValue;
  try {
    const guide = new URL(baseUrl);
    const source = new URL(repairMissingScheme(sourceValue));
    if (!isLoopbackHost(source.hostname)) return sourceValue;
    source.hostname = guide.hostname;

    for (const [key, value] of source.searchParams.entries()) {
      try {
        const nested = new URL(value);
        if (!isLoopbackHost(nested.hostname)) continue;
        nested.hostname = guide.hostname;
        source.searchParams.set(key, nested.toString());
      } catch {
        // keep non-URL query values as-is
      }
    }
    return source.toString();
  } catch {
    return sourceValue;
  }
}

function toAbsoluteUrl(baseUrl: string | null, sourceValue: string): string {
  const normalized = repairMissingScheme(sourceValue);
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    return normalized;
  }
  if (!baseUrl || !normalized.startsWith("/")) return normalized;
  return new URL(normalized, baseUrl).toString();
}

async function parseCable2Catalog(configRoot: string): Promise<Cable2ParsedCatalog> {
  const mediaRows = await readTomlDir(path.join(configRoot, "media"));
  const playlistRows = await readTomlDir(path.join(configRoot, "playlists"));
  const blockRows = await readTomlDir(path.join(configRoot, "blocks"));
  const channelRows = await readTomlDir(path.join(configRoot, "channels"));

  const mediaById = new Map<string, Cable2MediaDef>();
  const playlistsById = new Map<string, Cable2PlaylistDef>();
  const blocksById = new Map<string, Cable2BlockDef>();
  const channelsById = new Map<string, Cable2ChannelDef>();

  for (const row of mediaRows) {
    const id = asString(row.parsed.id) ?? path.basename(row.filePath, ".toml");
    const source = isObject(row.parsed.source) ? row.parsed.source : row.parsed;
    const sourceTypeRaw = asString(source.type);
    const sourceValue = asString(source.value);
    if (
      (sourceTypeRaw !== "path" && sourceTypeRaw !== "url") ||
      !sourceValue
    ) {
      continue;
    }
    const title = asString(row.parsed.title) ?? asString(row.parsed.name);
    const artist = asString(row.parsed.artist);
    const description = asString(row.parsed.description);
    mediaById.set(id, {
      id,
      ...(title ? { title } : {}),
      ...(artist ? { artist } : {}),
      ...(description ? { description } : {}),
      sourceType: sourceTypeRaw,
      sourceValue,
      cache: asBoolean(source.cache) ?? true,
    });
  }

  for (const row of playlistRows) {
    const id = asString(row.parsed.id) ?? path.basename(row.filePath, ".toml");
    const itemRows = asArray<Record<string, unknown>>(row.parsed.item ?? row.parsed.items);
    const items = itemRows.map((item, index) => {
      const mediaId = asString(item.media);
      const playlistId = asString(item.playlist);
      const durationSlotsRaw = asNumber(item.duration_slots);
      const durationSlots =
        typeof durationSlotsRaw === "number" && durationSlotsRaw > 0
          ? Math.floor(durationSlotsRaw)
          : null;
      return {
        index,
        ...(mediaId ? { mediaId } : {}),
        ...(playlistId ? { playlistId } : {}),
        ...(durationSlots !== null ? { durationSlots } : {}),
      };
    });
    const title = asString(row.parsed.title) ?? asString(row.parsed.name);
    const artist = asString(row.parsed.artist);
    const description = asString(row.parsed.description);
    playlistsById.set(id, {
      id,
      ...(title ? { title } : {}),
      ...(artist ? { artist } : {}),
      ...(description ? { description } : {}),
      items,
    });
  }

  for (const row of blockRows) {
    const id = asString(row.parsed.id) ?? path.basename(row.filePath, ".toml");
    const modeRaw = asString(row.parsed.mode);
    const mode =
      modeRaw === "loop" || modeRaw === "once" || modeRaw === "clocked"
        ? modeRaw
        : undefined;
    const itemRows = asArray<Record<string, unknown>>(row.parsed.item ?? row.parsed.items);
    const items = itemRows.map((item, index) => {
      const mediaId = asString(item.media);
      const playlistId = asString(item.playlist);
      const durationSlotsRaw = asNumber(item.duration_slots);
      const durationSlots =
        typeof durationSlotsRaw === "number" && durationSlotsRaw > 0
          ? Math.floor(durationSlotsRaw)
          : null;
      return {
        index,
        ...(mediaId ? { mediaId } : {}),
        ...(playlistId ? { playlistId } : {}),
        ...(durationSlots !== null ? { durationSlots } : {}),
      };
    });
    const playlistId = asString(row.parsed.playlist);
    blocksById.set(id, {
      id,
      ...(mode ? { mode } : {}),
      ...(playlistId ? { playlistId } : {}),
      items,
    });
  }

  for (const row of channelRows) {
    const id = asString(row.parsed.id) ?? path.basename(row.filePath, ".toml");
    const blockIds = Array.from(
      new Set([
        ...asStringArray(row.parsed.blocks),
        ...asArray<Record<string, unknown>>(row.parsed.block)
          .map((item) => asString(item.id))
          .filter((item): item is string => Boolean(item)),
      ])
    );
    const programRows = asArray<Record<string, unknown>>(row.parsed.program ?? row.parsed.programs);
    const programSources = programRows
      .map((program) =>
        isObject(program.source) ? asString(program.source.value) : undefined
      )
      .filter((source): source is string => Boolean(source));
    const embedUrl =
      isObject(row.parsed.embed) && asString(row.parsed.embed.url)
        ? asString(row.parsed.embed.url)
        : undefined;
    const number = asString(row.parsed.number);
    const name = asString(row.parsed.name) ?? asString(row.parsed.title);
    channelsById.set(id, {
      id,
      ...(number ? { number } : {}),
      ...(name ? { name } : {}),
      blockIds,
      programSources,
      ...(embedUrl ? { embedUrl } : {}),
    });
  }

  return { mediaById, playlistsById, blocksById, channelsById };
}

function collectLinkedResources(args: {
  catalog: Cable2ParsedCatalog;
  channelIds?: string[];
  slotDurationSec: number;
  guideBaseUrl: string | null;
}): BuildCable2ImportResult {
  const warnings: string[] = [];
  const selectedChannels = args.channelIds?.length
    ? args.channelIds
        .map((id) => args.catalog.channelsById.get(id))
        .filter((row): row is Cable2ChannelDef => Boolean(row))
    : Array.from(args.catalog.channelsById.values());

  for (const requested of args.channelIds ?? []) {
    if (!args.catalog.channelsById.has(requested)) {
      warnings.push(`missing_channel:${requested}`);
    }
  }

  const embedUrlBySource = new Map<string, string>();
  for (const channel of selectedChannels) {
    if (!channel.embedUrl) continue;
    for (const source of channel.programSources) {
      if (!source.startsWith("/")) continue;
      if (!embedUrlBySource.has(source)) {
        embedUrlBySource.set(source, channel.embedUrl);
      }
    }
  }

  const blockIds = new Set<string>();
  for (const channel of selectedChannels) {
    for (const blockId of channel.blockIds) blockIds.add(blockId);
  }

  const selectedBlocks: Cable2BlockDef[] = [];
  const playlistIds = new Set<string>();
  const mediaIds = new Set<string>();

  for (const blockId of blockIds) {
    const block = args.catalog.blocksById.get(blockId);
    if (!block) {
      warnings.push(`missing_block:${blockId}`);
      continue;
    }
    selectedBlocks.push(block);
    if (block.playlistId) playlistIds.add(block.playlistId);
    for (const item of block.items) {
      if (item.playlistId) playlistIds.add(item.playlistId);
      if (item.mediaId) mediaIds.add(item.mediaId);
    }
  }

  const selectedPlaylists = new Map<string, Cable2PlaylistDef>();
  const queue = [...playlistIds];
  while (queue.length > 0) {
    const playlistId = queue.shift();
    if (!playlistId || selectedPlaylists.has(playlistId)) continue;
    const playlist = args.catalog.playlistsById.get(playlistId);
    if (!playlist) {
      warnings.push(`missing_playlist:${playlistId}`);
      continue;
    }
    selectedPlaylists.set(playlistId, playlist);
    for (const item of playlist.items) {
      if (item.mediaId) mediaIds.add(item.mediaId);
      if (item.playlistId) queue.push(item.playlistId);
    }
  }

  const media: MediaResource[] = [];
  for (const mediaId of mediaIds) {
    const mediaDef = args.catalog.mediaById.get(mediaId);
    if (!mediaDef) {
      warnings.push(`missing_media:${mediaId}`);
      continue;
    }
    let sourceValue = repairMissingScheme(mediaDef.sourceValue);
    if (mediaDef.sourceType === "url") {
      sourceValue = embedUrlBySource.get(sourceValue) ?? sourceValue;
      sourceValue = toAbsoluteUrl(args.guideBaseUrl, sourceValue);
      sourceValue = rewriteLoopbackUrl(args.guideBaseUrl, sourceValue);
    }
    media.push({
      id: mediaDef.id,
      ...(mediaDef.title ? { title: mediaDef.title } : {}),
      ...(mediaDef.artist ? { artist: mediaDef.artist } : {}),
      ...(mediaDef.description ? { description: mediaDef.description } : {}),
      sourceType: mediaDef.sourceType,
      sourceValue,
      cache: mediaDef.cache,
    });
  }

  const playlists: PlaylistResource[] = Array.from(selectedPlaylists.values()).map((playlist) => ({
    id: playlist.id,
    ...(playlist.title ? { title: playlist.title } : {}),
    ...(playlist.artist ? { artist: playlist.artist } : {}),
    ...(playlist.description ? { description: playlist.description } : {}),
    items: playlist.items
      .map((item, index) => {
        const durationSec =
          typeof item.durationSlots === "number" && item.durationSlots > 0
            ? item.durationSlots * args.slotDurationSec
            : undefined;
        return {
          index,
          ...(item.mediaId ? { mediaId: item.mediaId } : {}),
          ...(item.playlistId ? { playlistId: item.playlistId } : {}),
          ...(durationSec ? { durationSec } : {}),
        };
      })
      .filter((item) => Boolean(item.mediaId || item.playlistId)),
  }));

  const blocks: BlockResource[] = selectedBlocks.map((block) => {
    const rawItems =
      block.items.length > 0
        ? block.items
        : block.playlistId
          ? [{ index: 0, playlistId: block.playlistId }]
          : [];
    return {
      id: block.id,
      ...(block.mode ? { mode: block.mode } : {}),
      items: rawItems
        .map((item, index) => {
          const durationSec =
            typeof item.durationSlots === "number" && item.durationSlots > 0
              ? item.durationSlots * args.slotDurationSec
              : undefined;
          return {
            index,
            ...(item.mediaId ? { mediaId: item.mediaId } : {}),
            ...(item.playlistId ? { playlistId: item.playlistId } : {}),
            ...(durationSec ? { durationSec } : {}),
          };
        })
        .filter((item) => Boolean(item.mediaId || item.playlistId)),
    };
  });

  const channels: ChannelResource[] = selectedChannels.map((channel) => ({
    id: channel.id,
    ...(channel.number ? { number: channel.number } : {}),
    ...(channel.name ? { name: channel.name } : {}),
    blockIds: channel.blockIds,
  }));

  const payload = ResourceImportPayloadSchema.parse({
    media,
    playlists,
    blocks,
    channels,
    profiles: [],
  });

  return { payload, warnings };
}

export async function buildCable2ChannelImportPayload(
  args: BuildCable2ImportArgs
): Promise<BuildCable2ImportResult> {
  const slotDurationSec =
    typeof args.slotDurationSec === "number" && args.slotDurationSec > 0
      ? Math.floor(args.slotDurationSec)
      : 15;
  const channelIds = (args.channelIds ?? [])
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  const catalog = await parseCable2Catalog(args.configRoot);
  return collectLinkedResources({
    catalog,
    ...(channelIds.length > 0 ? { channelIds } : {}),
    slotDurationSec,
    guideBaseUrl: normalizeGuideUrl(args.guideBaseUrl),
  });
}

export async function importCable2Channels(args: {
  db: Cable3Db;
  configRoot: string;
  channelIds?: string[];
  guideBaseUrl?: string;
  slotDurationSec?: number;
}): Promise<{
  counts: {
    media: number;
    playlists: number;
    blocks: number;
    channels: number;
    profiles: number;
  };
  warnings: string[];
}> {
  const built = await buildCable2ChannelImportPayload({
    configRoot: args.configRoot,
    ...(args.channelIds ? { channelIds: args.channelIds } : {}),
    ...(args.guideBaseUrl ? { guideBaseUrl: args.guideBaseUrl } : {}),
    ...(typeof args.slotDurationSec === "number"
      ? { slotDurationSec: args.slotDurationSec }
      : {}),
  });
  const counts = await importResources({
    db: args.db,
    payload: built.payload,
  });
  return { counts, warnings: built.warnings };
}
