import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdir } from "node:fs/promises";
import {
  ResourceImportPayloadSchema,
  type ResourceImportPayload,
} from "@chiba-cable3/contracts";
import type { Cable3Db } from "./db.js";
import { importCable2Channels } from "./cable2-channel-import.js";
import { getResourceSnapshot, importResources } from "./resource-store.js";

const SUPPORTED_MEDIA_EXTENSIONS = new Set([
  ".mp4",
  ".mov",
  ".m4v",
  ".webm",
  ".mkv",
  ".avi",
  ".mp3",
  ".wav",
  ".flac",
  ".aac",
  ".m4a",
  ".ogg",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".avif",
  ".tif",
  ".tiff",
]);

const IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".avif",
  ".tif",
  ".tiff",
]);

const DEFAULT_IMAGE_DURATION_SEC = 15;
const JENSEN_SLOT_DURATION_SEC = 30 * 60;
const HOME_ASSISTANT_SLOT_DURATION_SEC = 30 * 60;
const DEFAULT_HOME_ASSISTANT_URL =
  process.env.CHIBA3_HOME_ASSISTANT_URL?.trim() ||
  process.env.CHIBA_HOME_ASSISTANT_URL?.trim() ||
  "http://100.128.3.217:8123/";

const JENSEN_MEDIA = [
  {
    id: "m-jensen-multi-phase-field",
    title: "Multi Phase Field",
    artist: "Jensen Art",
    description: "Interactive web experiment",
    sourceType: "url" as const,
    sourceValue: "https://multi-phase-field--jensenabler.replit.app/",
    thumbnailUrl: svgPreviewDataUrl("Multi Phase Field", "Jensen Art"),
    cache: false,
  },
  {
    id: "m-jensen-spiral-evolve",
    title: "Spiral Evolve",
    artist: "Jensen Art",
    description: "Interactive web experiment",
    sourceType: "url" as const,
    sourceValue: "https://spiral-evolve--jensenabler.replit.app/",
    thumbnailUrl: svgPreviewDataUrl("Spiral Evolve", "Jensen Art"),
    cache: false,
  },
  {
    id: "m-jensen-squiggle-evolve",
    title: "Squiggle Evolve",
    artist: "Jensen Art",
    description: "Interactive web experiment",
    sourceType: "url" as const,
    sourceValue: "https://squiggle-evolve--jensenabler.replit.app/",
    thumbnailUrl: svgPreviewDataUrl("Squiggle Evolve", "Jensen Art"),
    cache: false,
  },
];

export const DEFAULT_CABLE2_CHANNEL_IDS = [
  "weatherstar",
  "ai-village",
  "roadmap",
  "mars-public-access",
] as const;

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleFromFileName(fileName: string): string {
  const parsed = path.parse(fileName);
  return parsed.name || fileName;
}

function isSupportedMediaFile(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return SUPPORTED_MEDIA_EXTENSIONS.has(ext);
}

function isImageFile(fileName: string): boolean {
  const ext = path.extname(fileName).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

function streamPreviewUrl(mediaId: string): string {
  return `/api/v1/resources/media/${encodeURIComponent(mediaId)}/stream`;
}

function svgPreviewDataUrl(title: string, subtitle: string): string {
  const safeTitle = title.trim() || "Web Content";
  const safeSubtitle = subtitle.trim() || "preview unavailable";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0a1f4a"/><stop offset="100%" stop-color="#112d68"/></linearGradient></defs><rect width="1280" height="720" rx="28" fill="url(#g)"/><rect x="46" y="46" width="1188" height="628" rx="22" fill="#051022" stroke="#2a5ea6" stroke-opacity=".55"/><text x="84" y="338" fill="#d9e8ff" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="68" font-weight="700">${safeTitle}</text><text x="84" y="400" fill="#8fb2e3" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="34">${safeSubtitle}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function inferUrlMediaThumbnail(args: {
  mediaId: string;
  title: string;
  sourceValue: string;
}): string {
  const source = args.sourceValue.toLowerCase();
  if (source.includes("weatherstar")) {
    return svgPreviewDataUrl("WeatherStar 4000+", "Guide channel");
  }
  if (source.includes("ai-village") || source.includes("aidigest")) {
    return svgPreviewDataUrl("AI Village", "Guide channel");
  }
  if (source.includes("roadmap")) {
    return svgPreviewDataUrl("Roadmap Channel", "Guide channel");
  }
  if (source.includes("mars-public-access") || source.includes("vdo.ninja")) {
    return svgPreviewDataUrl("Mars Public Access", "Guide channel");
  }
  if (source.includes("home-assistant") || source.includes(":8123")) {
    return svgPreviewDataUrl("Home Assistant", "Local control panel");
  }
  return svgPreviewDataUrl(args.title, args.mediaId);
}

async function listAssetFiles(assetsRoot: string): Promise<string[]> {
  const rows = await readdir(assetsRoot, { withFileTypes: true }).catch(() => []);
  return rows
    .filter((row) => row.isFile())
    .map((row) => row.name)
    .filter((name) => isSupportedMediaFile(name))
    .sort((a, b) => a.localeCompare(b));
}

export function resolveDefaultSeedPaths(): {
  cable3Root: string;
  assetsRoot: string;
  cable2ConfigRoot: string;
} {
  const sourceDir = path.dirname(fileURLToPath(import.meta.url));
  const cable3Root = path.resolve(sourceDir, "../../..");
  return {
    cable3Root,
    assetsRoot: path.join(cable3Root, "assets"),
    cable2ConfigRoot: path.resolve(cable3Root, "../cable2/config"),
  };
}

export async function buildLocalSeedPayload(args: {
  assetsRoot: string;
}): Promise<ResourceImportPayload> {
  const files = await listAssetFiles(args.assetsRoot);

  const localAssetMedia = files.map((fileName) => {
    const mediaId = `m-asset-${slugify(fileName)}`;
    return {
      id: mediaId,
      title: titleFromFileName(fileName),
      artist: "Chiba Cable",
      sourceType: "path" as const,
      sourceValue: path.resolve(args.assetsRoot, fileName),
      ...(isImageFile(fileName) ? { thumbnailUrl: streamPreviewUrl(mediaId) } : {}),
      cache: true,
    };
  });

  const localAssetPlaylistItems = localAssetMedia.map((media, index) => ({
    index,
    mediaId: media.id,
    ...(isImageFile(files[index] ?? "")
      ? { durationSec: DEFAULT_IMAGE_DURATION_SEC }
      : {}),
  }));

  const hasLocalAssets = localAssetMedia.length > 0;
  const localAssetPlaylist = hasLocalAssets
    ? [
        {
          id: "pl-local-assets",
          title: "Local Assets",
          artist: "Chiba Cable",
          description: "Seeded media from cable3/assets",
          items: localAssetPlaylistItems,
        },
      ]
    : [];
  const localAssetBlock = hasLocalAssets
    ? [
        {
          id: "blk-local-assets",
          title: "Local Assets Loop",
          mode: "loop" as const,
          items: [{ index: 0, playlistId: "pl-local-assets" }],
        },
      ]
    : [];
  const localAssetChannel = hasLocalAssets
    ? [
        {
          id: "local-assets",
          number: "001",
          name: "Local Assets",
          blockIds: ["blk-local-assets"],
        },
      ]
    : [];

  const jensenPlaylists = JENSEN_MEDIA.map((media, index) => ({
    id: `pl-jensen-${index + 1}`,
    title: media.title,
    artist: "Jensen Art",
    description: "Interactive web program",
    items: [
      {
        index: 0,
        mediaId: media.id,
        durationSec: JENSEN_SLOT_DURATION_SEC,
      },
    ],
  }));
  const jensenBlocks = JENSEN_MEDIA.map((media, index) => ({
    id: `blk-jensen-${index + 1}`,
    title: media.title,
    mode: "loop" as const,
    items: [
      {
        index: 0,
        playlistId: `pl-jensen-${index + 1}`,
      },
    ],
  }));
  const jensenChannel = {
    id: "jensen-art",
    number: "042",
    name: "Jensen Art",
    blockIds: jensenBlocks.map((row) => row.id),
  };

  const homeAssistantMedia = {
    id: "m-home-assistant",
    title: "Home Assistant",
    artist: "Mars College",
    description: "Local smart-home control panel",
    sourceType: "url" as const,
    sourceValue: "/home-assistant",
    thumbnailUrl: svgPreviewDataUrl("Home Assistant", "Local control panel"),
    cache: false,
  };
  const homeAssistantPlaylist = {
    id: "pl-home-assistant",
    title: "Home Assistant",
    artist: "Mars College",
    description: `Live dashboard: ${DEFAULT_HOME_ASSISTANT_URL}`,
    items: [
      {
        index: 0,
        mediaId: homeAssistantMedia.id,
        durationSec: HOME_ASSISTANT_SLOT_DURATION_SEC,
      },
    ],
  };
  const homeAssistantBlock = {
    id: "blk-home-assistant",
    title: "Home Assistant",
    mode: "loop" as const,
    items: [{ index: 0, playlistId: homeAssistantPlaylist.id }],
  };
  const homeAssistantChannel = {
    id: "home-assistant",
    number: "188",
    name: "Home Assistant",
    blockIds: [homeAssistantBlock.id],
  };

  return ResourceImportPayloadSchema.parse({
    media: [...localAssetMedia, ...JENSEN_MEDIA, homeAssistantMedia],
    playlists: [...localAssetPlaylist, ...jensenPlaylists, homeAssistantPlaylist],
    blocks: [...localAssetBlock, ...jensenBlocks, homeAssistantBlock],
    channels: [...localAssetChannel, jensenChannel, homeAssistantChannel],
    profiles: [],
  });
}

export async function seedLocalCatalog(args: {
  db: Cable3Db;
  assetsRoot: string;
  cable2ConfigRoot: string;
  guideBaseUrl?: string;
  slotDurationSec?: number;
  channelIds?: string[];
}): Promise<{
  localCounts: {
    media: number;
    playlists: number;
    blocks: number;
    channels: number;
    profiles: number;
  };
  cable2Counts: {
    media: number;
    playlists: number;
    blocks: number;
    channels: number;
    profiles: number;
  };
  cable2Warnings: string[];
  channels: string[];
}> {
  const payload = await buildLocalSeedPayload({
    assetsRoot: args.assetsRoot,
  });
  const localCounts = await importResources({
    db: args.db,
    payload,
  });

  const channelIds =
    args.channelIds && args.channelIds.length > 0
      ? args.channelIds
      : [...DEFAULT_CABLE2_CHANNEL_IDS];
  const imported = await importCable2Channels({
    db: args.db,
    configRoot: args.cable2ConfigRoot,
    channelIds,
    ...(args.guideBaseUrl ? { guideBaseUrl: args.guideBaseUrl } : {}),
    ...(typeof args.slotDurationSec === "number"
      ? { slotDurationSec: args.slotDurationSec }
      : {}),
  });

  const snapshot = await getResourceSnapshot({ db: args.db });
  const urlMediaPatches = snapshot.media
    .filter((row) => row.sourceType === "url" && !row.thumbnailUrl)
    .map((row) => ({
      id: row.id,
      ...(row.title ? { title: row.title } : {}),
      ...(row.artist ? { artist: row.artist } : {}),
      ...(row.description ? { description: row.description } : {}),
      sourceType: row.sourceType,
      sourceValue: row.sourceValue,
      thumbnailUrl: inferUrlMediaThumbnail({
        mediaId: row.id,
        title: row.title || row.id,
        sourceValue: row.sourceValue,
      }),
      cache: row.cache,
    }));
  if (urlMediaPatches.length > 0) {
    await importResources({
      db: args.db,
      payload: ResourceImportPayloadSchema.parse({
        media: urlMediaPatches,
        playlists: [],
        blocks: [],
        channels: [],
        profiles: [],
      }),
    });
  }

  return {
    localCounts,
    cable2Counts: imported.counts,
    cable2Warnings: imported.warnings,
    channels: channelIds,
  };
}
