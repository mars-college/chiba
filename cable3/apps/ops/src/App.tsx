import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import {
  Accordion,
  ActionIcon,
  Anchor,
  AppShell,
  Badge,
  Breadcrumbs,
  Burger,
  Button,
  Card,
  Checkbox,
  Code,
  Divider,
  Group,
  Image,
  JsonInput,
  Loader,
  Modal,
  NumberInput,
  Pagination,
  Paper,
  Progress,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconAdjustments,
  IconArrowLeft,
  IconBroadcast,
  IconChecklist,
  IconDeviceDesktopAnalytics,
  IconDownload,
  IconPhotoPlus,
  IconRefresh,
  IconSearch,
  IconPencil,
  IconGripVertical,
  IconSquareRoundedPlus,
  IconStack2,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react";
import {
  applyTarget,
  clearOpsNodeCache,
  createOpsNode,
  deleteOpsNode,
  downloadOpsNodesExport,
  fetchOpsNodeCache,
  fetchOpsNodeRuntimeStatus,
  fetchOpsNodes,
  fetchProfiles,
  openFleetStream,
  openGuide,
  updateOpsNode,
} from "./lib/api";
import {
  fetchResourceSnapshot,
  type Media,
  type MediaIngestJob,
  importResources,
  fetchIngestJobs,
  fetchIngestJob,
  startEdenIngestJob,
  startUploadIngestJob,
  startYouTubeIngestJob,
  deleteMedia,
  mediaStreamUrl,
  type ResourcePayload,
} from "./lib/controlApi";
import type {
  FleetPi,
  FleetPiHealth,
  OpsNodeRecord,
  OpsApplyResponse,
  OpsApplyTarget,
  OpsProfile,
} from "./types";
import type { OpsNodeCacheInspectResponse } from "@chiba-cable3/contracts";
import type { OpsNodeRuntimeStatusResponse } from "@chiba-cable3/contracts";
import { MediaPickerModal } from "./components/MediaPickerModal";
import {
  ResourcePickerModal,
  type ResourcePickerItem,
} from "./components/ResourcePickerModal";

type OptionBool = "inherit" | "on" | "off";
type OptionMode = "inherit" | "guide" | "gallery";
type OptionHud = "inherit" | "always" | "start" | "never";
type OptionRotate = "inherit" | "0" | "90" | "180" | "270";

type CatalogOption = { value: string; label: string };
type QuickSendTarget = {
  kind: "media" | "playlist";
  id: string;
  label: string;
};

type DraftMedia = {
  id: string;
  title: string;
  artist: string;
  sourceType: "path" | "url";
  sourceValue: string;
  thumbnailUrl?: string;
  thumbnailObjectKey?: string;
  cache: boolean;
};

type DraftPlaylist = {
  id: string;
  title: string;
  artist: string;
  description: string;
  mediaIds: string[];
};

type DraftBlock = {
  id: string;
  title: string;
  playlistIds: string[];
};

type DraftChannel = {
  id: string;
  title: string;
  blockIds: string[];
};

type DraftProfile = {
  id: string;
  title: string;
  defaultTargetKind: "media" | "playlist" | "block" | "channel";
  defaultTargetId: string;
};

type DraftStore = {
  media: DraftMedia[];
  playlists: DraftPlaylist[];
  blocks: DraftBlock[];
  channels: DraftChannel[];
  profiles: DraftProfile[];
};

type UploadPreviewItem = {
  file: File;
  kind: "image" | "video" | "audio" | "zip" | "file";
  url: string | null;
};

type BuilderMode =
  | "ingest"
  | "media"
  | "mediaDetail"
  | "playlistEditor"
  | "mediaTable"
  | "playlist"
  | "block"
  | "channel"
  | "profile";
type IngestSource = "youtube" | "eden" | "upload";

type NodeDraft = {
  registryId: string;
  nodeId: string;
  host: string;
  ip: string;
  nodeName: string;
  orientation: string;
  displayRotate: "" | "0" | "90" | "180" | "270";
  guidePort: number | undefined;
  nodePort: number | undefined;
  serverPort: number | undefined;
  apiKey: string;
};

const EMPTY_DRAFTS: DraftStore = {
  media: [],
  playlists: [],
  blocks: [],
  channels: [],
  profiles: [],
};

const EMPTY_PLAYLIST_DRAFT: DraftPlaylist = {
  id: "",
  title: "",
  artist: "",
  description: "",
  mediaIds: [],
};

const EMPTY_BLOCK_DRAFT: DraftBlock = {
  id: "",
  title: "",
  playlistIds: [],
};

const EMPTY_CHANNEL_DRAFT: DraftChannel = {
  id: "",
  title: "",
  blockIds: [],
};

const EMPTY_PROFILE_DRAFT: DraftProfile = {
  id: "",
  title: "",
  defaultTargetKind: "channel",
  defaultTargetId: "",
};

const DRAFT_STORAGE_KEY = "chiba-controller-drafts-v1";
const TABLE_PAGE_SIZE = {
  fleet: 25,
  media: 24,
  playlists: 16,
  blocks: 12,
  channels: 12,
  profiles: 12,
} as const;

function paginateRows<T>(rows: T[], page: number, pageSize: number): T[] {
  const safePage = Number.isFinite(page) && page > 0 ? page : 1;
  const start = (safePage - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

function tableRangeLabel(
  totalRows: number,
  page: number,
  pageSize: number
): string {
  if (totalRows === 0) return "0 of 0";
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(totalRows, start + pageSize - 1);
  return `${start}-${end} of ${totalRows}`;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toOptionBool(value: OptionBool): boolean | undefined {
  if (value === "inherit") return undefined;
  return value === "on";
}

function statusBadge(ok: boolean, labelOk: string, labelFail: string) {
  return ok ? (
    <Badge color="teal" variant="light">
      {labelOk}
    </Badge>
  ) : (
    <Badge color="red" variant="light">
      {labelFail}
    </Badge>
  );
}

function parseTargetFromKioskUrl(rawUrl: string | null | undefined): string {
  if (!rawUrl) return "—";
  try {
    const url = new URL(rawUrl);
    const targetKind =
      url.searchParams.get("targetKind") ||
      url.searchParams.get("target_kind") ||
      "";
    const targetId =
      url.searchParams.get("targetId") ||
      url.searchParams.get("target_id") ||
      "";
    const channel = url.searchParams.get("channel") || "";
    if (targetKind && targetId) return `${targetKind}:${targetId}`;
    if (channel) return `channel:${channel}`;
    return "guide/default";
  } catch {
    return "invalid-url";
  }
}

function isLikelyVideoSource(value: string): boolean {
  const raw = value.trim();
  if (!raw) return false;
  try {
    const pathname = new URL(raw).pathname || "";
    return /\.(mp4|mov|webm|m4v|ogg|ogv|mkv|avi|mpeg|mpg)$/i.test(pathname);
  } catch {
    return /\.(mp4|mov|webm|m4v|ogg|ogv|mkv|avi|mpeg|mpg)$/i.test(raw);
  }
}

function isVideoMedia(media: Media): boolean {
  return isLikelyVideoSource(media.sourceValue);
}

function mediaPreviewSource(media: Media): string | null {
  if (!isVideoMedia(media)) return null;
  if (media.sourceType === "url") return media.sourceValue;
  return mediaStreamUrl(media.id);
}

function playlistMediaIdsFromSnapshot(
  playlist: ResourcePayload["playlists"][number] | undefined | null
): string[] {
  if (!playlist) return [];
  return playlist.items
    .map((item) => (item.mediaId || "").trim())
    .filter((id) => id.length > 0);
}

function inferUploadPreviewKind(file: File): UploadPreviewItem["kind"] {
  const mime = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (
    name.endsWith(".zip") ||
    mime === "application/zip" ||
    mime === "application/x-zip-compressed"
  )
    return "zip";
  return "file";
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  const precision = size >= 10 || idx === 0 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[idx]}`;
}

function formatDurationSec(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return "—";
  const total = Math.floor(value);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function updateOpsUrl(
  patch: { view?: string | null; playlistId?: string | null },
  mode: "push" | "replace" = "push"
): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (patch.view) url.searchParams.set("view", patch.view);
  else url.searchParams.delete("view");
  if (patch.playlistId) url.searchParams.set("playlistId", patch.playlistId);
  else url.searchParams.delete("playlistId");
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (mode === "replace") window.history.replaceState(null, "", next);
  else window.history.pushState(null, "", next);
}

function readOpsViewFromUrl(): {
  view: string | null;
  playlistId: string | null;
} {
  if (typeof window === "undefined") return { view: null, playlistId: null };
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  const playlistId = params.get("playlistId");
  return { view, playlistId: playlistId?.trim() || null };
}

function toPendingFleetHealth(pi: FleetPi): FleetPiHealth {
  return {
    registryId: pi.registryId,
    id: pi.id,
    host: pi.host,
    ip: pi.ip,
    nodeName: pi.nodeName,
    resolvedIp: pi.ip ?? pi.host ?? null,
    dnsOk: Boolean(pi.host || pi.ip),
    ping: { ok: false, ms: null },
    tcp: {
      ssh22: { ok: false, ms: null },
      node8080: { ok: false, ms: null },
      cable8787: { ok: false, ms: null },
    },
    http: {
      nodeStatus: { ok: false, ms: null, status: null },
      cableVersion: { ok: false, ms: null, status: null },
    },
    chibaNode: {
      version: null,
      ipReported: pi.ip ?? null,
      kioskUrl: null,
    },
    cableServer: null,
    needsUpdate: null,
    lastCheckedAt: Date.now(),
    connectivity: {
      score: 0,
      total: 5,
      status: "offline",
      lastCheckedAt: Date.now(),
    },
    errorSummary: "pending_probe",
  };
}

function summarizeApplyResult(result: OpsApplyResponse): string {
  const total = result.results.length;
  const ok = result.results.filter((r) => r.ok).length;
  if (ok === total) return `Applied to ${ok}/${total}`;
  const firstError =
    result.results.find((r) => !r.ok)?.error || "unknown_error";
  return `Applied to ${ok}/${total}. Failures: ${
    total - ok
  }. First error: ${firstError}`;
}

function emptyNodeDraft(registryId = "local"): NodeDraft {
  return {
    registryId,
    nodeId: "",
    host: "",
    ip: "",
    nodeName: "",
    orientation: "",
    displayRotate: "",
    guidePort: undefined,
    nodePort: undefined,
    serverPort: undefined,
    apiKey: "",
  };
}

function nodeDraftFromRecord(record: {
  registryId?: string;
  id?: string;
  nodeId?: string;
  host?: string;
  ip?: string;
  nodeName?: string;
  orientation?: string;
  displayRotate?: 0 | 90 | 180 | 270;
  guidePort?: number;
  nodePort?: number;
  serverPort?: number;
  apiKey?: string;
}): NodeDraft {
  return {
    registryId: record.registryId || "local",
    nodeId: record.nodeId || record.id || "",
    host: record.host || "",
    ip: record.ip || "",
    nodeName: record.nodeName || "",
    orientation: record.orientation || "",
    displayRotate:
      typeof record.displayRotate === "number"
        ? (String(record.displayRotate) as "0" | "90" | "180" | "270")
        : "",
    guidePort:
      typeof record.guidePort === "number" ? record.guidePort : undefined,
    nodePort: typeof record.nodePort === "number" ? record.nodePort : undefined,
    serverPort:
      typeof record.serverPort === "number" ? record.serverPort : undefined,
    apiKey: record.apiKey || "",
  };
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function loadDraftStore(): DraftStore {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return EMPTY_DRAFTS;
    const parsed = JSON.parse(raw) as Partial<DraftStore>;
    return {
      media: Array.isArray(parsed.media) ? parsed.media : [],
      playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
      blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
      channels: Array.isArray(parsed.channels) ? parsed.channels : [],
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
    };
  } catch {
    return EMPTY_DRAFTS;
  }
}

function toResourcePayload(store: DraftStore): ResourcePayload {
  return {
    media: store.media.map((m) => ({
      id: m.id.trim(),
      title: m.title.trim() || undefined,
      artist: m.artist.trim() || undefined,
      sourceType: m.sourceType,
      sourceValue: m.sourceValue.trim(),
      thumbnailUrl: m.thumbnailUrl,
      thumbnailObjectKey: m.thumbnailObjectKey,
      cache: m.cache,
    })),
    playlists: store.playlists.map((p) => ({
      id: p.id.trim(),
      title: p.title.trim() || undefined,
      artist: p.artist.trim() || undefined,
      description: p.description.trim() || undefined,
      items: p.mediaIds.map((mediaId, index) => ({
        index,
        mediaId: mediaId.trim(),
      })),
    })),
    blocks: store.blocks.map((b) => ({
      id: b.id.trim(),
      title: b.title.trim() || undefined,
      mode: "loop",
      items: b.playlistIds.map((playlistId, index) => ({
        index,
        playlistId: playlistId.trim(),
      })),
    })),
    channels: store.channels.map((c) => ({
      id: c.id.trim(),
      name: c.title.trim() || undefined,
      blockIds: c.blockIds.map((blockId) => blockId.trim()),
    })),
    profiles: store.profiles.map((p) => ({
      id: p.id.trim(),
      title: p.title.trim() || undefined,
      defaults: {},
      defaultTarget:
        p.defaultTargetKind && p.defaultTargetId.trim()
          ? {
              kind: p.defaultTargetKind,
              id: p.defaultTargetId.trim(),
            }
          : undefined,
      nodes: [],
    })),
  };
}

function fromResourcePayload(payload: ResourcePayload): DraftStore {
  return {
    media: payload.media.map((m) => ({
      id: m.id,
      title: m.title || "",
      artist: m.artist || "",
      sourceType: m.sourceType,
      sourceValue: m.sourceValue,
      thumbnailUrl: m.thumbnailUrl,
      thumbnailObjectKey: m.thumbnailObjectKey,
      cache: m.cache,
    })),
    playlists: payload.playlists.map((p) => ({
      id: p.id,
      title: p.title || "",
      artist: p.artist || "",
      description: p.description || "",
      mediaIds: p.items
        .map((item) => item.mediaId || "")
        .filter((id) => id.length > 0),
    })),
    blocks: payload.blocks.map((b) => ({
      id: b.id,
      title: b.title || "",
      playlistIds: b.items
        .map((item) => item.playlistId || "")
        .filter((id) => id.length > 0),
    })),
    channels: payload.channels.map((c) => ({
      id: c.id,
      title: c.name || "",
      blockIds: c.blockIds,
    })),
    profiles: payload.profiles.map((p) => ({
      id: p.id,
      title: p.title || "",
      defaultTargetKind:
        p.defaultTarget?.kind === "media" ||
        p.defaultTarget?.kind === "playlist" ||
        p.defaultTarget?.kind === "block" ||
        p.defaultTarget?.kind === "channel"
          ? p.defaultTarget.kind
          : "channel",
      defaultTargetId: p.defaultTarget?.id || "",
    })),
  };
}

export default function App() {
  const isMobile = useMediaQuery("(max-width: 48em)");
  const [profiles, setProfiles] = useState<OpsProfile[]>([]);
  const [fleetMap, setFleetMap] = useState<Record<string, FleetPiHealth>>({});
  const [opsNodeMap, setOpsNodeMap] = useState<Record<string, OpsNodeRecord>>(
    {}
  );
  const [activeRegistryId, setActiveRegistryId] = useState("local");
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [nodeEditorOpen, setNodeEditorOpen] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [nodeDraft, setNodeDraft] = useState<NodeDraft>(() => emptyNodeDraft());
  const [nodeSaving, setNodeSaving] = useState(false);
  const [loadingFleet, setLoadingFleet] = useState(false);
  const [search, setSearch] = useState("");
  const [lastTick, setLastTick] = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [controlOpen, setControlOpen] = useState(true);
  const [fleetView, setFleetView] = useState<"table" | "workspace">("table");
  const [applyResult, setApplyResult] = useState<OpsApplyResponse | null>(null);
  const [draftStore, setDraftStore] = useState<DraftStore>(() =>
    loadDraftStore()
  );
  const [serverSnapshot, setServerSnapshot] = useState<ResourcePayload | null>(
    null
  );
  const [builderBusy, setBuilderBusy] = useState(false);
  const [mainTab, setMainTab] = useState<"fleet" | "builder">("fleet");
  const [builderTab, setBuilderTab] = useState<BuilderMode>("ingest");
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [targetPickerOpen, setTargetPickerOpen] = useState(false);
  const [quickSendOpen, setQuickSendOpen] = useState(false);
  const [quickSendTarget, setQuickSendTarget] =
    useState<QuickSendTarget | null>(null);
  const [quickSendNodeIds, setQuickSendNodeIds] = useState<string[]>([]);
  const [quickSendQuery, setQuickSendQuery] = useState("");
  const [quickSendBusy, setQuickSendBusy] = useState(false);
  const [playlistDragIndex, setPlaylistDragIndex] = useState<number | null>(
    null
  );
  const [playlistDropIndex, setPlaylistDropIndex] = useState<number | null>(
    null
  );
  const [fleetPage, setFleetPage] = useState(1);
  const [mediaTablePage, setMediaTablePage] = useState(1);
  const [playlistTablePage, setPlaylistTablePage] = useState(1);
  const [blockTablePage, setBlockTablePage] = useState(1);
  const [channelTablePage, setChannelTablePage] = useState(1);
  const [profileTablePage, setProfileTablePage] = useState(1);
  const [mediaDeleteBusy, setMediaDeleteBusy] = useState(false);
  const [serverMediaQuery, setServerMediaQuery] = useState("");
  const [serverMediaSourceFilter, setServerMediaSourceFilter] = useState<
    "all" | "path" | "url"
  >("all");
  const [selectedServerMediaId, setSelectedServerMediaId] = useState<
    string | null
  >(null);
  const [mediaDetailId, setMediaDetailId] = useState<string | null>(null);
  const [mediaFeedLimit, setMediaFeedLimit] = useState(24);
  const [mediaLibrarySection, setMediaLibrarySection] = useState<
    "media" | "playlists" | "blocks" | "channels" | "profiles"
  >("media");
  const [playlistLibraryView, setPlaylistLibraryView] = useState<
    "cards" | "table"
  >("cards");
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(
    null
  );
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
    null
  );
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
    null
  );
  const [nodeWorkspaceFocusId, setNodeWorkspaceFocusId] = useState("");
  const [nodeStash, setNodeStash] =
    useState<OpsNodeCacheInspectResponse | null>(null);
  const [nodeStashBusy, setNodeStashBusy] = useState(false);
  const [nodeStashClearing, setNodeStashClearing] = useState(false);
  const [nodeStashError, setNodeStashError] = useState<string | null>(null);
  const [nodeRuntimeStatus, setNodeRuntimeStatus] =
    useState<OpsNodeRuntimeStatusResponse | null>(null);
  const [nodeRuntimeBusy, setNodeRuntimeBusy] = useState(false);
  const [nodeRuntimeError, setNodeRuntimeError] = useState<string | null>(null);
  const assignSectionRef = useRef<HTMLDivElement | null>(null);
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestSource, setIngestSource] = useState<IngestSource>("youtube");
  const [ingestStep, setIngestStep] = useState<1 | 2 | 3>(1);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeTitle, setYoutubeTitle] = useState("");
  const [youtubeArtist, setYoutubeArtist] = useState("");
  const [edenInput, setEdenInput] = useState("");
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadArtist, setUploadArtist] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [uploadDropError, setUploadDropError] = useState<string | null>(null);
  const [ingestJobs, setIngestJobs] = useState<MediaIngestJob[]>([]);
  const ingestPollersRef = useRef<Record<string, number>>({});
  const ingestJobStatusRef = useRef<Record<string, MediaIngestJob["status"]>>(
    {}
  );
  const ingestWatchWarnedRef = useRef(false);

  const [applyKind, setApplyKind] = useState<OpsApplyTarget>("profile");
  const [applyId, setApplyId] = useState("");
  const [optMode, setOptMode] = useState<OptionMode>("inherit");
  const [optLock, setOptLock] = useState<OptionBool>("inherit");
  const [optQr, setOptQr] = useState<OptionBool>("inherit");
  const [optPlaylist, setOptPlaylist] = useState<OptionBool>("inherit");
  const [optNosplash, setOptNosplash] = useState<OptionBool>("inherit");
  const [optHud, setOptHud] = useState<OptionHud>("inherit");
  const [optHudSec, setOptHudSec] = useState<number | "">("");
  const [optTheme, setOptTheme] = useState("");
  const [optRotate, setOptRotate] = useState<OptionRotate>("inherit");

  const [playlistDraft, setPlaylistDraft] =
    useState<DraftPlaylist>(EMPTY_PLAYLIST_DRAFT);
  const [blockDraft, setBlockDraft] = useState<DraftBlock>(EMPTY_BLOCK_DRAFT);
  const [channelDraft, setChannelDraft] =
    useState<DraftChannel>(EMPTY_CHANNEL_DRAFT);
  const [profileDraft, setProfileDraft] =
    useState<DraftProfile>(EMPTY_PROFILE_DRAFT);

  useEffect(() => {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draftStore));
  }, [draftStore]);

  const refreshCatalogAndProfiles = useCallback(async () => {
    try {
      const profilesRes = await fetchProfiles();
      setProfiles(profilesRes.profiles ?? []);
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Catalog refresh failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const refreshServerSnapshot = useCallback(async () => {
    try {
      const result = await fetchResourceSnapshot();
      setServerSnapshot(result.snapshot);
    } catch (error) {
      notifications.show({
        color: "orange",
        title: "Server snapshot refresh warning",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const refreshNodesInventory = useCallback(async () => {
    try {
      const payload = await fetchOpsNodes();
      setActiveRegistryId(payload.registryId || "local");
      setOpsNodeMap(
        Object.fromEntries(payload.nodes.map((node) => [node.nodeId, node]))
      );
    } catch (error) {
      notifications.show({
        color: "orange",
        title: "Node inventory refresh warning",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const refreshFleet = useCallback(() => {
    setLoadingFleet(true);
    const stream = openFleetStream({
      onMeta: (meta) => {
        // Seed rows from registry immediately so the full list is visible
        // before health probes finish, and prune stale rows from prior registries.
        setFleetMap((prev) => {
          const next: Record<string, FleetPiHealth> = {};
          for (const pi of meta.pis) {
            const existing = prev[pi.id];
            if (existing) {
              next[pi.id] = {
                ...existing,
                registryId: pi.registryId,
                host: pi.host,
                ip: pi.ip,
                nodeName: pi.nodeName,
                resolvedIp: pi.ip ?? pi.host ?? existing.resolvedIp,
              };
            } else {
              next[pi.id] = toPendingFleetHealth(pi);
            }
          }
          return next;
        });
      },
      onPi: (pi) => {
        setFleetMap((prev) => ({ ...prev, [pi.id]: pi }));
      },
      onDone: () => {
        setLoadingFleet(false);
        setLastTick(Date.now());
      },
      onError: (msg) => {
        setLoadingFleet(false);
        notifications.show({
          color: "orange",
          title: "Fleet stream warning",
          message: msg,
        });
      },
    });
    return () => stream.close();
  }, []);

  useEffect(() => {
    refreshCatalogAndProfiles();
    refreshNodesInventory();
    refreshServerSnapshot();
  }, [refreshCatalogAndProfiles, refreshNodesInventory, refreshServerSnapshot]);

  useEffect(() => {
    const close = refreshFleet();
    return close;
  }, [refreshFleet]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = window.setInterval(() => refreshFleet(), 8000);
    return () => window.clearInterval(id);
  }, [autoRefresh, refreshFleet]);

  useEffect(() => {
    if (isMobile) setControlOpen(false);
  }, [isMobile]);

  const fleetRows = useMemo(() => {
    return Object.values(fleetMap)
      .map((row) => {
        const node = opsNodeMap[row.id];
        if (!node) return row;
        return {
          ...row,
          registryId: node.registryId,
          host: node.host || row.host,
          ip: node.ip || row.ip,
          nodeName: node.nodeName || row.nodeName,
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [fleetMap, opsNodeMap]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return fleetRows;
    return fleetRows.filter((row) => {
      const haystack = [row.id, row.nodeName, row.host, row.ip]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [fleetRows, search]);

  useEffect(() => {
    setSelectedNodeIds((prev) => prev.filter((id) => fleetMap[id]));
  }, [fleetMap]);

  useEffect(() => {
    if (selectedNodeIds.length === 0) {
      setNodeWorkspaceFocusId("");
      return;
    }
    if (
      !nodeWorkspaceFocusId ||
      !selectedNodeIds.includes(nodeWorkspaceFocusId)
    ) {
      setNodeWorkspaceFocusId(selectedNodeIds[0] || "");
    }
  }, [nodeWorkspaceFocusId, selectedNodeIds]);

  const selectedNode = useMemo(
    () => (activeNodeId ? fleetMap[activeNodeId] ?? null : null),
    [activeNodeId, fleetMap]
  );

  const metrics = useMemo(() => {
    const total = fleetRows.length;
    const online = fleetRows.filter(
      (r) => r.ping.ok && r.http.nodeStatus.ok
    ).length;
    const degraded = fleetRows.filter(
      (r) => !r.http.nodeStatus.ok || !r.http.cableVersion.ok
    ).length;
    const updating = fleetRows.filter((r) => r.needsUpdate === true).length;
    return { total, online, degraded, updating };
  }, [fleetRows]);

  const profileOptions = useMemo<CatalogOption[]>(() => {
    const byId = new Map<string, CatalogOption>();
    for (const row of serverSnapshot?.profiles ?? []) {
      byId.set(row.id, {
        value: row.id,
        label: [row.title, row.id].filter(Boolean).join(" • ") || row.id,
      });
    }
    for (const row of draftStore.profiles) {
      byId.set(row.id, {
        value: row.id,
        label: [row.title, row.id].filter(Boolean).join(" • ") || row.id,
      });
    }
    for (const row of profiles) {
      byId.set(row.id, {
        value: row.id,
        label: `${row.id} • ${row.file}`,
      });
    }
    return Array.from(byId.values()).sort((a, b) =>
      a.value.localeCompare(b.value)
    );
  }, [draftStore.profiles, profiles, serverSnapshot?.profiles]);

  const channelOptions = useMemo<CatalogOption[]>(() => {
    const byId = new Map<string, CatalogOption>();
    for (const row of serverSnapshot?.channels ?? []) {
      byId.set(row.id, {
        value: row.id,
        label: [row.number || "", row.name || "", row.id]
          .filter(Boolean)
          .join(" • "),
      });
    }
    for (const row of draftStore.channels) {
      byId.set(row.id, {
        value: row.id,
        label: [row.title, row.id].filter(Boolean).join(" • "),
      });
    }
    return Array.from(byId.values()).sort((a, b) =>
      a.value.localeCompare(b.value)
    );
  }, [draftStore.channels, serverSnapshot?.channels]);

  const blockOptions = useMemo<CatalogOption[]>(() => {
    const byId = new Map<string, CatalogOption>();
    for (const row of serverSnapshot?.blocks ?? []) {
      byId.set(row.id, {
        value: row.id,
        label: [row.title, row.id].filter(Boolean).join(" • "),
      });
    }
    for (const row of draftStore.blocks) {
      byId.set(row.id, {
        value: row.id,
        label: [row.title, row.id].filter(Boolean).join(" • "),
      });
    }
    return Array.from(byId.values()).sort((a, b) =>
      a.value.localeCompare(b.value)
    );
  }, [draftStore.blocks, serverSnapshot?.blocks]);

  const playlistOptions = useMemo<CatalogOption[]>(() => {
    const byId = new Map<string, CatalogOption>();
    for (const row of serverSnapshot?.playlists ?? []) {
      byId.set(row.id, {
        value: row.id,
        label: [row.title, row.artist, row.id].filter(Boolean).join(" • "),
      });
    }
    for (const row of draftStore.playlists) {
      byId.set(row.id, {
        value: row.id,
        label: [row.title, row.artist, row.id].filter(Boolean).join(" • "),
      });
    }
    return Array.from(byId.values()).sort((a, b) =>
      a.value.localeCompare(b.value)
    );
  }, [draftStore.playlists, serverSnapshot?.playlists]);

  const mediaOptions = useMemo<CatalogOption[]>(() => {
    const byId = new Map<string, CatalogOption>();
    for (const row of serverSnapshot?.media ?? []) {
      byId.set(row.id, {
        value: row.id,
        label: [row.title, row.artist, row.id].filter(Boolean).join(" • "),
      });
    }
    for (const row of draftStore.media) {
      byId.set(row.id, {
        value: row.id,
        label: [row.title, row.artist, row.id].filter(Boolean).join(" • "),
      });
    }
    return Array.from(byId.values()).sort((a, b) =>
      a.value.localeCompare(b.value)
    );
  }, [draftStore.media, serverSnapshot?.media]);

  const currentApplyOptions = useMemo<CatalogOption[]>(() => {
    if (applyKind === "profile") return profileOptions;
    if (applyKind === "channel") return channelOptions;
    if (applyKind === "block") return blockOptions;
    if (applyKind === "playlist") return playlistOptions;
    return mediaOptions;
  }, [
    applyKind,
    blockOptions,
    channelOptions,
    mediaOptions,
    playlistOptions,
    profileOptions,
  ]);

  const selectedNodeRows = useMemo(
    () =>
      selectedNodeIds
        .map((id) => fleetMap[id])
        .filter((row): row is FleetPiHealth => Boolean(row)),
    [fleetMap, selectedNodeIds]
  );

  const nodeWorkspaceFocus = useMemo(
    () =>
      nodeWorkspaceFocusId ? fleetMap[nodeWorkspaceFocusId] ?? null : null,
    [fleetMap, nodeWorkspaceFocusId]
  );

  const workspaceSingleNodeId = useMemo(() => {
    if (fleetView !== "workspace") return "";
    if (selectedNodeIds.length !== 1) return "";
    return nodeWorkspaceFocus?.id || "";
  }, [fleetView, nodeWorkspaceFocus?.id, selectedNodeIds.length]);

  const quickSendRows = useMemo(() => {
    const q = quickSendQuery.trim().toLowerCase();
    if (!q) return fleetRows;
    return fleetRows.filter((row) => {
      const haystack = [row.id, row.nodeName, row.host, row.ip]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [fleetRows, quickSendQuery]);

  const toggleNodeSelection = useCallback((id: string, checked: boolean) => {
    setSelectedNodeIds((prev) => {
      if (checked) return Array.from(new Set([...prev, id]));
      return prev.filter((x) => x !== id);
    });
  }, []);

  const selectVisible = useCallback(() => {
    setSelectedNodeIds(
      Array.from(
        new Set([...selectedNodeIds, ...filteredRows.map((r) => r.id)])
      )
    );
  }, [selectedNodeIds, filteredRows]);

  const clearSelection = useCallback(() => setSelectedNodeIds([]), []);

  const openNodeWorkspace = useCallback(() => {
    if (selectedNodeIds.length === 0) return;
    if (
      !nodeWorkspaceFocusId ||
      !selectedNodeIds.includes(nodeWorkspaceFocusId)
    ) {
      setNodeWorkspaceFocusId(selectedNodeIds[0] || "");
    }
    setFleetView("workspace");
  }, [nodeWorkspaceFocusId, selectedNodeIds]);

  const refreshNodeStash = useCallback(
    async (nodeId: string, silent = false) => {
      const id = nodeId.trim();
      if (!id) return;
      if (!silent) setNodeStashBusy(true);
      setNodeStashError(null);
      try {
        const result = await fetchOpsNodeCache(id);
        setNodeStash(result);
      } catch (error) {
        setNodeStash(null);
        setNodeStashError(
          error instanceof Error ? error.message : String(error)
        );
      } finally {
        if (!silent) setNodeStashBusy(false);
      }
    },
    []
  );

  const refreshNodeRuntime = useCallback(
    async (nodeId: string, silent = false) => {
      const id = nodeId.trim();
      if (!id) return;
      if (!silent) setNodeRuntimeBusy(true);
      setNodeRuntimeError(null);
      try {
        const result = await fetchOpsNodeRuntimeStatus(id);
        setNodeRuntimeStatus(result);
      } catch (error) {
        setNodeRuntimeStatus(null);
        setNodeRuntimeError(
          error instanceof Error ? error.message : String(error)
        );
      } finally {
        if (!silent) setNodeRuntimeBusy(false);
      }
    },
    []
  );

  const jumpToAssignPanel = useCallback(() => {
    assignSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }, []);

  const clearNodeStash = useCallback(async () => {
    const nodeId = workspaceSingleNodeId.trim();
    if (!nodeId) return;
    const ok = window.confirm(
      `Clear all cached media files on node "${nodeId}"?`
    );
    if (!ok) return;
    setNodeStashClearing(true);
    setNodeStashError(null);
    try {
      const result = await clearOpsNodeCache(nodeId);
      setNodeStash({
        ok: true,
        nodeId: result.nodeId,
        registryId: result.registryId,
        namespace: result.namespace,
        host: result.host,
        nodePort: result.nodePort,
        cache: result.after,
      });
      notifications.show({
        color: "teal",
        title: "Node stash cleared",
        message: `${result.deletedFiles} file(s) removed • ${formatBytes(
          result.deletedBytes
        )} reclaimed`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNodeStashError(message);
      notifications.show({
        color: "red",
        title: "Failed to clear node stash",
        message,
      });
    } finally {
      setNodeStashClearing(false);
    }
  }, [workspaceSingleNodeId]);

  useEffect(() => {
    if (!workspaceSingleNodeId) {
      setNodeStash(null);
      setNodeStashError(null);
      setNodeStashBusy(false);
      setNodeRuntimeStatus(null);
      setNodeRuntimeError(null);
      setNodeRuntimeBusy(false);
      return;
    }
    void refreshNodeStash(workspaceSingleNodeId);
    void refreshNodeRuntime(workspaceSingleNodeId);
  }, [lastTick, refreshNodeRuntime, refreshNodeStash, workspaceSingleNodeId]);

  useEffect(() => {
    if (!workspaceSingleNodeId) return;
    const id = window.setInterval(() => {
      void refreshNodeRuntime(workspaceSingleNodeId, true);
    }, 1200);
    return () => window.clearInterval(id);
  }, [refreshNodeRuntime, workspaceSingleNodeId]);

  const openCreateNodeEditor = useCallback(() => {
    setEditingNodeId(null);
    setNodeDraft(emptyNodeDraft(activeRegistryId));
    setNodeEditorOpen(true);
  }, [activeRegistryId]);

  const openEditNodeEditor = useCallback(
    (nodeId: string) => {
      const existing = opsNodeMap[nodeId] || fleetMap[nodeId];
      if (!existing) return;
      setEditingNodeId(nodeId);
      setNodeDraft(nodeDraftFromRecord(existing));
      setNodeEditorOpen(true);
    },
    [fleetMap, opsNodeMap]
  );

  const saveNodeDraft = useCallback(async () => {
    const nodeId = nodeDraft.nodeId.trim();
    if (!nodeId) {
      notifications.show({
        color: "red",
        title: "Node id required",
        message: "Provide a node id before saving.",
      });
      return;
    }
    const payload = {
      registryId: nodeDraft.registryId.trim() || activeRegistryId,
      nodeId,
      host: nodeDraft.host.trim() || undefined,
      ip: nodeDraft.ip.trim() || undefined,
      nodeName: nodeDraft.nodeName.trim() || undefined,
      orientation: nodeDraft.orientation.trim() || undefined,
      displayRotate:
        nodeDraft.displayRotate.length > 0
          ? (Number(nodeDraft.displayRotate) as 0 | 90 | 180 | 270)
          : undefined,
      guidePort:
        typeof nodeDraft.guidePort === "number" &&
        Number.isFinite(nodeDraft.guidePort)
          ? nodeDraft.guidePort
          : undefined,
      nodePort:
        typeof nodeDraft.nodePort === "number" &&
        Number.isFinite(nodeDraft.nodePort)
          ? nodeDraft.nodePort
          : undefined,
      serverPort:
        typeof nodeDraft.serverPort === "number" &&
        Number.isFinite(nodeDraft.serverPort)
          ? nodeDraft.serverPort
          : undefined,
      apiKey: nodeDraft.apiKey.trim() || undefined,
    };
    try {
      setNodeSaving(true);
      if (editingNodeId) {
        await updateOpsNode(editingNodeId, {
          registryId: payload.registryId,
          host: payload.host,
          ip: payload.ip,
          nodeName: payload.nodeName,
          orientation: payload.orientation,
          displayRotate: payload.displayRotate,
          guidePort: payload.guidePort,
          nodePort: payload.nodePort,
          serverPort: payload.serverPort,
          apiKey: payload.apiKey,
        });
      } else {
        await createOpsNode(payload);
      }
      notifications.show({
        color: "teal",
        title: editingNodeId ? "Node updated" : "Node created",
        message: nodeId,
      });
      setNodeEditorOpen(false);
      await refreshNodesInventory();
      refreshFleet();
    } catch (error) {
      notifications.show({
        color: "red",
        title: editingNodeId ? "Node update failed" : "Node create failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setNodeSaving(false);
    }
  }, [
    activeRegistryId,
    editingNodeId,
    nodeDraft,
    refreshFleet,
    refreshNodesInventory,
  ]);

  const removeNode = useCallback(
    async (nodeId: string) => {
      if (!window.confirm(`Delete node "${nodeId}" from registry inventory?`))
        return;
      try {
        await deleteOpsNode(nodeId);
        notifications.show({
          color: "teal",
          title: "Node deleted",
          message: nodeId,
        });
        if (activeNodeId === nodeId) setActiveNodeId(null);
        await refreshNodesInventory();
        refreshFleet();
      } catch (error) {
        notifications.show({
          color: "red",
          title: "Node delete failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [activeNodeId, refreshFleet, refreshNodesInventory]
  );

  const exportNodes = useCallback(async (format: "json" | "toml") => {
    try {
      const payload = await downloadOpsNodesExport(format);
      triggerDownload(payload.blob, payload.filename);
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Node export failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const applyTargetToNodes = useCallback(
    async (args: {
      target: OpsApplyTarget;
      id: string;
      nodeIds: string[];
      mode?: OptionMode;
      lock?: OptionBool;
      qr?: OptionBool;
      playlist?: OptionBool;
      nosplash?: OptionBool;
      hud?: OptionHud;
      hudSec?: number | "";
      theme?: string;
      rotate?: OptionRotate;
    }) => {
      return applyTarget({
        target: args.target,
        id: args.id.trim(),
        piIds: args.nodeIds,
        mode: args.mode === "inherit" ? undefined : args.mode,
        lock: toOptionBool(args.lock ?? "inherit"),
        showQr: toOptionBool(args.qr ?? "inherit"),
        playlist: toOptionBool(args.playlist ?? "inherit"),
        nosplash: toOptionBool(args.nosplash ?? "inherit"),
        hudMode: args.hud === "inherit" || !args.hud ? undefined : args.hud,
        hudShowSec:
          typeof args.hudSec === "number" && Number.isFinite(args.hudSec)
            ? args.hudSec
            : undefined,
        theme: args.theme?.trim() || undefined,
        displayRotate:
          args.rotate === "inherit" || !args.rotate
            ? undefined
            : (Number(args.rotate) as 0 | 90 | 180 | 270),
      });
    },
    []
  );

  const buildMediaLookup = useCallback((): Map<string, Media> => {
    const map = new Map<string, Media>();
    for (const media of serverSnapshot?.media ?? []) map.set(media.id, media);
    for (const media of draftStore.media) {
      map.set(media.id, {
        id: media.id,
        title: media.title || undefined,
        artist: media.artist || undefined,
        description: undefined,
        sourceType: media.sourceType,
        sourceValue: media.sourceValue,
        thumbnailUrl: media.thumbnailUrl,
        thumbnailObjectKey: media.thumbnailObjectKey,
        cache: media.cache,
      });
    }
    return map;
  }, [draftStore.media, serverSnapshot?.media]);

  const runApply = useCallback(async () => {
    if (!applyId.trim()) {
      notifications.show({
        color: "red",
        title: "Target required",
        message: "Choose a profile/channel/block/playlist/media target first.",
      });
      return;
    }
    if (selectedNodeIds.length === 0) {
      notifications.show({
        color: "red",
        title: "No nodes selected",
        message: "Select at least one node.",
      });
      return;
    }

    try {
      const targetId = applyId.trim();
      const mediaLookup = buildMediaLookup();
      if (applyKind === "media") {
        const media = mediaLookup.get(targetId);
        if (media) {
          await importResources({
            media: [
              {
                id: media.id,
                title: media.title,
                artist: media.artist,
                description: media.description,
                sourceType: media.sourceType,
                sourceValue: media.sourceValue,
                thumbnailUrl: media.thumbnailUrl,
                thumbnailObjectKey: media.thumbnailObjectKey,
                cache: media.cache,
              },
            ],
            playlists: [],
            blocks: [],
            channels: [],
            profiles: [],
          });
        }
      }
      if (applyKind === "playlist") {
        const playlist = draftStore.playlists.find(
          (row) => row.id === targetId
        );
        if (playlist) {
          const mediaRows = playlist.mediaIds
            .map((mediaId) => mediaLookup.get(mediaId))
            .filter((row): row is Media => Boolean(row))
            .map((media) => ({
              id: media.id,
              title: media.title,
              artist: media.artist,
              description: media.description,
              sourceType: media.sourceType,
              sourceValue: media.sourceValue,
              thumbnailUrl: media.thumbnailUrl,
              thumbnailObjectKey: media.thumbnailObjectKey,
              cache: media.cache,
            }));
          await importResources({
            media: mediaRows,
            playlists: [
              {
                id: playlist.id,
                title: playlist.title || undefined,
                artist: playlist.artist || undefined,
                description: playlist.description || undefined,
                items: playlist.mediaIds.map((mediaId, index) => ({
                  index,
                  mediaId,
                })),
              },
            ],
            blocks: [],
            channels: [],
            profiles: [],
          });
        }
      }
      const result = await applyTargetToNodes({
        target: applyKind,
        id: applyId,
        nodeIds: selectedNodeIds,
        mode: optMode,
        lock: optLock,
        qr: optQr,
        playlist: optPlaylist,
        nosplash: optNosplash,
        hud: optHud,
        hudSec: optHudSec,
        theme: optTheme,
        rotate: optRotate,
      });
      setApplyResult(result);
      notifications.show({
        color: result.ok ? "teal" : "orange",
        title: "Apply completed",
        message: summarizeApplyResult(result),
      });
      await refreshServerSnapshot();
      refreshFleet();
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Apply failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [
    applyId,
    applyKind,
    optHud,
    optHudSec,
    optLock,
    optMode,
    optNosplash,
    optPlaylist,
    optQr,
    optRotate,
    optTheme,
    applyTargetToNodes,
    buildMediaLookup,
    draftStore.playlists,
    refreshServerSnapshot,
    refreshFleet,
    selectedNodeIds,
  ]);

  const returnToGuide = useCallback(async () => {
    if (selectedNodeIds.length === 0) {
      notifications.show({
        color: "red",
        title: "No nodes selected",
        message: "Select at least one node.",
      });
      return;
    }
    try {
      const result = await openGuide({
        piIds: selectedNodeIds,
        nosplash: true,
      });
      notifications.show({
        color: result.ok ? "teal" : "orange",
        title: "Return to guide",
        message: summarizeApplyResult(result),
      });
      refreshFleet();
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Guide command failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [refreshFleet, selectedNodeIds]);

  const openQuickSend = useCallback(
    (target: QuickSendTarget) => {
      const defaults =
        selectedNodeIds.length > 0
          ? selectedNodeIds
          : nodeWorkspaceFocusId
          ? [nodeWorkspaceFocusId]
          : [];
      setQuickSendTarget(target);
      setQuickSendNodeIds(defaults);
      setQuickSendQuery("");
      setQuickSendOpen(true);
    },
    [nodeWorkspaceFocusId, selectedNodeIds]
  );

  const runQuickSend = useCallback(async () => {
    if (!quickSendTarget) return;
    if (quickSendNodeIds.length === 0) {
      notifications.show({
        color: "red",
        title: "No nodes selected",
        message: "Pick at least one node before sending.",
      });
      return;
    }
    try {
      setQuickSendBusy(true);
      const mediaLookup = buildMediaLookup();
      if (quickSendTarget.kind === "media") {
        const media = mediaLookup.get(quickSendTarget.id);
        if (media) {
          await importResources({
            media: [
              {
                id: media.id,
                title: media.title,
                artist: media.artist,
                description: media.description,
                sourceType: media.sourceType,
                sourceValue: media.sourceValue,
                thumbnailUrl: media.thumbnailUrl,
                thumbnailObjectKey: media.thumbnailObjectKey,
                cache: media.cache,
              },
            ],
            playlists: [],
            blocks: [],
            channels: [],
            profiles: [],
          });
        }
      }
      if (quickSendTarget.kind === "playlist") {
        const playlist = draftStore.playlists.find(
          (row) => row.id === quickSendTarget.id
        );
        if (playlist) {
          const mediaRows = playlist.mediaIds
            .map((mediaId) => mediaLookup.get(mediaId))
            .filter((row): row is Media => Boolean(row))
            .map((media) => ({
              id: media.id,
              title: media.title,
              artist: media.artist,
              description: media.description,
              sourceType: media.sourceType,
              sourceValue: media.sourceValue,
              thumbnailUrl: media.thumbnailUrl,
              thumbnailObjectKey: media.thumbnailObjectKey,
              cache: media.cache,
            }));
          await importResources({
            media: mediaRows,
            playlists: [
              {
                id: playlist.id,
                title: playlist.title || undefined,
                artist: playlist.artist || undefined,
                description: playlist.description || undefined,
                items: playlist.mediaIds.map((mediaId, index) => ({
                  index,
                  mediaId,
                })),
              },
            ],
            blocks: [],
            channels: [],
            profiles: [],
          });
        }
      }
      const result = await applyTargetToNodes({
        target: quickSendTarget.kind,
        id: quickSendTarget.id,
        nodeIds: quickSendNodeIds,
        mode: "gallery",
      });
      setApplyResult(result);
      notifications.show({
        color: result.ok ? "teal" : "orange",
        title: `Sent ${quickSendTarget.kind}`,
        message: summarizeApplyResult(result),
      });
      await refreshServerSnapshot();
      setQuickSendOpen(false);
      refreshFleet();
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Send to nodes failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setQuickSendBusy(false);
    }
  }, [
    applyTargetToNodes,
    buildMediaLookup,
    draftStore.playlists,
    quickSendNodeIds,
    quickSendTarget,
    refreshFleet,
    refreshServerSnapshot,
  ]);

  const exportDrafts = useCallback(() => {
    const blob = new Blob([JSON.stringify(draftStore, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chiba-controller-drafts-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [draftStore]);

  const pushDraftsToControlDb = useCallback(async () => {
    try {
      setBuilderBusy(true);
      const payload = toResourcePayload(draftStore);
      const result = await importResources(payload);
      notifications.show({
        color: "teal",
        title: "Drafts synced to control DB",
        message: `media:${result.counts.media} playlists:${result.counts.playlists} blocks:${result.counts.blocks} channels:${result.counts.channels} profiles:${result.counts.profiles}`,
      });
      await refreshServerSnapshot();
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Sync to control DB failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBuilderBusy(false);
    }
  }, [draftStore, refreshServerSnapshot]);

  const loadDraftsFromControlDb = useCallback(async () => {
    try {
      setBuilderBusy(true);
      const result = await fetchResourceSnapshot();
      setDraftStore(fromResourcePayload(result.snapshot));
      setServerSnapshot(result.snapshot);
      notifications.show({
        color: "teal",
        title: "Drafts loaded from control DB",
        message: "Builder is now showing persisted catalog resources.",
      });
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Load from control DB failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBuilderBusy(false);
    }
  }, []);

  const refreshDraftsAfterIngest = useCallback(async () => {
    const result = await fetchResourceSnapshot();
    setDraftStore(fromResourcePayload(result.snapshot));
    setServerSnapshot(result.snapshot);
  }, []);

  const upsertIngestJob = useCallback(
    (job: MediaIngestJob, options?: { notifyTransitions?: boolean }) => {
      const previousStatus = ingestJobStatusRef.current[job.id];
      ingestJobStatusRef.current[job.id] = job.status;
      setIngestJobs((prev) => {
        const without = prev.filter((row) => row.id !== job.id);
        return [job, ...without]
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 20);
      });
      if (!options?.notifyTransitions) return;
      if (previousStatus === job.status) return;
      if (job.status === "succeeded") {
        void refreshDraftsAfterIngest();
        notifications.show({
          color: "teal",
          title: "Ingest complete",
          message: `${job.kind} • ${job.id}`,
        });
        return;
      }
      if (job.status === "failed") {
        notifications.show({
          color: "red",
          title: "Ingest failed",
          message: `${job.kind} • ${job.id} • ${job.error || "unknown_error"}`,
        });
      }
    },
    [refreshDraftsAfterIngest]
  );

  const stopPollingJob = useCallback((jobId: string) => {
    const handle = ingestPollersRef.current[jobId];
    if (typeof handle === "number") {
      window.clearInterval(handle);
      delete ingestPollersRef.current[jobId];
    }
  }, []);

  const startPollingJob = useCallback(
    (jobId: string) => {
      if (typeof ingestPollersRef.current[jobId] === "number") return;
      const tick = async () => {
        try {
          const result = await fetchIngestJob(jobId);
          upsertIngestJob(result.job, { notifyTransitions: true });
          if (
            result.job.status === "succeeded" ||
            result.job.status === "failed"
          ) {
            stopPollingJob(jobId);
          }
        } catch (error) {
          stopPollingJob(jobId);
          notifications.show({
            color: "orange",
            title: "Ingest job poll failed",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      };
      void tick();
      ingestPollersRef.current[jobId] = window.setInterval(() => {
        void tick();
      }, 1200);
    },
    [stopPollingJob, upsertIngestJob]
  );

  const syncIngestJobs = useCallback(
    async (notifyTransitions: boolean) => {
      const result = await fetchIngestJobs(60);
      for (const job of result.jobs) {
        upsertIngestJob(job, { notifyTransitions });
        if (job.status === "queued" || job.status === "running") {
          startPollingJob(job.id);
        }
      }
    },
    [startPollingJob, upsertIngestJob]
  );

  useEffect(() => {
    let active = true;
    const tick = async (notifyTransitions: boolean) => {
      try {
        await syncIngestJobs(notifyTransitions);
        ingestWatchWarnedRef.current = false;
      } catch (error) {
        if (!active || ingestWatchWarnedRef.current) return;
        ingestWatchWarnedRef.current = true;
        notifications.show({
          color: "orange",
          title: "Ingest watcher warning",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };
    void tick(false);
    const handle = window.setInterval(() => {
      void tick(true);
    }, 2500);
    return () => {
      active = false;
      window.clearInterval(handle);
    };
  }, [syncIngestJobs]);

  const routeToMediaLibraryAfterQueue = useCallback(() => {
    setMainTab("builder");
    setBuilderTab("media");
    setMediaLibrarySection("media");
    setIngestStep(1);
    updateOpsUrl({ view: null, playlistId: null }, "replace");
    if (isMobile) setControlOpen(false);
  }, [isMobile]);

  useEffect(() => {
    return () => {
      for (const handle of Object.values(ingestPollersRef.current)) {
        window.clearInterval(handle);
      }
      ingestPollersRef.current = {};
    };
  }, []);

  const runYouTubeIngest = useCallback(async () => {
    if (!youtubeUrl.trim()) {
      notifications.show({
        color: "red",
        title: "YouTube URL required",
        message: "Paste a youtube.com or youtu.be URL first.",
      });
      return;
    }
    try {
      setIngestBusy(true);
      const result = await startYouTubeIngestJob({
        url: youtubeUrl.trim(),
        title: youtubeTitle.trim() || undefined,
        artist: youtubeArtist.trim() || undefined,
      });
      upsertIngestJob(result.job, { notifyTransitions: true });
      startPollingJob(result.job.id);
      notifications.show({
        color: "teal",
        title: "YouTube ingest queued",
        message: `job:${result.job.id}`,
      });
      routeToMediaLibraryAfterQueue();
    } catch (error) {
      notifications.show({
        color: "red",
        title: "YouTube ingest failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIngestBusy(false);
    }
  }, [
    routeToMediaLibraryAfterQueue,
    startPollingJob,
    upsertIngestJob,
    youtubeArtist,
    youtubeTitle,
    youtubeUrl,
  ]);

  const runEdenIngest = useCallback(async () => {
    if (!edenInput.trim()) {
      notifications.show({
        color: "red",
        title: "Eden input required",
        message: "Provide an Eden collection URL or collection ID.",
      });
      return;
    }
    try {
      setIngestBusy(true);
      const result = await startEdenIngestJob({
        input: edenInput.trim(),
      });
      upsertIngestJob(result.job, { notifyTransitions: true });
      startPollingJob(result.job.id);
      notifications.show({
        color: "teal",
        title: "Eden ingest queued",
        message: `job:${result.job.id}`,
      });
      routeToMediaLibraryAfterQueue();
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Eden ingest failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIngestBusy(false);
    }
  }, [
    edenInput,
    routeToMediaLibraryAfterQueue,
    startPollingJob,
    upsertIngestJob,
  ]);

  const runUploadIngest = useCallback(async () => {
    if (uploadFiles.length === 0) {
      notifications.show({
        color: "red",
        title: "No files selected",
        message: "Attach media files or one zip archive first.",
      });
      return;
    }
    try {
      setIngestBusy(true);
      const formData = new FormData();
      for (const file of uploadFiles) {
        const lower = file.name.toLowerCase();
        if (lower.endsWith(".zip")) formData.append("archive", file);
        else formData.append("files", file);
      }
      if (uploadArtist.trim()) formData.append("artist", uploadArtist.trim());
      if (uploadDescription.trim())
        formData.append("description", uploadDescription.trim());
      const result = await startUploadIngestJob(formData);
      upsertIngestJob(result.job, { notifyTransitions: true });
      startPollingJob(result.job.id);
      notifications.show({
        color: "teal",
        title: "Upload ingest queued",
        message: `job:${result.job.id}`,
      });
      setUploadFiles([]);
      setUploadArtist("");
      setUploadDescription("");
      setUploadDropError(null);
      routeToMediaLibraryAfterQueue();
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Upload ingest failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIngestBusy(false);
    }
  }, [
    routeToMediaLibraryAfterQueue,
    startPollingJob,
    upsertIngestJob,
    uploadArtist,
    uploadDescription,
    uploadFiles,
  ]);

  const serverMedia = useMemo(
    () => serverSnapshot?.media ?? [],
    [serverSnapshot]
  );

  const mergedMedia = useMemo<Media[]>(() => {
    const map = new Map<string, Media>();
    for (const media of serverMedia) map.set(media.id, media);
    for (const media of draftStore.media) {
      map.set(media.id, {
        id: media.id,
        title: media.title || undefined,
        artist: media.artist || undefined,
        description: undefined,
        sourceType: media.sourceType,
        sourceValue: media.sourceValue,
        thumbnailUrl: media.thumbnailUrl,
        thumbnailObjectKey: media.thumbnailObjectKey,
        cache: media.cache,
      });
    }
    return Array.from(map.values()).sort((a, b) => a.id.localeCompare(b.id));
  }, [draftStore.media, serverMedia]);

  const mergedMediaById = useMemo(() => {
    const map = new Map<string, Media>();
    for (const media of mergedMedia) map.set(media.id, media);
    return map;
  }, [mergedMedia]);

  const workspacePlaybackMedia = useMemo(() => {
    const mediaId = nodeRuntimeStatus?.status.playback?.mediaId?.trim();
    if (!mediaId) return null;
    return mergedMediaById.get(mediaId) || null;
  }, [mergedMediaById, nodeRuntimeStatus?.status.playback?.mediaId]);

  const mergedPlaylists = useMemo<
    Array<{
      id: string;
      title?: string;
      artist?: string;
      description?: string;
      mediaIds: string[];
    }>
  >(() => {
    const byId = new Map<
      string,
      {
        id: string;
        title?: string;
        artist?: string;
        description?: string;
        mediaIds: string[];
      }
    >();
    for (const row of serverSnapshot?.playlists ?? []) {
      byId.set(row.id, {
        id: row.id,
        title: row.title,
        artist: row.artist,
        description: row.description,
        mediaIds: playlistMediaIdsFromSnapshot(row),
      });
    }
    for (const row of draftStore.playlists) {
      byId.set(row.id, {
        id: row.id,
        title: row.title,
        artist: row.artist,
        description: row.description,
        mediaIds: [...row.mediaIds],
      });
    }
    return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
  }, [draftStore.playlists, serverSnapshot?.playlists]);

  const applyResourcePickerItems = useMemo<ResourcePickerItem[]>(() => {
    if (applyKind === "media") {
      return mergedMedia.map((row) => ({
        id: row.id,
        title: row.title || row.id,
        subtitle: row.artist || "unknown artist",
        description: row.id,
        thumbnailUrl: row.thumbnailUrl,
        previewUrl: mediaPreviewSource(row) || undefined,
        badge: isVideoMedia(row) ? "video" : "media",
        searchText: [
          row.id,
          row.title,
          row.artist,
          row.description,
          row.sourceValue,
        ]
          .filter(Boolean)
          .join(" "),
      }));
    }
    if (applyKind === "playlist") {
      return mergedPlaylists.map((row) => {
        const firstThumb = row.mediaIds
          .map((id) => mergedMediaById.get(id))
          .find((item) => Boolean(item?.thumbnailUrl));
        return {
          id: row.id,
          title: row.title || row.id,
          subtitle:
            row.artist ||
            `${row.mediaIds.length} item${
              row.mediaIds.length === 1 ? "" : "s"
            }`,
          description: row.id,
          thumbnailUrl: firstThumb?.thumbnailUrl,
          badge: "playlist",
          searchText: [row.id, row.title, row.artist, row.description]
            .filter(Boolean)
            .join(" "),
        };
      });
    }
    return [];
  }, [applyKind, mergedMedia, mergedMediaById, mergedPlaylists]);

  const applyTargetPreviewCard = useMemo(() => {
    const targetId = applyId.trim();
    if (!targetId) return null;

    if (applyKind === "media") {
      const media = mergedMedia.find((row) => row.id === targetId);
      if (!media) {
        return (
          <Paper withBorder p="sm">
            <Text size="xs" c="dimmed">
              Selected media not found in current catalog snapshot.
            </Text>
          </Paper>
        );
      }
      return (
        <Card withBorder p="sm" className="ops-media-card">
          <Stack gap={8}>
            {media.thumbnailUrl ? (
              <Image
                src={media.thumbnailUrl}
                alt={media.title || media.id}
                h={148}
                radius="sm"
                fit="cover"
              />
            ) : null}
            <Group justify="space-between" align="center" wrap="nowrap">
              <Text fw={700} lineClamp={1}>
                {media.title || media.id}
              </Text>
              <Badge variant="light">
                {isVideoMedia(media) ? "VIDEO" : "MEDIA"}
              </Badge>
            </Group>
            <Text size="sm" c="dimmed" lineClamp={1}>
              {media.artist || "unknown artist"}
            </Text>
            <Text size="xs" c="dimmed" ff="monospace" lineClamp={1}>
              {media.id}
            </Text>
          </Stack>
        </Card>
      );
    }

    if (applyKind === "playlist") {
      const draftPlaylist = draftStore.playlists.find(
        (row) => row.id === targetId
      );
      const serverPlaylist = serverSnapshot?.playlists.find(
        (row) => row.id === targetId
      );
      const mediaIds = draftPlaylist
        ? draftPlaylist.mediaIds
        : serverPlaylist?.items
            .map((item) => item.mediaId || "")
            .filter((id) => id.length > 0) ?? [];
      const coverMedia = mediaIds
        .map((id) => mergedMedia.find((row) => row.id === id))
        .filter((row): row is Media => Boolean(row))
        .slice(0, 4);
      return (
        <Paper withBorder p="sm">
          <Stack gap="sm">
            <Group justify="space-between" wrap="nowrap">
              <Text fw={700} lineClamp={1}>
                {draftPlaylist?.title || serverPlaylist?.title || targetId}
              </Text>
              <Badge variant="light">{mediaIds.length} items</Badge>
            </Group>
            {coverMedia.length > 0 ? (
              <SimpleGrid cols={{ base: 2, sm: 4 }} spacing={6}>
                {coverMedia.map((row) => (
                  <Image
                    key={`apply-preview-playlist-${targetId}-${row.id}`}
                    src={row.thumbnailUrl}
                    alt={row.title || row.id}
                    h={64}
                    radius="sm"
                    fit="cover"
                    fallbackSrc=""
                  />
                ))}
              </SimpleGrid>
            ) : (
              <Text size="xs" c="dimmed">
                No media previews available.
              </Text>
            )}
            <Text size="xs" c="dimmed" ff="monospace" lineClamp={1}>
              {targetId}
            </Text>
          </Stack>
        </Paper>
      );
    }

    if (applyKind === "block") {
      const draftBlock = draftStore.blocks.find((row) => row.id === targetId);
      const serverBlock = serverSnapshot?.blocks.find(
        (row) => row.id === targetId
      );
      const playlistIds = draftBlock
        ? draftBlock.playlistIds
        : serverBlock?.items
            .map((item) => item.playlistId || "")
            .filter((id) => id.length > 0) ?? [];
      return (
        <Paper withBorder p="sm">
          <Stack gap={6}>
            <Group justify="space-between">
              <Text fw={700}>
                {draftBlock?.title || serverBlock?.title || targetId}
              </Text>
              <Badge variant="light">{playlistIds.length} playlists</Badge>
            </Group>
            <Text size="xs" c="dimmed" ff="monospace">
              {targetId}
            </Text>
          </Stack>
        </Paper>
      );
    }

    if (applyKind === "channel") {
      const draftChannel = draftStore.channels.find(
        (row) => row.id === targetId
      );
      const serverChannel = serverSnapshot?.channels.find(
        (row) => row.id === targetId
      );
      const blockIds = draftChannel?.blockIds ?? serverChannel?.blockIds ?? [];
      return (
        <Paper withBorder p="sm">
          <Stack gap={6}>
            <Group justify="space-between">
              <Text fw={700}>
                {draftChannel?.title || serverChannel?.name || targetId}
              </Text>
              <Badge variant="light">{blockIds.length} blocks</Badge>
            </Group>
            <Text size="xs" c="dimmed" ff="monospace">
              {targetId}
            </Text>
          </Stack>
        </Paper>
      );
    }

    const draftProfile = draftStore.profiles.find((row) => row.id === targetId);
    const serverProfile = serverSnapshot?.profiles.find(
      (row) => row.id === targetId
    );
    const managedNodes = serverProfile?.nodes.length ?? 0;
    return (
      <Paper withBorder p="sm">
        <Stack gap={6}>
          <Group justify="space-between">
            <Text fw={700}>
              {draftProfile?.title || serverProfile?.title || targetId}
            </Text>
            <Badge variant="light">{managedNodes} nodes</Badge>
          </Group>
          <Text size="xs" c="dimmed" ff="monospace">
            {targetId}
          </Text>
        </Stack>
      </Paper>
    );
  }, [
    applyId,
    applyKind,
    draftStore.blocks,
    draftStore.channels,
    draftStore.playlists,
    draftStore.profiles,
    mergedMedia,
    serverSnapshot,
  ]);

  const serverMediaKinds = useMemo(
    () => ({
      path: serverMedia.filter((row) => row.sourceType === "path").length,
      url: serverMedia.filter((row) => row.sourceType === "url").length,
    }),
    [serverMedia]
  );

  const serverMediaFiltered = useMemo(() => {
    const q = serverMediaQuery.trim().toLowerCase();
    return serverMedia.filter((row) => {
      if (
        serverMediaSourceFilter !== "all" &&
        row.sourceType !== serverMediaSourceFilter
      )
        return false;
      if (!q) return true;
      return [row.id, row.title, row.artist, row.description, row.sourceValue]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [serverMedia, serverMediaQuery, serverMediaSourceFilter]);

  const mediaFeedItems = useMemo(
    () => serverMediaFiltered.slice(0, mediaFeedLimit),
    [mediaFeedLimit, serverMediaFiltered]
  );

  const hasMoreMediaFeed = useMemo(
    () => mediaFeedItems.length < serverMediaFiltered.length,
    [mediaFeedItems.length, serverMediaFiltered.length]
  );

  const selectedMediaDetail = useMemo(() => {
    if (!mediaDetailId) return null;
    return serverMedia.find((row) => row.id === mediaDetailId) ?? null;
  }, [mediaDetailId, serverMedia]);

  const selectedMediaDetailPreviewSrc = useMemo(
    () =>
      selectedMediaDetail ? mediaPreviewSource(selectedMediaDetail) : null,
    [selectedMediaDetail]
  );

  const deleteMediaItem = useCallback(
    async (mediaId: string) => {
      const ok = window.confirm(
        `Delete media "${mediaId}"? This also prunes references from playlists, blocks, channels, and profiles.`
      );
      if (!ok) return;
      try {
        setMediaDeleteBusy(true);
        const result = await deleteMedia(mediaId);
        if (!result.deleted) {
          throw new Error(`delete_media_failed:404:media_not_found:${mediaId}`);
        }
        if (selectedServerMediaId === mediaId) setSelectedServerMediaId(null);
        setMediaDetailId(null);
        setBuilderTab("media");
        await refreshDraftsAfterIngest();
        notifications.show({
          color: "teal",
          title: "Media deleted",
          message:
            `removed:${result.mediaId} ` +
            `playlistItems:${result.removedPlaylistItems} blockItems:${result.removedBlockItems} ` +
            `playlists:${result.removedPlaylists} blocks:${result.removedBlocks} ` +
            `channels:${result.removedChannels} profiles:${result.removedProfiles}`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await refreshDraftsAfterIngest().catch(() => {});
        notifications.show({
          color: "red",
          title: "Delete media failed",
          message,
        });
      } finally {
        setMediaDeleteBusy(false);
      }
    },
    [refreshDraftsAfterIngest, selectedServerMediaId]
  );

  const deletePlaylistDraft = useCallback(
    (playlistId: string) => {
      const ok = window.confirm(
        `Delete playlist "${playlistId}"? This removes it from local draft state.`
      );
      if (!ok) return;
      setDraftStore((store) => ({
        ...store,
        playlists: store.playlists.filter((item) => item.id !== playlistId),
      }));
      if (selectedPlaylistId === playlistId) setSelectedPlaylistId(null);
    },
    [selectedPlaylistId]
  );

  const mediaFilterData = useMemo(
    () => [
      { value: "all", label: `All (${serverMedia.length})` },
      { value: "path", label: `Path (${serverMediaKinds.path})` },
      { value: "url", label: `URL (${serverMediaKinds.url})` },
    ],
    [serverMedia.length, serverMediaKinds.path, serverMediaKinds.url]
  );

  const profileTargetOptions = useMemo(() => {
    const add = new Set<string>();
    if (profileDraft.defaultTargetKind === "media") {
      for (const row of mergedMedia) add.add(row.id);
    }
    if (profileDraft.defaultTargetKind === "playlist") {
      for (const row of draftStore.playlists) add.add(row.id);
      for (const row of serverSnapshot?.playlists ?? []) add.add(row.id);
    }
    if (profileDraft.defaultTargetKind === "block") {
      for (const row of draftStore.blocks) add.add(row.id);
      for (const row of serverSnapshot?.blocks ?? []) add.add(row.id);
    }
    if (profileDraft.defaultTargetKind === "channel") {
      for (const row of draftStore.channels) add.add(row.id);
      for (const row of serverSnapshot?.channels ?? []) add.add(row.id);
    }
    return Array.from(add)
      .sort((a, b) => a.localeCompare(b))
      .map((id) => ({ value: id, label: id }));
  }, [
    draftStore.blocks,
    draftStore.channels,
    draftStore.playlists,
    mergedMedia,
    profileDraft.defaultTargetKind,
    serverSnapshot?.blocks,
    serverSnapshot?.channels,
    serverSnapshot?.playlists,
  ]);

  const pickerMedia = useMemo<Media[]>(() => mergedMedia, [mergedMedia]);

  useEffect(() => {
    if (!selectedServerMediaId) {
      setSelectedServerMediaId(serverMediaFiltered[0]?.id || null);
      return;
    }
    if (!serverMediaFiltered.some((row) => row.id === selectedServerMediaId)) {
      setSelectedServerMediaId(serverMediaFiltered[0]?.id || null);
    }
  }, [selectedServerMediaId, serverMediaFiltered]);

  useEffect(() => {
    setMediaFeedLimit(24);
  }, [serverMediaQuery, serverMediaSourceFilter]);

  useEffect(() => {
    if (!mediaDetailId) return;
    if (!serverMedia.some((row) => row.id === mediaDetailId)) {
      setMediaDetailId(null);
    }
  }, [mediaDetailId, serverMedia]);

  const canQueueIngest = useMemo(() => {
    if (ingestSource === "youtube") return youtubeUrl.trim().length > 0;
    if (ingestSource === "eden") return edenInput.trim().length > 0;
    return uploadFiles.length > 0;
  }, [edenInput, ingestSource, uploadFiles.length, youtubeUrl]);

  const selectedIngestLabel = useMemo(() => {
    if (ingestSource === "youtube") return "YouTube (yt-dlp)";
    if (ingestSource === "eden") return "Eden Collection";
    return "Upload Files / Zip";
  }, [ingestSource]);

  const activeIngestJobs = useMemo(
    () =>
      ingestJobs.filter(
        (job) => job.status === "queued" || job.status === "running"
      ),
    [ingestJobs]
  );

  const runningIngestCount = useMemo(
    () => activeIngestJobs.filter((job) => job.status === "running").length,
    [activeIngestJobs]
  );

  const currentLibraryPane = useMemo<
    "media" | "playlists" | "blocks" | "channels" | "profiles"
  >(() => {
    if (builderTab === "block") return "blocks";
    if (builderTab === "channel") return "channels";
    if (builderTab === "profile") return "profiles";
    return mediaLibrarySection;
  }, [builderTab, mediaLibrarySection]);

  const fleetPageCount = useMemo(
    () => Math.max(1, Math.ceil(filteredRows.length / TABLE_PAGE_SIZE.fleet)),
    [filteredRows.length]
  );
  const mediaTablePageCount = useMemo(
    () => Math.max(1, Math.ceil(serverMedia.length / TABLE_PAGE_SIZE.media)),
    [serverMedia.length]
  );
  const playlistTablePageCount = useMemo(
    () =>
      Math.max(
        1,
        Math.ceil(draftStore.playlists.length / TABLE_PAGE_SIZE.playlists)
      ),
    [draftStore.playlists.length]
  );
  const blockTablePageCount = useMemo(
    () =>
      Math.max(1, Math.ceil(draftStore.blocks.length / TABLE_PAGE_SIZE.blocks)),
    [draftStore.blocks.length]
  );
  const channelTablePageCount = useMemo(
    () =>
      Math.max(
        1,
        Math.ceil(draftStore.channels.length / TABLE_PAGE_SIZE.channels)
      ),
    [draftStore.channels.length]
  );
  const profileTablePageCount = useMemo(
    () =>
      Math.max(
        1,
        Math.ceil(draftStore.profiles.length / TABLE_PAGE_SIZE.profiles)
      ),
    [draftStore.profiles.length]
  );

  useEffect(() => {
    setFleetPage((prev) => Math.min(prev, fleetPageCount));
  }, [fleetPageCount]);
  useEffect(() => {
    setMediaTablePage((prev) => Math.min(prev, mediaTablePageCount));
  }, [mediaTablePageCount]);
  useEffect(() => {
    setPlaylistTablePage((prev) => Math.min(prev, playlistTablePageCount));
  }, [playlistTablePageCount]);
  useEffect(() => {
    setBlockTablePage((prev) => Math.min(prev, blockTablePageCount));
  }, [blockTablePageCount]);
  useEffect(() => {
    setChannelTablePage((prev) => Math.min(prev, channelTablePageCount));
  }, [channelTablePageCount]);
  useEffect(() => {
    setProfileTablePage((prev) => Math.min(prev, profileTablePageCount));
  }, [profileTablePageCount]);

  const fleetRowsPage = useMemo(
    () => paginateRows(filteredRows, fleetPage, TABLE_PAGE_SIZE.fleet),
    [filteredRows, fleetPage]
  );
  const mediaTableRowsPage = useMemo(
    () => paginateRows(serverMedia, mediaTablePage, TABLE_PAGE_SIZE.media),
    [mediaTablePage, serverMedia]
  );
  const playlistRowsPage = useMemo(
    () =>
      paginateRows(
        draftStore.playlists,
        playlistTablePage,
        TABLE_PAGE_SIZE.playlists
      ),
    [draftStore.playlists, playlistTablePage]
  );
  const blockRowsPage = useMemo(
    () =>
      paginateRows(draftStore.blocks, blockTablePage, TABLE_PAGE_SIZE.blocks),
    [blockTablePage, draftStore.blocks]
  );
  const channelRowsPage = useMemo(
    () =>
      paginateRows(
        draftStore.channels,
        channelTablePage,
        TABLE_PAGE_SIZE.channels
      ),
    [channelTablePage, draftStore.channels]
  );
  const profileRowsPage = useMemo(
    () =>
      paginateRows(
        draftStore.profiles,
        profileTablePage,
        TABLE_PAGE_SIZE.profiles
      ),
    [draftStore.profiles, profileTablePage]
  );

  const onUploadDrop = useCallback((files: File[]) => {
    const zipFiles = files.filter((file) =>
      file.name.toLowerCase().endsWith(".zip")
    );
    const mediaFiles = files.filter(
      (file) => !file.name.toLowerCase().endsWith(".zip")
    );
    if (zipFiles.length > 1) {
      setUploadDropError("Only one zip archive is allowed.");
      return;
    }
    if (zipFiles.length === 1 && mediaFiles.length > 0) {
      setUploadDropError(
        "Upload either one zip archive or up to 20 media files, not both."
      );
      return;
    }
    if (mediaFiles.length > 20) {
      setUploadDropError("You can upload up to 20 media files at once.");
      return;
    }
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > 2 * 1024 * 1024 * 1024) {
      setUploadDropError("Uploads are limited to 2GB total.");
      return;
    }
    setUploadDropError(null);
    setUploadFiles(files);
  }, []);

  const removeUploadFileAtIndex = useCallback((index: number) => {
    setUploadFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const uploadPreviewItems = useMemo<UploadPreviewItem[]>(
    () =>
      uploadFiles.map((file) => {
        const kind = inferUploadPreviewKind(file);
        const url =
          kind === "image" || kind === "video" || kind === "audio"
            ? URL.createObjectURL(file)
            : null;
        return { file, kind, url };
      }),
    [uploadFiles]
  );

  useEffect(
    () => () => {
      for (const item of uploadPreviewItems) {
        if (item.url) URL.revokeObjectURL(item.url);
      }
    },
    [uploadPreviewItems]
  );

  const {
    getRootProps: getUploadRootProps,
    getInputProps: getUploadInputProps,
    isDragActive: isUploadDragActive,
  } = useDropzone({
    onDrop: onUploadDrop,
    multiple: true,
    maxSize: 2 * 1024 * 1024 * 1024,
    accept: {
      "video/*": [],
      "image/*": [],
      "audio/*": [],
      "application/zip": [".zip"],
      "application/x-zip-compressed": [".zip"],
    },
  });

  const loadPlaylistDraftById = useCallback(
    (playlistId: string): boolean => {
      const id = playlistId.trim();
      if (!id) return false;
      const row = draftStore.playlists.find((item) => item.id === id);
      if (!row) return false;
      setSelectedPlaylistId(id);
      setPlaylistDraft({
        id: row.id,
        title: row.title,
        artist: row.artist,
        description: row.description,
        mediaIds: [...row.mediaIds],
      });
      return true;
    },
    [draftStore.playlists]
  );

  const openPlaylistEditorRoute = useCallback(
    (playlistId?: string) => {
      const nextId = playlistId?.trim() || "";
      setMainTab("builder");
      setBuilderTab("playlistEditor");
      setMediaLibrarySection("playlists");
      if (nextId) {
        const loaded = loadPlaylistDraftById(nextId);
        if (!loaded) {
          setSelectedPlaylistId(null);
          setPlaylistDraft({
            ...EMPTY_PLAYLIST_DRAFT,
            id: nextId,
          });
        }
        updateOpsUrl({ view: "playlist-editor", playlistId: nextId });
      } else {
        setSelectedPlaylistId(null);
        setPlaylistDraft(EMPTY_PLAYLIST_DRAFT);
        updateOpsUrl({ view: "playlist-editor", playlistId: null });
      }
      if (isMobile) setControlOpen(false);
    },
    [isMobile, loadPlaylistDraftById]
  );

  const closePlaylistEditorRoute = useCallback(() => {
    setBuilderTab("media");
    setMediaLibrarySection("playlists");
    setPlaylistDragIndex(null);
    setPlaylistDropIndex(null);
    updateOpsUrl({ view: null, playlistId: null });
  }, []);

  const commitPlaylistDrop = useCallback(
    (targetIndex: number | null) => {
      if (playlistDragIndex === null || targetIndex === null) {
        setPlaylistDragIndex(null);
        setPlaylistDropIndex(null);
        return;
      }
      setPlaylistDraft((current) => {
        if (
          playlistDragIndex < 0 ||
          playlistDragIndex >= current.mediaIds.length
        )
          return current;
        const next = [...current.mediaIds];
        const [moved] = next.splice(playlistDragIndex, 1);
        if (!moved) return current;
        let insertionIndex = Math.max(0, Math.min(targetIndex, next.length));
        if (targetIndex > playlistDragIndex) {
          insertionIndex = Math.max(0, insertionIndex - 1);
        }
        if (insertionIndex === playlistDragIndex) return current;
        next.splice(insertionIndex, 0, moved);
        return { ...current, mediaIds: next };
      });
      setPlaylistDragIndex(null);
      setPlaylistDropIndex(null);
    },
    [playlistDragIndex]
  );

  useEffect(() => {
    const applyFromUrl = () => {
      const route = readOpsViewFromUrl();
      if (route.view === "playlist-editor") {
        setMainTab("builder");
        setBuilderTab("playlistEditor");
        setMediaLibrarySection("playlists");
        if (route.playlistId) {
          const loaded = loadPlaylistDraftById(route.playlistId);
          if (!loaded) {
            setSelectedPlaylistId(null);
            setPlaylistDraft({
              ...EMPTY_PLAYLIST_DRAFT,
              id: route.playlistId,
            });
          }
        } else {
          setSelectedPlaylistId(null);
          setPlaylistDraft(EMPTY_PLAYLIST_DRAFT);
        }
        return;
      }
      if (builderTab === "playlistEditor") {
        setBuilderTab("media");
        setMediaLibrarySection("playlists");
      }
    };
    applyFromUrl();
    window.addEventListener("popstate", applyFromUrl);
    return () => {
      window.removeEventListener("popstate", applyFromUrl);
    };
  }, [builderTab, loadPlaylistDraftById]);

  const openProfileEditor = useCallback(
    (profileId: string) => {
      const row = draftStore.profiles.find((item) => item.id === profileId);
      if (!row) return;
      setSelectedProfileId(profileId);
      setProfileDraft({ ...row });
    },
    [draftStore.profiles]
  );

  const openBlockEditor = useCallback(
    (blockId: string) => {
      const row = draftStore.blocks.find((item) => item.id === blockId);
      if (!row) return;
      setSelectedBlockId(blockId);
      setBlockDraft({
        id: row.id,
        title: row.title,
        playlistIds: [...row.playlistIds],
      });
    },
    [draftStore.blocks]
  );

  const openChannelEditor = useCallback(
    (channelId: string) => {
      const row = draftStore.channels.find((item) => item.id === channelId);
      if (!row) return;
      setSelectedChannelId(channelId);
      setChannelDraft({
        id: row.id,
        title: row.title,
        blockIds: [...row.blockIds],
      });
    },
    [draftStore.channels]
  );

  useEffect(() => {
    if (builderTab !== "playlist") return;
    if (
      selectedPlaylistId &&
      draftStore.playlists.some((row) => row.id === selectedPlaylistId)
    )
      return;
    const first = draftStore.playlists[0];
    if (!first) return;
    setSelectedPlaylistId(first.id);
    setPlaylistDraft({
      id: first.id,
      title: first.title,
      artist: first.artist,
      description: first.description,
      mediaIds: [...first.mediaIds],
    });
  }, [builderTab, draftStore.playlists, selectedPlaylistId]);

  useEffect(() => {
    if (builderTab !== "profile") return;
    if (
      selectedProfileId &&
      draftStore.profiles.some((row) => row.id === selectedProfileId)
    )
      return;
    const first = draftStore.profiles[0];
    if (first) openProfileEditor(first.id);
  }, [builderTab, draftStore.profiles, openProfileEditor, selectedProfileId]);

  useEffect(() => {
    if (builderTab !== "block") return;
    if (
      selectedBlockId &&
      draftStore.blocks.some((row) => row.id === selectedBlockId)
    )
      return;
    const first = draftStore.blocks[0];
    if (first) openBlockEditor(first.id);
  }, [builderTab, draftStore.blocks, openBlockEditor, selectedBlockId]);

  useEffect(() => {
    if (builderTab !== "channel") return;
    if (
      selectedChannelId &&
      draftStore.channels.some((row) => row.id === selectedChannelId)
    )
      return;
    const first = draftStore.channels[0];
    if (first) openChannelEditor(first.id);
  }, [builderTab, draftStore.channels, openChannelEditor, selectedChannelId]);

  return (
    <AppShell
      className="ops-shell"
      padding={isMobile ? "sm" : "md"}
      header={{ height: isMobile ? 64 : 72 }}
      navbar={{
        width: 280,
        breakpoint: "sm",
        collapsed: { mobile: !controlOpen, desktop: !controlOpen },
      }}
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm">
            <Burger
              opened={controlOpen}
              onClick={() => setControlOpen((v) => !v)}
              aria-label="Toggle navigation"
              size="sm"
            />
            <Title order={isMobile ? 4 : 3}>Chiba Controller</Title>
          </Group>
          <Group gap="xs" wrap="nowrap">
            {!isMobile ? (
              <Checkbox
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.currentTarget.checked)}
                label="Auto refresh"
              />
            ) : null}
            <Tooltip label="Refresh fleet + data">
              <ActionIcon
                size="lg"
                variant="filled"
                color="blue"
                onClick={() => {
                  refreshFleet();
                  void refreshNodesInventory();
                  void refreshCatalogAndProfiles();
                  void refreshServerSnapshot();
                }}
              >
                {loadingFleet ? (
                  <Loader size={16} color="white" />
                ) : (
                  <IconRefresh size={16} />
                )}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <ScrollArea h="100%" type="auto">
          <Stack gap="sm">
            <Text
              size="xs"
              c="dimmed"
              tt="uppercase"
              fw={700}
              className="ops-side-title"
            >
              Workspaces
            </Text>
            <Button
              className="ops-side-action"
              variant={mainTab === "fleet" ? "filled" : "light"}
              leftSection={<IconDeviceDesktopAnalytics size={16} />}
              onClick={() => {
                setMainTab("fleet");
                setFleetView("table");
                updateOpsUrl({ view: null, playlistId: null }, "replace");
                if (isMobile) setControlOpen(false);
              }}
            >
              Node Ops
            </Button>
            <Button
              className="ops-side-action"
              variant={
                mainTab === "builder" && builderTab === "ingest"
                  ? "filled"
                  : "light"
              }
              leftSection={<IconUpload size={16} />}
              onClick={() => {
                setMainTab("builder");
                setBuilderTab("ingest");
                updateOpsUrl({ view: null, playlistId: null }, "replace");
                if (isMobile) setControlOpen(false);
              }}
            >
              Source Ingestion
            </Button>
            <Button
              className="ops-side-action"
              variant={
                mainTab === "builder" &&
                (builderTab === "media" ||
                  builderTab === "mediaDetail" ||
                  builderTab === "playlistEditor" ||
                  builderTab === "block" ||
                  builderTab === "channel" ||
                  builderTab === "profile")
                  ? "filled"
                  : "light"
              }
              leftSection={<IconPhotoPlus size={16} />}
              onClick={() => {
                setMainTab("builder");
                setBuilderTab("media");
                setMediaLibrarySection("media");
                updateOpsUrl({ view: null, playlistId: null }, "replace");
                if (isMobile) setControlOpen(false);
              }}
            >
              Media Library
            </Button>
            <Divider />
            <Card withBorder radius="md" p="sm">
              <Text size="xs" c="dimmed">
                Selected nodes
              </Text>
              <Title order={2}>{selectedNodeIds.length}</Title>
              <Text size="xs" c="dimmed">
                of {filteredRows.length} visible
              </Text>
            </Card>
            <SimpleGrid cols={2} spacing="xs">
              <Card withBorder p="xs">
                <Text size="xs" c="dimmed">
                  Online
                </Text>
                <Text fw={700}>{metrics.online}</Text>
              </Card>
              <Card withBorder p="xs">
                <Text size="xs" c="dimmed">
                  Degraded
                </Text>
                <Text fw={700}>{metrics.degraded}</Text>
              </Card>
              <Card withBorder p="xs">
                <Text size="xs" c="dimmed">
                  Updating
                </Text>
                <Text fw={700}>{metrics.updating}</Text>
              </Card>
              <Card withBorder p="xs">
                <Text size="xs" c="dimmed">
                  Total
                </Text>
                <Text fw={700}>{metrics.total}</Text>
              </Card>
            </SimpleGrid>
            <Button
              leftSection={<IconPencil size={16} />}
              color="blue"
              variant="light"
              onClick={() => {
                openNodeWorkspace();
                if (isMobile) setControlOpen(false);
              }}
              disabled={selectedNodeIds.length === 0}
            >
              {`Edit ${selectedNodeIds.length} ${
                selectedNodeIds.length === 1 ? "node" : "nodes"
              }`}
            </Button>
            <Text size="xs" c="dimmed">
              Last tick:{" "}
              {lastTick
                ? `${Math.round((Date.now() - lastTick) / 1000)}s ago`
                : "—"}
            </Text>
          </Stack>
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Main className="ops-main">
        <Tabs
          className="ops-main-tabs"
          value={mainTab}
          onChange={(value) => {
            if (value === "fleet" || value === "builder") setMainTab(value);
          }}
          keepMounted={false}
        >
          <Tabs.Panel value="fleet" pt="md">
            {fleetView === "workspace" ? (
              <Paper withBorder radius="md" p="md">
                <Stack gap="md">
                  <Group justify="space-between" align="center" wrap="wrap">
                    <Stack gap={4}>
                      <Button
                        variant="light"
                        leftSection={<IconArrowLeft size={14} />}
                        onClick={() => setFleetView("table")}
                      >
                        Back to node list
                      </Button>
                      <Breadcrumbs separator="›">
                        <Anchor
                          size="sm"
                          c="dimmed"
                          onClick={(event) => {
                            event.preventDefault();
                            setFleetView("table");
                          }}
                          href="#"
                        >
                          Node Ops
                        </Anchor>
                        <Text size="sm">Node Workspace</Text>
                        {selectedNodeIds.length === 1 && nodeWorkspaceFocus ? (
                          <Text size="sm" fw={600}>
                            {nodeWorkspaceFocus.id}
                          </Text>
                        ) : null}
                      </Breadcrumbs>
                      <Title order={4}>Node Workspace</Title>
                    </Stack>
                    <Badge variant="light">
                      {selectedNodeIds.length} selected
                    </Badge>
                  </Group>

                  {selectedNodeIds.length === 0 ? (
                    <Card withBorder p="md">
                      <Stack gap="xs">
                        <Text fw={700}>No nodes selected</Text>
                        <Text size="sm" c="dimmed">
                          Select one or more nodes from Node Ops to edit details
                          or apply state.
                        </Text>
                        <Group>
                          <Button
                            variant="light"
                            onClick={() => setFleetView("table")}
                          >
                            Open node list
                          </Button>
                        </Group>
                      </Stack>
                    </Card>
                  ) : (
                    <Stack gap="md">
                      <Card withBorder p="md">
                        <Stack gap="md">
                          {selectedNodeIds.length === 1 &&
                          nodeWorkspaceFocus ? (
                            <>
                              <Group justify="space-between" align="flex-start">
                                <div>
                                  <Text fw={700}>{nodeWorkspaceFocus.id}</Text>
                                  <Text size="sm" c="dimmed">
                                    {nodeWorkspaceFocus.nodeName ||
                                      "Unnamed node"}
                                  </Text>
                                </div>
                                <Badge variant="light">
                                  {nodeWorkspaceFocus.registryId ||
                                    activeRegistryId}
                                </Badge>
                              </Group>
                              <Text size="xs" ff="monospace">
                                {nodeWorkspaceFocus.host || "—"}{" "}
                                {nodeWorkspaceFocus.ip
                                  ? `• ${nodeWorkspaceFocus.ip}`
                                  : ""}
                              </Text>
                              <Group gap={6}>
                                {statusBadge(
                                  nodeWorkspaceFocus.dnsOk,
                                  "DNS",
                                  "DNS"
                                )}
                                {statusBadge(
                                  nodeWorkspaceFocus.tcp.ssh22.ok,
                                  "SSH",
                                  "SSH"
                                )}
                                {statusBadge(
                                  nodeWorkspaceFocus.http.nodeStatus.ok,
                                  "Node",
                                  "Node"
                                )}
                                {statusBadge(
                                  nodeWorkspaceFocus.http.cableVersion.ok,
                                  "Cable",
                                  "Cable"
                                )}
                              </Group>
                              <Stack gap="xs">
                                <Button
                                  leftSection={<IconPencil size={14} />}
                                  onClick={() =>
                                    openEditNodeEditor(nodeWorkspaceFocus.id)
                                  }
                                >
                                  Edit Node Details
                                </Button>
                                <Button
                                  variant="light"
                                  color="teal"
                                  leftSection={<IconAdjustments size={14} />}
                                  onClick={jumpToAssignPanel}
                                >
                                  Assign Media/Container
                                </Button>
                                <Button
                                  variant="light"
                                  leftSection={<IconBroadcast size={14} />}
                                  onClick={() =>
                                    setActiveNodeId(nodeWorkspaceFocus.id)
                                  }
                                >
                                  Inspect Runtime
                                </Button>
                                <Button
                                  variant="light"
                                  color="orange"
                                  leftSection={<IconChecklist size={14} />}
                                  onClick={() => void returnToGuide()}
                                >
                                  Return Node to Guide
                                </Button>
                              </Stack>
                              <Paper withBorder p="sm" radius="md">
                                <Stack gap="xs">
                                  <Group
                                    justify="space-between"
                                    align="center"
                                    wrap="wrap"
                                  >
                                    <Text fw={700}>Now Playing</Text>
                                    <Button
                                      size="xs"
                                      variant="light"
                                      leftSection={<IconRefresh size={14} />}
                                      loading={nodeRuntimeBusy}
                                      onClick={() =>
                                        void refreshNodeRuntime(
                                          nodeWorkspaceFocus.id
                                        )
                                      }
                                    >
                                      Refresh
                                    </Button>
                                  </Group>
                                  {nodeRuntimeError ? (
                                    <Text size="sm" c="red">
                                      {nodeRuntimeError}
                                    </Text>
                                  ) : null}
                                  {nodeRuntimeBusy ? (
                                    <Group gap={8}>
                                      <Loader size={14} />
                                      <Text size="sm" c="dimmed">
                                        Loading runtime playback...
                                      </Text>
                                    </Group>
                                  ) : nodeRuntimeStatus ? (
                                    <SimpleGrid
                                      cols={{ base: 1, sm: 2 }}
                                      spacing="sm"
                                    >
                                      <Card withBorder p="xs">
                                        {workspacePlaybackMedia?.thumbnailUrl ? (
                                          <Image
                                            src={
                                              workspacePlaybackMedia.thumbnailUrl
                                            }
                                            alt={
                                              workspacePlaybackMedia.title ||
                                              workspacePlaybackMedia.id
                                            }
                                            radius="sm"
                                            h={140}
                                            fit="cover"
                                          />
                                        ) : workspacePlaybackMedia &&
                                          isVideoMedia(
                                            workspacePlaybackMedia
                                          ) &&
                                          mediaPreviewSource(
                                            workspacePlaybackMedia
                                          ) ? (
                                          <video
                                            key={`workspace-video-preview-${workspacePlaybackMedia.id}`}
                                            src={
                                              mediaPreviewSource(
                                                workspacePlaybackMedia
                                              ) || undefined
                                            }
                                            muted
                                            playsInline
                                            autoPlay
                                            loop
                                            style={{
                                              width: "100%",
                                              height: 140,
                                              borderRadius: 8,
                                              objectFit: "cover",
                                              background: "#000",
                                            }}
                                          />
                                        ) : (
                                          <Card withBorder p="sm">
                                            <Text size="sm" c="dimmed">
                                              No preview available
                                            </Text>
                                          </Card>
                                        )}
                                      </Card>
                                      <Stack gap={6}>
                                        <Group gap={8} wrap="wrap">
                                          <Badge variant="light">
                                            {nodeRuntimeStatus.status.backend}
                                          </Badge>
                                          <Badge variant="light">
                                            {nodeRuntimeStatus.status.playback
                                              ?.state || "unknown"}
                                          </Badge>
                                        </Group>
                                        <Text fw={700}>
                                          {nodeRuntimeStatus.status.playback
                                            ?.title ||
                                            workspacePlaybackMedia?.title ||
                                            nodeRuntimeStatus.status.playback
                                              ?.mediaId ||
                                            nodeRuntimeStatus.status
                                              .currentItemId ||
                                            "No active media"}
                                        </Text>
                                        <Text size="sm" c="dimmed">
                                          {nodeRuntimeStatus.status.playback
                                            ?.artist ||
                                            workspacePlaybackMedia?.artist ||
                                            "unknown artist"}
                                        </Text>
                                        {typeof nodeRuntimeStatus.status
                                          .playback?.progressPercent ===
                                        "number" ? (
                                          <>
                                            <Progress
                                              value={Math.max(
                                                0,
                                                Math.min(
                                                  100,
                                                  nodeRuntimeStatus.status
                                                    .playback.progressPercent
                                                )
                                              )}
                                            />
                                            <Text size="xs" c="dimmed">
                                              {formatDurationSec(
                                                nodeRuntimeStatus.status
                                                  .playback.positionSec ?? null
                                              )}{" "}
                                              /{" "}
                                              {formatDurationSec(
                                                nodeRuntimeStatus.status
                                                  .playback.durationSec ?? null
                                              )}
                                            </Text>
                                          </>
                                        ) : (
                                          <Text size="xs" c="dimmed">
                                            Playback progress unavailable for
                                            this target.
                                          </Text>
                                        )}
                                      </Stack>
                                    </SimpleGrid>
                                  ) : (
                                    <Text size="sm" c="dimmed">
                                      No runtime playback data loaded yet.
                                    </Text>
                                  )}
                                </Stack>
                              </Paper>
                              <Paper withBorder p="sm" radius="md">
                                <Stack gap="xs">
                                  <Group
                                    justify="space-between"
                                    align="center"
                                    wrap="wrap"
                                  >
                                    <Text fw={700}>Media Stash</Text>
                                    <Group gap={8}>
                                      <Button
                                        size="xs"
                                        variant="light"
                                        leftSection={<IconRefresh size={14} />}
                                        loading={nodeStashBusy}
                                        onClick={() =>
                                          void refreshNodeStash(
                                            nodeWorkspaceFocus.id
                                          )
                                        }
                                      >
                                        Refresh
                                      </Button>
                                      <Button
                                        size="xs"
                                        color="red"
                                        variant="light"
                                        leftSection={<IconTrash size={14} />}
                                        loading={nodeStashClearing}
                                        disabled={
                                          !nodeStash ||
                                          nodeStash.cache.fileCount === 0
                                        }
                                        onClick={() => void clearNodeStash()}
                                      >
                                        Clear Stash
                                      </Button>
                                    </Group>
                                  </Group>
                                  <Text size="xs" c="dimmed">
                                    Node-local cache for media marked with cache
                                    enabled.
                                  </Text>
                                  {nodeStashError ? (
                                    <Text size="sm" c="red">
                                      {nodeStashError}
                                    </Text>
                                  ) : null}
                                  {nodeStashBusy ? (
                                    <Group gap={8}>
                                      <Loader size={14} />
                                      <Text size="sm" c="dimmed">
                                        Loading stash contents...
                                      </Text>
                                    </Group>
                                  ) : nodeStash ? (
                                    <>
                                      <Group gap="xs">
                                        <Badge variant="light">
                                          {nodeStash.cache.fileCount} files
                                        </Badge>
                                        <Badge variant="light">
                                          {formatBytes(nodeStash.cache.bytes)}
                                        </Badge>
                                      </Group>
                                      {nodeStash.cache.files.length > 0 ? (
                                        <ScrollArea h={200}>
                                          <Table
                                            striped
                                            highlightOnHover
                                            withTableBorder
                                            withColumnBorders
                                          >
                                            <Table.Thead>
                                              <Table.Tr>
                                                <Table.Th>File</Table.Th>
                                                <Table.Th w={120}>
                                                  Size
                                                </Table.Th>
                                                <Table.Th w={180}>
                                                  Updated
                                                </Table.Th>
                                              </Table.Tr>
                                            </Table.Thead>
                                            <Table.Tbody>
                                              {nodeStash.cache.files.map(
                                                (file) => (
                                                  <Table.Tr
                                                    key={`stash-file-${file.name}`}
                                                  >
                                                    <Table.Td>
                                                      <Text
                                                        size="xs"
                                                        ff="monospace"
                                                      >
                                                        {file.name}
                                                      </Text>
                                                    </Table.Td>
                                                    <Table.Td>
                                                      <Text size="xs">
                                                        {formatBytes(file.size)}
                                                      </Text>
                                                    </Table.Td>
                                                    <Table.Td>
                                                      <Text
                                                        size="xs"
                                                        c="dimmed"
                                                      >
                                                        {new Date(
                                                          file.mtimeMs
                                                        ).toLocaleString()}
                                                      </Text>
                                                    </Table.Td>
                                                  </Table.Tr>
                                                )
                                              )}
                                            </Table.Tbody>
                                          </Table>
                                        </ScrollArea>
                                      ) : (
                                        <Text size="sm" c="dimmed">
                                          Stash is empty.
                                        </Text>
                                      )}
                                    </>
                                  ) : (
                                    <Text size="sm" c="dimmed">
                                      No stash data loaded yet.
                                    </Text>
                                  )}
                                </Stack>
                              </Paper>
                            </>
                          ) : (
                            <>
                              <Text fw={700}>
                                Selected Nodes ({selectedNodeRows.length})
                              </Text>
                              <ScrollArea h={280}>
                                <Stack gap="xs">
                                  {selectedNodeRows.map((row) => (
                                    <Card
                                      key={`workspace-node-${row.id}`}
                                      withBorder
                                      p="xs"
                                    >
                                      <Group
                                        justify="space-between"
                                        align="flex-start"
                                        wrap="nowrap"
                                      >
                                        <div>
                                          <Text fw={600}>{row.id}</Text>
                                          <Text size="xs" c="dimmed">
                                            {row.nodeName ||
                                              row.host ||
                                              row.ip ||
                                              "node"}
                                          </Text>
                                        </div>
                                        <Badge
                                          variant="light"
                                          color={
                                            row.connectivity?.status ===
                                            "online"
                                              ? "teal"
                                              : row.connectivity?.status ===
                                                "degraded"
                                              ? "yellow"
                                              : "red"
                                          }
                                        >
                                          {row.connectivity?.status ||
                                            "offline"}
                                        </Badge>
                                      </Group>
                                    </Card>
                                  ))}
                                </Stack>
                              </ScrollArea>
                              <Stack gap="xs">
                                <Button
                                  variant="light"
                                  color="orange"
                                  leftSection={<IconChecklist size={14} />}
                                  onClick={() => void returnToGuide()}
                                >
                                  Return Selected to Guide
                                </Button>
                                <Button
                                  variant="light"
                                  color="gray"
                                  onClick={() => {
                                    clearSelection();
                                    setFleetView("table");
                                  }}
                                >
                                  Clear Selection
                                </Button>
                              </Stack>
                            </>
                          )}
                        </Stack>
                      </Card>

                      <Card withBorder p="md" ref={assignSectionRef}>
                        <Stack gap="md">
                          <Breadcrumbs separator="›">
                            <Text size="sm" c="dimmed">
                              Node Workspace
                            </Text>
                            <Text size="sm">Assign Target</Text>
                            <Text size="sm" c="dimmed">
                              Launch Options
                            </Text>
                          </Breadcrumbs>
                          <Text fw={700}>Assign Target + Launch Options</Text>
                          <Text size="sm" c="dimmed">
                            Apply media/container state to selected nodes. Use
                            “inherit” to keep existing launch behavior.
                          </Text>

                          <Accordion
                            multiple
                            defaultValue={["target", "playback", "overlays"]}
                          >
                            <Accordion.Item value="target">
                              <Accordion.Control>Target</Accordion.Control>
                              <Accordion.Panel>
                                <Stack gap="sm">
                                  <Select
                                    label="Target type"
                                    data={[
                                      { value: "profile", label: "profile" },
                                      { value: "channel", label: "channel" },
                                      { value: "block", label: "block" },
                                      { value: "playlist", label: "playlist" },
                                      { value: "media", label: "media" },
                                    ]}
                                    value={applyKind}
                                    onChange={(value) => {
                                      const next =
                                        (value as OpsApplyTarget) || "profile";
                                      setApplyKind(next);
                                      setApplyId("");
                                    }}
                                  />
                                  {applyKind === "media" ||
                                  applyKind === "playlist" ? (
                                    <Stack gap={6}>
                                      <Group gap="xs" align="end" wrap="nowrap">
                                        <TextInput
                                          label="Target resource"
                                          placeholder={`Select ${applyKind}`}
                                          value={applyId}
                                          readOnly
                                          style={{ flex: 1 }}
                                        />
                                        <Button
                                          variant="light"
                                          onClick={() =>
                                            setTargetPickerOpen(true)
                                          }
                                        >
                                          Browse
                                        </Button>
                                      </Group>
                                      <Text size="xs" c="dimmed">
                                        Use searchable card picker for media and
                                        playlists.
                                      </Text>
                                    </Stack>
                                  ) : (
                                    <Select
                                      label="Target resource"
                                      placeholder="Search target id"
                                      searchable
                                      data={currentApplyOptions}
                                      value={applyId}
                                      onChange={(value) =>
                                        setApplyId(value || "")
                                      }
                                    />
                                  )}
                                  {applyTargetPreviewCard}
                                </Stack>
                              </Accordion.Panel>
                            </Accordion.Item>

                            <Accordion.Item value="playback">
                              <Accordion.Control>
                                Playback Mode
                              </Accordion.Control>
                              <Accordion.Panel>
                                <Select
                                  label="Player mode"
                                  data={[
                                    { value: "inherit", label: "inherit" },
                                    { value: "guide", label: "guide" },
                                    { value: "gallery", label: "gallery" },
                                  ]}
                                  value={optMode}
                                  onChange={(v) =>
                                    setOptMode((v as OptionMode) || "inherit")
                                  }
                                />
                              </Accordion.Panel>
                            </Accordion.Item>

                            <Accordion.Item value="overlays">
                              <Accordion.Control>
                                Overlays & Lock
                              </Accordion.Control>
                              <Accordion.Panel>
                                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                                  <Select
                                    label="Lock controls"
                                    data={[
                                      { value: "inherit", label: "inherit" },
                                      { value: "on", label: "on" },
                                      { value: "off", label: "off" },
                                    ]}
                                    value={optLock}
                                    onChange={(v) =>
                                      setOptLock((v as OptionBool) || "inherit")
                                    }
                                  />
                                  <Select
                                    label="QR overlay"
                                    data={[
                                      { value: "inherit", label: "inherit" },
                                      { value: "on", label: "on" },
                                      { value: "off", label: "off" },
                                    ]}
                                    value={optQr}
                                    onChange={(v) =>
                                      setOptQr((v as OptionBool) || "inherit")
                                    }
                                  />
                                  <Select
                                    label="Playlist overlay"
                                    data={[
                                      { value: "inherit", label: "inherit" },
                                      { value: "on", label: "on" },
                                      { value: "off", label: "off" },
                                    ]}
                                    value={optPlaylist}
                                    onChange={(v) =>
                                      setOptPlaylist(
                                        (v as OptionBool) || "inherit"
                                      )
                                    }
                                  />
                                  <Select
                                    label="Skip splash"
                                    data={[
                                      { value: "inherit", label: "inherit" },
                                      { value: "on", label: "on" },
                                      { value: "off", label: "off" },
                                    ]}
                                    value={optNosplash}
                                    onChange={(v) =>
                                      setOptNosplash(
                                        (v as OptionBool) || "inherit"
                                      )
                                    }
                                  />
                                </SimpleGrid>
                              </Accordion.Panel>
                            </Accordion.Item>

                            <Accordion.Item value="info">
                              <Accordion.Control>Info Box</Accordion.Control>
                              <Accordion.Panel>
                                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                                  <Select
                                    label="Visibility"
                                    data={[
                                      { value: "inherit", label: "inherit" },
                                      { value: "always", label: "always" },
                                      { value: "start", label: "start" },
                                      { value: "never", label: "never" },
                                    ]}
                                    value={optHud}
                                    onChange={(v) =>
                                      setOptHud((v as OptionHud) || "inherit")
                                    }
                                  />
                                  <NumberInput
                                    label="Visible seconds"
                                    value={optHudSec}
                                    onChange={(value) =>
                                      setOptHudSec(
                                        typeof value === "number" &&
                                          Number.isFinite(value)
                                          ? value
                                          : ""
                                      )
                                    }
                                    min={1}
                                    max={120}
                                    placeholder="inherit"
                                  />
                                  <TextInput
                                    label="Theme"
                                    value={optTheme}
                                    onChange={(e) =>
                                      setOptTheme(e.currentTarget.value)
                                    }
                                  />
                                </SimpleGrid>
                              </Accordion.Panel>
                            </Accordion.Item>

                            <Accordion.Item value="display">
                              <Accordion.Control>Display</Accordion.Control>
                              <Accordion.Panel>
                                <Select
                                  label="Rotation"
                                  data={[
                                    { value: "inherit", label: "inherit" },
                                    { value: "0", label: "0" },
                                    { value: "90", label: "90" },
                                    { value: "180", label: "180" },
                                    { value: "270", label: "270" },
                                  ]}
                                  value={optRotate}
                                  onChange={(v) =>
                                    setOptRotate(
                                      (v as OptionRotate) || "inherit"
                                    )
                                  }
                                />
                              </Accordion.Panel>
                            </Accordion.Item>
                          </Accordion>

                          <Group justify="space-between" wrap="wrap">
                            <Button
                              variant="light"
                              color="gray"
                              onClick={() => setFleetView("table")}
                            >
                              Close workspace
                            </Button>
                            <Button
                              leftSection={<IconAdjustments size={16} />}
                              onClick={runApply}
                              disabled={
                                !applyId.trim() || selectedNodeIds.length === 0
                              }
                            >
                              Apply to selected
                            </Button>
                          </Group>

                          {applyResult ? (
                            <Paper withBorder p="sm">
                              <Text fw={600} mb={4}>
                                Last apply
                              </Text>
                              <Text
                                size="sm"
                                c={applyResult.ok ? "teal" : "orange"}
                              >
                                {summarizeApplyResult(applyResult)}
                              </Text>
                            </Paper>
                          ) : null}
                        </Stack>
                      </Card>
                    </Stack>
                  )}
                </Stack>
              </Paper>
            ) : (
              <Paper withBorder radius="md" p="md">
                <Stack gap="xs" mb="sm">
                  <div>
                    <Title order={4}>Connected Nodes</Title>
                    <Text size="sm" c="dimmed">
                      Live status, runtime target, connectivity, and versions.
                    </Text>
                  </div>
                  <TextInput
                    leftSection={<IconSearch size={16} />}
                    placeholder="Filter nodes by id/host/ip"
                    value={search}
                    onChange={(e) => setSearch(e.currentTarget.value)}
                    w={isMobile ? "100%" : 260}
                  />
                  <Group wrap="wrap">
                    <Button
                      size={isMobile ? "xs" : "sm"}
                      variant="light"
                      onClick={selectVisible}
                    >
                      Select Visible
                    </Button>
                    <Button
                      size={isMobile ? "xs" : "sm"}
                      variant="light"
                      color="gray"
                      onClick={clearSelection}
                    >
                      Clear
                    </Button>
                    <Button
                      size={isMobile ? "xs" : "sm"}
                      variant="light"
                      leftSection={<IconPencil size={16} />}
                      onClick={() => {
                        openNodeWorkspace();
                        if (isMobile) setControlOpen(false);
                      }}
                      disabled={selectedNodeIds.length === 0}
                    >
                      {`Edit ${selectedNodeIds.length} ${
                        selectedNodeIds.length === 1 ? "node" : "nodes"
                      }`}
                    </Button>
                    <Button
                      size={isMobile ? "xs" : "sm"}
                      variant="light"
                      leftSection={<IconSquareRoundedPlus size={16} />}
                      onClick={openCreateNodeEditor}
                    >
                      Add Node
                    </Button>
                    <Button
                      size={isMobile ? "xs" : "sm"}
                      variant="light"
                      leftSection={<IconDownload size={16} />}
                      onClick={() => void exportNodes("json")}
                    >
                      Export JSON
                    </Button>
                    <Button
                      size={isMobile ? "xs" : "sm"}
                      variant="light"
                      leftSection={<IconDownload size={16} />}
                      onClick={() => void exportNodes("toml")}
                    >
                      Export TOML
                    </Button>
                  </Group>
                </Stack>
                {isMobile ? (
                  <Stack>
                    {filteredRows.map((row) => (
                      <Card key={row.id} withBorder p="sm">
                        <Stack gap="xs">
                          <Group justify="space-between" wrap="nowrap">
                            <Group gap="xs" wrap="nowrap">
                              <Checkbox
                                checked={selectedNodeIds.includes(row.id)}
                                onChange={(e) =>
                                  toggleNodeSelection(
                                    row.id,
                                    e.currentTarget.checked
                                  )
                                }
                              />
                              <Stack gap={0}>
                                <Text fw={700}>{row.id}</Text>
                                <Text size="xs" c="dimmed">
                                  {row.nodeName || "Unnamed node"}
                                </Text>
                              </Stack>
                            </Group>
                            <Badge
                              color={
                                row.connectivity?.status === "online"
                                  ? "teal"
                                  : row.connectivity?.status === "degraded"
                                  ? "yellow"
                                  : "red"
                              }
                              variant="light"
                            >
                              {row.connectivity?.status || "offline"}{" "}
                              {row.connectivity?.score ?? 0}/
                              {row.connectivity?.total ?? 5}
                            </Badge>
                          </Group>
                          <Text size="xs" ff="monospace">
                            {row.host} {row.ip ? `• ${row.ip}` : ""}
                          </Text>
                          <Group gap={6}>
                            {statusBadge(row.dnsOk, "DNS", "DNS")}
                            {statusBadge(row.tcp.ssh22.ok, "SSH", "SSH")}
                            {statusBadge(
                              row.http.nodeStatus.ok,
                              "Node",
                              "Node"
                            )}
                            {statusBadge(
                              row.http.cableVersion.ok,
                              "Cable",
                              "Cable"
                            )}
                          </Group>
                          <Text size="xs" ff="monospace">
                            target:{" "}
                            {parseTargetFromKioskUrl(
                              row.chibaNode.kioskUrl ?? null
                            )}
                          </Text>
                          <Text size="xs" c="dimmed">
                            node {row.chibaNode.version ?? "?"} • cable{" "}
                            {row.cableServer?.version ?? "?"} •{" "}
                            {Math.max(
                              0,
                              Math.round(
                                (Date.now() - row.lastCheckedAt) / 1000
                              )
                            )}
                            s ago
                          </Text>
                          <Group gap="xs" grow>
                            <Button
                              variant="light"
                              size="xs"
                              onClick={() => setActiveNodeId(row.id)}
                            >
                              Inspect
                            </Button>
                            <Button
                              variant="light"
                              color="blue"
                              size="xs"
                              onClick={() => openEditNodeEditor(row.id)}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="light"
                              color="red"
                              size="xs"
                              onClick={() => void removeNode(row.id)}
                            >
                              Delete
                            </Button>
                          </Group>
                        </Stack>
                      </Card>
                    ))}
                  </Stack>
                ) : (
                  <Stack gap="xs">
                    <ScrollArea>
                      <Table
                        striped
                        highlightOnHover
                        withTableBorder
                        withColumnBorders
                      >
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th w={42}>
                              <Checkbox
                                checked={
                                  filteredRows.length > 0 &&
                                  filteredRows.every((row) =>
                                    selectedNodeIds.includes(row.id)
                                  )
                                }
                                onChange={(e) => {
                                  if (e.currentTarget.checked) {
                                    setSelectedNodeIds(
                                      Array.from(
                                        new Set([
                                          ...selectedNodeIds,
                                          ...filteredRows.map((row) => row.id),
                                        ])
                                      )
                                    );
                                  } else {
                                    setSelectedNodeIds((prev) =>
                                      prev.filter(
                                        (id) =>
                                          !filteredRows.some(
                                            (row) => row.id === id
                                          )
                                      )
                                    );
                                  }
                                }}
                              />
                            </Table.Th>
                            <Table.Th>Node</Table.Th>
                            <Table.Th>Host/IP</Table.Th>
                            <Table.Th>Connectivity</Table.Th>
                            <Table.Th>Runtime</Table.Th>
                            <Table.Th>Versions</Table.Th>
                            <Table.Th>Last</Table.Th>
                            <Table.Th>Actions</Table.Th>
                          </Table.Tr>
                        </Table.Thead>
                        <Table.Tbody>
                          {fleetRowsPage.map((row) => (
                            <Table.Tr key={row.id}>
                              <Table.Td>
                                <Checkbox
                                  checked={selectedNodeIds.includes(row.id)}
                                  onChange={(e) =>
                                    toggleNodeSelection(
                                      row.id,
                                      e.currentTarget.checked
                                    )
                                  }
                                />
                              </Table.Td>
                              <Table.Td>
                                <Stack gap={2}>
                                  <Group gap={8}>
                                    <Text fw={700}>{row.id}</Text>
                                    {statusBadge(row.ping.ok, "OK", "OFFLINE")}
                                  </Group>
                                  <Text size="xs" c="dimmed">
                                    {row.nodeName}
                                  </Text>
                                  <Text size="xs" c="dimmed">
                                    registry:{" "}
                                    {row.registryId || activeRegistryId}
                                  </Text>
                                </Stack>
                              </Table.Td>
                              <Table.Td>
                                <Stack gap={2}>
                                  <Text ff="monospace">{row.host}</Text>
                                  <Text ff="monospace" c="dimmed">
                                    {row.ip || "—"}
                                  </Text>
                                </Stack>
                              </Table.Td>
                              <Table.Td>
                                <Stack gap={6}>
                                  <Group gap={6}>
                                    <Badge
                                      color={
                                        row.connectivity?.status === "online"
                                          ? "teal"
                                          : row.connectivity?.status ===
                                            "degraded"
                                          ? "yellow"
                                          : "red"
                                      }
                                      variant="light"
                                    >
                                      {row.connectivity?.status || "offline"}{" "}
                                      {row.connectivity?.score ?? 0}/
                                      {row.connectivity?.total ?? 5}
                                    </Badge>
                                  </Group>
                                  <Group gap={6}>
                                    {statusBadge(row.dnsOk, "DNS", "DNS")}
                                    {statusBadge(
                                      row.tcp.ssh22.ok,
                                      "SSH",
                                      "SSH"
                                    )}
                                    {statusBadge(
                                      row.http.nodeStatus.ok,
                                      "Node",
                                      "Node"
                                    )}
                                    {statusBadge(
                                      row.http.cableVersion.ok,
                                      "Cable",
                                      "Cable"
                                    )}
                                  </Group>
                                </Stack>
                              </Table.Td>
                              <Table.Td>
                                <Stack gap={2}>
                                  <Text size="sm" ff="monospace">
                                    {parseTargetFromKioskUrl(
                                      row.chibaNode.kioskUrl ?? null
                                    )}
                                  </Text>
                                  <Button
                                    variant="subtle"
                                    size="compact-xs"
                                    onClick={() => setActiveNodeId(row.id)}
                                    leftSection={<IconBroadcast size={12} />}
                                  >
                                    Inspect
                                  </Button>
                                </Stack>
                              </Table.Td>
                              <Table.Td>
                                <Stack gap={2}>
                                  <Text size="xs">
                                    node: {row.chibaNode.version ?? "?"}
                                  </Text>
                                  <Text size="xs">
                                    cable: {row.cableServer?.version ?? "?"}
                                  </Text>
                                  <Text size="xs" c="dimmed">
                                    sha: {row.cableServer?.gitSha ?? "—"}
                                  </Text>
                                </Stack>
                              </Table.Td>
                              <Table.Td>
                                <Text size="xs" c="dimmed">
                                  {Math.max(
                                    0,
                                    Math.round(
                                      (Date.now() - row.lastCheckedAt) / 1000
                                    )
                                  )}
                                  s ago
                                </Text>
                              </Table.Td>
                              <Table.Td>
                                <Group gap={6}>
                                  <ActionIcon
                                    variant="light"
                                    color="blue"
                                    onClick={() => openEditNodeEditor(row.id)}
                                    title="Edit node"
                                  >
                                    <IconPencil size={14} />
                                  </ActionIcon>
                                  <ActionIcon
                                    variant="light"
                                    color="red"
                                    onClick={() => void removeNode(row.id)}
                                    title="Delete node"
                                  >
                                    <IconTrash size={14} />
                                  </ActionIcon>
                                </Group>
                              </Table.Td>
                            </Table.Tr>
                          ))}
                        </Table.Tbody>
                      </Table>
                    </ScrollArea>
                    <Group justify="space-between" mt="xs" wrap="wrap">
                      <Text size="xs" c="dimmed">
                        {tableRangeLabel(
                          filteredRows.length,
                          fleetPage,
                          TABLE_PAGE_SIZE.fleet
                        )}
                      </Text>
                      <Pagination
                        total={fleetPageCount}
                        value={fleetPage}
                        onChange={setFleetPage}
                        size={isMobile ? "sm" : "md"}
                        siblings={1}
                        boundaries={1}
                        withEdges
                      />
                    </Group>
                  </Stack>
                )}
              </Paper>
            )}
          </Tabs.Panel>

          <Tabs.Panel value="builder" pt="md">
            <SimpleGrid cols={1} spacing="md">
              <Paper withBorder radius="md" p="md">
                <Stack gap="md">
                  <Group justify="space-between" align="center" wrap="wrap">
                    <Title order={4}>
                      {builderTab === "ingest"
                        ? "Source Ingestion"
                        : builderTab === "playlistEditor"
                        ? "Playlist Editor"
                        : builderTab === "mediaDetail"
                        ? "Media Detail"
                        : "Media Library"}
                    </Title>
                  </Group>
                  {builderTab !== "ingest" &&
                  builderTab !== "mediaDetail" &&
                  builderTab !== "playlistEditor" ? (
                    <SegmentedControl
                      value={currentLibraryPane}
                      onChange={(value) => {
                        const next =
                          (value as
                            | "media"
                            | "playlists"
                            | "blocks"
                            | "channels"
                            | "profiles") || "media";
                        if (next === "media" || next === "playlists") {
                          setMediaLibrarySection(next);
                          setBuilderTab("media");
                          return;
                        }
                        setMediaLibrarySection(next);
                        if (next === "blocks") setBuilderTab("block");
                        if (next === "channels") setBuilderTab("channel");
                        if (next === "profiles") setBuilderTab("profile");
                      }}
                      data={[
                        {
                          value: "media",
                          label: `Media (${serverMedia.length})`,
                        },
                        {
                          value: "playlists",
                          label: `Playlists (${draftStore.playlists.length})`,
                        },
                        {
                          value: "blocks",
                          label: `Blocks (${draftStore.blocks.length})`,
                        },
                        {
                          value: "channels",
                          label: `Channels (${draftStore.channels.length})`,
                        },
                        {
                          value: "profiles",
                          label: `Profiles (${draftStore.profiles.length})`,
                        },
                      ]}
                      fullWidth
                    />
                  ) : null}

                  {builderTab === "ingest" ? (
                    <Stack gap="lg">
                      <Group justify="space-between" align="center" wrap="wrap">
                        <Text size="sm" c="dimmed">
                          Target:{" "}
                          <Code>{"{SHARE_ROOT}/chiba-cable/assets"}</Code>
                        </Text>
                        <Group gap="xs">
                          <Badge variant="light">Step {ingestStep} / 3</Badge>
                          {activeIngestJobs.length > 0 ? (
                            <Group gap={6}>
                              <Loader size={14} />
                              <Text size="xs" c="dimmed">
                                {runningIngestCount} running •{" "}
                                {activeIngestJobs.length} active
                              </Text>
                            </Group>
                          ) : null}
                        </Group>
                      </Group>

                      <Progress
                        value={
                          ingestStep === 1 ? 33 : ingestStep === 2 ? 66 : 100
                        }
                      />

                      {ingestStep === 1 ? (
                        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
                          <Card
                            withBorder
                            p="lg"
                            className={`ops-ingest-source-card${
                              ingestSource === "youtube" ? " is-selected" : ""
                            }`}
                            onClick={() => {
                              setIngestSource("youtube");
                              setIngestStep(2);
                            }}
                          >
                            <Stack gap="xs">
                              <Group gap={8}>
                                <IconUpload size={18} />
                                <Text fw={700}>YouTube</Text>
                              </Group>
                              <Text size="sm" c="dimmed">
                                Download a single video via `yt-dlp`.
                              </Text>
                            </Stack>
                          </Card>
                          <Card
                            withBorder
                            p="lg"
                            className={`ops-ingest-source-card${
                              ingestSource === "eden" ? " is-selected" : ""
                            }`}
                            onClick={() => {
                              setIngestSource("eden");
                              setIngestStep(2);
                            }}
                          >
                            <Stack gap="xs">
                              <Group gap={8}>
                                <IconStack2 size={18} />
                                <Text fw={700}>Eden Collection</Text>
                              </Group>
                              <Text size="sm" c="dimmed">
                                Import collection items as media records.
                              </Text>
                            </Stack>
                          </Card>
                          <Card
                            withBorder
                            p="lg"
                            className={`ops-ingest-source-card${
                              ingestSource === "upload" ? " is-selected" : ""
                            }`}
                            onClick={() => {
                              setIngestSource("upload");
                              setIngestStep(2);
                            }}
                          >
                            <Stack gap="xs">
                              <Group gap={8}>
                                <IconPhotoPlus size={18} />
                                <Text fw={700}>Files / Zip Upload</Text>
                              </Group>
                              <Text size="sm" c="dimmed">
                                Upload up to 20 files or one zip archive.
                              </Text>
                            </Stack>
                          </Card>
                        </SimpleGrid>
                      ) : null}

                      {ingestStep === 2 ? (
                        <Card withBorder p="md">
                          <Stack>
                            <Group justify="space-between">
                              <Text fw={700}>
                                Configure {selectedIngestLabel}
                              </Text>
                              <Button
                                variant="light"
                                size="xs"
                                onClick={() => setIngestStep(1)}
                              >
                                Change Source
                              </Button>
                            </Group>
                            {ingestSource === "youtube" ? (
                              <Stack>
                                <TextInput
                                  label="YouTube URL"
                                  placeholder="https://www.youtube.com/watch?v=..."
                                  value={youtubeUrl}
                                  onChange={(e) =>
                                    setYoutubeUrl(e.currentTarget.value)
                                  }
                                />
                                <SimpleGrid cols={{ base: 1, sm: 2 }}>
                                  <TextInput
                                    label="Title (optional)"
                                    value={youtubeTitle}
                                    onChange={(e) =>
                                      setYoutubeTitle(e.currentTarget.value)
                                    }
                                  />
                                  <TextInput
                                    label="Artist (optional)"
                                    value={youtubeArtist}
                                    onChange={(e) =>
                                      setYoutubeArtist(e.currentTarget.value)
                                    }
                                  />
                                </SimpleGrid>
                              </Stack>
                            ) : null}
                            {ingestSource === "eden" ? (
                              <TextInput
                                label="Collection URL or ID"
                                placeholder="https://app.eden.art/collections/... or 6980..."
                                value={edenInput}
                                onChange={(e) =>
                                  setEdenInput(e.currentTarget.value)
                                }
                              />
                            ) : null}
                            {ingestSource === "upload" ? (
                              <Stack>
                                <Paper
                                  withBorder
                                  p="md"
                                  radius="md"
                                  {...getUploadRootProps()}
                                  style={{
                                    cursor: "pointer",
                                    borderStyle: "dashed",
                                    borderColor: isUploadDragActive
                                      ? "rgba(95, 169, 255, 0.95)"
                                      : undefined,
                                  }}
                                >
                                  <input {...getUploadInputProps()} />
                                  <Stack gap={6}>
                                    <Text fw={600}>
                                      {isUploadDragActive
                                        ? "Drop files here"
                                        : "Drag & drop files or zip here, or click to browse"}
                                    </Text>
                                    <Text size="xs" c="dimmed">
                                      Up to 20 media files, or one zip archive.
                                      Total limit: 2GB.
                                    </Text>
                                  </Stack>
                                </Paper>
                                <Text size="xs" c="dimmed">
                                  Selected: {uploadFiles.length} file(s)
                                </Text>
                                <SimpleGrid
                                  cols={{ base: 1, md: 2 }}
                                  spacing="sm"
                                >
                                  <TextInput
                                    label="Artist for all uploads (optional)"
                                    placeholder="Applied to every imported media item"
                                    value={uploadArtist}
                                    onChange={(e) =>
                                      setUploadArtist(e.currentTarget.value)
                                    }
                                  />
                                  <Textarea
                                    label="Description for all uploads (optional)"
                                    placeholder="Applied to every imported media item"
                                    autosize
                                    minRows={2}
                                    maxRows={4}
                                    value={uploadDescription}
                                    onChange={(e) =>
                                      setUploadDescription(
                                        e.currentTarget.value
                                      )
                                    }
                                  />
                                </SimpleGrid>
                                {uploadFiles.length > 0 ? (
                                  <SimpleGrid
                                    cols={{ base: 1, sm: 2, lg: 3 }}
                                    spacing="sm"
                                  >
                                    {uploadPreviewItems.map(
                                      (item, itemIndex) => (
                                        <Card
                                          key={`${item.file.name}-${item.file.size}-${item.file.lastModified}`}
                                          withBorder
                                          p="xs"
                                          className="ops-upload-preview-card"
                                        >
                                          <Stack gap={8}>
                                            <Group
                                              justify="space-between"
                                              align="flex-start"
                                              wrap="nowrap"
                                            >
                                              <Badge size="sm" variant="light">
                                                {item.kind === "image"
                                                  ? "IMAGE"
                                                  : item.kind === "video"
                                                  ? "VIDEO"
                                                  : item.kind === "audio"
                                                  ? "AUDIO"
                                                  : item.kind === "zip"
                                                  ? "ZIP"
                                                  : "FILE"}
                                              </Badge>
                                              <ActionIcon
                                                color="red"
                                                variant="light"
                                                size="sm"
                                                title="Remove from upload"
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  removeUploadFileAtIndex(
                                                    itemIndex
                                                  );
                                                }}
                                              >
                                                <IconTrash size={14} />
                                              </ActionIcon>
                                            </Group>
                                            {item.kind === "image" &&
                                            item.url ? (
                                              <Image
                                                src={item.url}
                                                alt={item.file.name}
                                                radius="sm"
                                                h={124}
                                                fit="cover"
                                              />
                                            ) : null}
                                            {item.kind === "video" &&
                                            item.url ? (
                                              <video
                                                className="ops-upload-preview-video"
                                                src={item.url}
                                                muted
                                                controls
                                                preload="metadata"
                                              />
                                            ) : null}
                                            {item.kind === "audio" &&
                                            item.url ? (
                                              <audio
                                                src={item.url}
                                                controls
                                                preload="metadata"
                                                style={{ width: "100%" }}
                                              />
                                            ) : null}
                                            {item.kind === "zip" ||
                                            item.kind === "file" ? (
                                              <Paper
                                                withBorder
                                                p="md"
                                                radius="sm"
                                                className="ops-upload-preview-fallback"
                                              >
                                                <Stack gap={4}>
                                                  <Text size="xs" c="dimmed">
                                                    No inline preview
                                                  </Text>
                                                </Stack>
                                              </Paper>
                                            ) : null}
                                            <Text
                                              size="sm"
                                              fw={600}
                                              lineClamp={1}
                                            >
                                              {item.file.name}
                                            </Text>
                                            <Text size="xs" c="dimmed">
                                              {formatBytes(item.file.size)}
                                            </Text>
                                          </Stack>
                                        </Card>
                                      )
                                    )}
                                  </SimpleGrid>
                                ) : null}
                                {uploadDropError ? (
                                  <Text size="xs" c="red">
                                    {uploadDropError}
                                  </Text>
                                ) : null}
                              </Stack>
                            ) : null}
                            <Group justify="flex-end">
                              <Button
                                onClick={() => setIngestStep(3)}
                                disabled={!canQueueIngest}
                              >
                                Review Queue
                              </Button>
                            </Group>
                          </Stack>
                        </Card>
                      ) : null}

                      {ingestStep === 3 ? (
                        <Card withBorder p="md">
                          <Stack gap="sm">
                            <Text fw={700}>Review & Queue</Text>
                            <Text size="sm" c="dimmed">
                              Source: {selectedIngestLabel}
                            </Text>
                            {ingestSource === "upload" ? (
                              <Stack gap="sm">
                                <Group gap="xs" wrap="wrap">
                                  <Badge variant="light" color="blue">
                                    {uploadFiles.length} file(s)
                                  </Badge>
                                  {uploadArtist.trim() ? (
                                    <Badge variant="light" color="grape">
                                      artist: {uploadArtist.trim()}
                                    </Badge>
                                  ) : null}
                                </Group>
                                {uploadDescription.trim() ? (
                                  <Text size="sm" c="dimmed">
                                    {uploadDescription.trim()}
                                  </Text>
                                ) : null}
                                <SimpleGrid
                                  cols={{ base: 1, sm: 2, lg: 3 }}
                                  spacing="sm"
                                >
                                  {uploadPreviewItems.map((item) => (
                                    <Card
                                      key={`review-${item.file.name}-${item.file.size}-${item.file.lastModified}`}
                                      withBorder
                                      p="xs"
                                    >
                                      <Stack gap={8}>
                                        {item.kind === "image" && item.url ? (
                                          <Image
                                            src={item.url}
                                            alt={item.file.name}
                                            radius="sm"
                                            h={124}
                                            fit="cover"
                                          />
                                        ) : null}
                                        {item.kind === "video" && item.url ? (
                                          <video
                                            className="ops-upload-preview-video"
                                            src={item.url}
                                            muted
                                            controls
                                            preload="metadata"
                                          />
                                        ) : null}
                                        {item.kind === "audio" && item.url ? (
                                          <audio
                                            src={item.url}
                                            controls
                                            preload="metadata"
                                            style={{ width: "100%" }}
                                          />
                                        ) : null}
                                        {item.kind === "zip" ||
                                        item.kind === "file" ? (
                                          <Paper
                                            withBorder
                                            p="md"
                                            radius="sm"
                                            className="ops-upload-preview-fallback"
                                          >
                                            <Text size="xs" c="dimmed">
                                              No inline preview
                                            </Text>
                                          </Paper>
                                        ) : null}
                                        <Group
                                          justify="space-between"
                                          align="center"
                                        >
                                          <Text
                                            size="sm"
                                            fw={600}
                                            lineClamp={1}
                                          >
                                            {item.file.name}
                                          </Text>
                                          <Badge size="xs" variant="light">
                                            {item.kind}
                                          </Badge>
                                        </Group>
                                        <Text size="xs" c="dimmed">
                                          {formatBytes(item.file.size)}
                                        </Text>
                                      </Stack>
                                    </Card>
                                  ))}
                                </SimpleGrid>
                              </Stack>
                            ) : (
                              <Code block>
                                {ingestSource === "youtube"
                                  ? JSON.stringify(
                                      {
                                        url: youtubeUrl.trim(),
                                        title: youtubeTitle.trim() || undefined,
                                        artist:
                                          youtubeArtist.trim() || undefined,
                                      },
                                      null,
                                      2
                                    )
                                  : JSON.stringify(
                                      {
                                        input: edenInput.trim(),
                                      },
                                      null,
                                      2
                                    )}
                              </Code>
                            )}
                            <Group justify="space-between">
                              <Button
                                variant="light"
                                onClick={() => setIngestStep(2)}
                                disabled={ingestBusy}
                              >
                                Back
                              </Button>
                              <Button
                                loading={ingestBusy}
                                disabled={!canQueueIngest}
                                onClick={() => {
                                  if (ingestSource === "youtube") {
                                    void runYouTubeIngest();
                                    return;
                                  }
                                  if (ingestSource === "eden") {
                                    void runEdenIngest();
                                    return;
                                  }
                                  void runUploadIngest();
                                }}
                              >
                                Queue Ingest Job
                              </Button>
                            </Group>
                          </Stack>
                        </Card>
                      ) : null}
                    </Stack>
                  ) : null}

                  {builderTab === "media" ? (
                    <Stack gap="md">
                      <Group
                        justify="space-between"
                        align="flex-end"
                        wrap="wrap"
                      >
                        <Group gap="sm" wrap="wrap">
                          {mediaLibrarySection === "playlists" ? (
                            <SegmentedControl
                              value={playlistLibraryView}
                              onChange={(value) =>
                                setPlaylistLibraryView(
                                  (value as "cards" | "table") || "cards"
                                )
                              }
                              data={[
                                { value: "cards", label: "Card View" },
                                { value: "table", label: "Table View" },
                              ]}
                            />
                          ) : null}
                        </Group>
                        {mediaLibrarySection === "media" ? (
                          <Group gap="xs">
                            <Badge variant="light">
                              {serverMediaFiltered.length} shown
                            </Badge>
                            <Badge variant="light" color="gray">
                              {serverMedia.length} total
                            </Badge>
                            <Button
                              variant="light"
                              size="xs"
                              onClick={() => void refreshServerSnapshot()}
                            >
                              Refresh
                            </Button>
                          </Group>
                        ) : (
                          <Button
                            size="xs"
                            variant="light"
                            onClick={() => openPlaylistEditorRoute()}
                          >
                            New Playlist
                          </Button>
                        )}
                      </Group>

                      {mediaLibrarySection === "media" ? (
                        <>
                          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
                            <TextInput
                              leftSection={<IconSearch size={16} />}
                              placeholder="Search media by id, title, artist, path/url"
                              value={serverMediaQuery}
                              onChange={(e) =>
                                setServerMediaQuery(e.currentTarget.value)
                              }
                            />
                            <SegmentedControl
                              value={serverMediaSourceFilter}
                              onChange={(value) =>
                                setServerMediaSourceFilter(
                                  (value as "all" | "path" | "url") || "all"
                                )
                              }
                              data={mediaFilterData}
                              fullWidth
                            />
                          </SimpleGrid>

                          <div
                            className="ops-media-feed"
                            onScroll={(event) => {
                              if (!hasMoreMediaFeed) return;
                              const target = event.currentTarget;
                              const nearBottom =
                                target.scrollHeight -
                                  (target.scrollTop + target.clientHeight) <
                                220;
                              if (nearBottom) {
                                setMediaFeedLimit((prev) =>
                                  Math.min(
                                    prev + 24,
                                    serverMediaFiltered.length
                                  )
                                );
                              }
                            }}
                          >
                            <SimpleGrid
                              cols={{ base: 1, sm: 2, lg: 3, xl: 4 }}
                              spacing="sm"
                            >
                              {activeIngestJobs.map((job) => (
                                <Card
                                  key={job.id}
                                  withBorder
                                  p="sm"
                                  className="ops-media-card ops-media-card-pending"
                                >
                                  <Stack gap={8}>
                                    <Group
                                      justify="space-between"
                                      align="center"
                                    >
                                      <Badge variant="light" color="gray">
                                        pending ingest
                                      </Badge>
                                      <Loader size={14} />
                                    </Group>
                                    <Text fw={700} lineClamp={1}>
                                      {job.kind.replace("_", " ")}
                                    </Text>
                                    <Text size="xs" c="dimmed" lineClamp={1}>
                                      {job.id}
                                    </Text>
                                    <Progress
                                      value={job.progress.percent}
                                      animated
                                    />
                                    <Text size="xs" c="dimmed" lineClamp={1}>
                                      {job.progress.message ||
                                        (job.status === "queued"
                                          ? "queued"
                                          : "processing")}
                                    </Text>
                                  </Stack>
                                </Card>
                              ))}
                              {mediaFeedItems.map((row) => {
                                const previewSrc = mediaPreviewSource(row);
                                const isVideo = isVideoMedia(row);
                                return (
                                  <Card
                                    key={row.id}
                                    withBorder
                                    p="sm"
                                    className={`ops-media-card${
                                      selectedServerMediaId === row.id
                                        ? " is-selected"
                                        : ""
                                    }`}
                                    onClick={() => {
                                      setSelectedServerMediaId(row.id);
                                      setMediaDetailId(row.id);
                                      setBuilderTab("mediaDetail");
                                    }}
                                  >
                                    <Stack gap={8}>
                                      {previewSrc ? (
                                        <video
                                          className="ops-media-thumb-video"
                                          muted
                                          loop
                                          playsInline
                                          preload="metadata"
                                          poster={row.thumbnailUrl}
                                          src={previewSrc}
                                          onMouseEnter={(e) => {
                                            void e.currentTarget
                                              .play()
                                              .catch(() => {});
                                          }}
                                          onMouseLeave={(e) => {
                                            e.currentTarget.pause();
                                            e.currentTarget.currentTime = 0;
                                          }}
                                        />
                                      ) : row.thumbnailUrl ? (
                                        <Image
                                          src={row.thumbnailUrl}
                                          alt={row.title || row.id}
                                          radius="sm"
                                          h={120}
                                          fit="cover"
                                        />
                                      ) : null}
                                      <Group
                                        justify="space-between"
                                        align="flex-start"
                                        wrap="nowrap"
                                      >
                                        <Stack gap={2}>
                                          <Text fw={700} lineClamp={1}>
                                            {row.title || row.id}
                                          </Text>
                                          <Text
                                            size="xs"
                                            c="dimmed"
                                            lineClamp={1}
                                          >
                                            {row.artist || "unknown artist"}
                                          </Text>
                                        </Stack>
                                        <Stack gap={6} align="flex-end">
                                          {isVideo ? (
                                            <Badge
                                              size="sm"
                                              variant="light"
                                              color="cyan"
                                            >
                                              video
                                            </Badge>
                                          ) : null}
                                          <ActionIcon
                                            color="blue"
                                            variant="light"
                                            size="sm"
                                            title="Send to node"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              openQuickSend({
                                                kind: "media",
                                                id: row.id,
                                                label: row.title || row.id,
                                              });
                                            }}
                                          >
                                            <IconBroadcast size={14} />
                                          </ActionIcon>
                                          <ActionIcon
                                            color="red"
                                            variant="light"
                                            size="sm"
                                            title="Delete media"
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              void deleteMediaItem(row.id);
                                            }}
                                          >
                                            <IconTrash size={14} />
                                          </ActionIcon>
                                        </Stack>
                                      </Group>
                                    </Stack>
                                  </Card>
                                );
                              })}
                            </SimpleGrid>
                            {serverMediaFiltered.length === 0 ? (
                              <Text size="sm" c="dimmed" mt="sm">
                                No media matches this filter.
                              </Text>
                            ) : null}
                            {hasMoreMediaFeed ? (
                              <Group justify="center" mt="md">
                                <Button
                                  variant="light"
                                  size="xs"
                                  onClick={() =>
                                    setMediaFeedLimit((prev) =>
                                      Math.min(
                                        prev + 24,
                                        serverMediaFiltered.length
                                      )
                                    )
                                  }
                                >
                                  Load More
                                </Button>
                              </Group>
                            ) : null}
                          </div>
                        </>
                      ) : (
                        <>
                          {playlistLibraryView === "cards" ? (
                            <SimpleGrid
                              cols={{ base: 1, md: 2, xl: 3 }}
                              spacing="sm"
                            >
                              {draftStore.playlists.map((row) => (
                                <Card
                                  key={row.id}
                                  withBorder
                                  p="sm"
                                  className="ops-playlist-card"
                                  onClick={() =>
                                    openPlaylistEditorRoute(row.id)
                                  }
                                >
                                  <Stack gap="xs">
                                    {(() => {
                                      const tileCount = Math.min(
                                        Math.max(row.mediaIds.length, 1),
                                        4
                                      );
                                      const tileIds = Array.from(
                                        { length: 4 },
                                        (_, i) => row.mediaIds[i] || ""
                                      );
                                      return (
                                        <div
                                          className={`ops-playlist-cover ops-playlist-cover-${tileCount}`}
                                        >
                                          {tileIds.map((mediaId, tileIndex) => {
                                            const media = mediaId
                                              ? mergedMediaById.get(mediaId)
                                              : undefined;
                                            const fallbackText = (
                                              media?.title ||
                                              mediaId ||
                                              `${tileIndex + 1}`
                                            )
                                              .slice(0, 1)
                                              .toUpperCase();
                                            return (
                                              <div
                                                key={`${row.id}-tile-${tileIndex}`}
                                                className="ops-playlist-cover-tile"
                                              >
                                                {media?.thumbnailUrl ? (
                                                  <img
                                                    className="ops-playlist-cover-img"
                                                    src={media.thumbnailUrl}
                                                    alt={
                                                      media.title || media.id
                                                    }
                                                  />
                                                ) : (
                                                  <div className="ops-playlist-cover-fallback">
                                                    {fallbackText}
                                                  </div>
                                                )}
                                              </div>
                                            );
                                          })}
                                          {row.mediaIds.length > 4 ? (
                                            <div className="ops-playlist-cover-more">
                                              +{row.mediaIds.length - 4}
                                            </div>
                                          ) : null}
                                        </div>
                                      );
                                    })()}
                                    <Group
                                      justify="space-between"
                                      align="flex-start"
                                      wrap="nowrap"
                                    >
                                      <Stack gap={2}>
                                        <Text fw={700} lineClamp={1}>
                                          {row.title || row.id}
                                        </Text>
                                        <Text size="xs" c="dimmed">
                                          {row.id}
                                        </Text>
                                      </Stack>
                                      <Group gap={6}>
                                        <ActionIcon
                                          color="blue"
                                          variant="light"
                                          size="sm"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            openPlaylistEditorRoute(row.id);
                                          }}
                                          title="Open playlist editor"
                                        >
                                          <IconPencil size={14} />
                                        </ActionIcon>
                                        <ActionIcon
                                          color="cyan"
                                          variant="light"
                                          size="sm"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            openQuickSend({
                                              kind: "playlist",
                                              id: row.id,
                                              label: row.title || row.id,
                                            });
                                          }}
                                          title="Send playlist to node"
                                        >
                                          <IconBroadcast size={14} />
                                        </ActionIcon>
                                        <ActionIcon
                                          color="red"
                                          variant="light"
                                          size="sm"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            deletePlaylistDraft(row.id);
                                          }}
                                          title="Delete playlist"
                                        >
                                          <IconTrash size={14} />
                                        </ActionIcon>
                                      </Group>
                                    </Group>
                                    <Group gap={6}>
                                      <Badge size="sm" variant="light">
                                        {row.mediaIds.length} items
                                      </Badge>
                                      {row.artist ? (
                                        <Badge
                                          size="sm"
                                          variant="light"
                                          color="gray"
                                        >
                                          {row.artist}
                                        </Badge>
                                      ) : null}
                                    </Group>
                                    <Text size="sm" c="dimmed" lineClamp={2}>
                                      {row.description || "No description"}
                                    </Text>
                                  </Stack>
                                </Card>
                              ))}
                            </SimpleGrid>
                          ) : (
                            <Card withBorder p="sm">
                              <ScrollArea h={560}>
                                <Table
                                  striped
                                  highlightOnHover
                                  withTableBorder
                                  withColumnBorders
                                >
                                  <Table.Thead>
                                    <Table.Tr>
                                      <Table.Th>ID</Table.Th>
                                      <Table.Th>Title</Table.Th>
                                      <Table.Th>Artist</Table.Th>
                                      <Table.Th>Description</Table.Th>
                                      <Table.Th>Items</Table.Th>
                                      <Table.Th w={96}>Actions</Table.Th>
                                    </Table.Tr>
                                  </Table.Thead>
                                  <Table.Tbody>
                                    {playlistRowsPage.map((row) => (
                                      <Table.Tr
                                        key={row.id}
                                        onClick={() =>
                                          openPlaylistEditorRoute(row.id)
                                        }
                                        style={
                                          selectedPlaylistId === row.id
                                            ? {
                                                background:
                                                  "rgba(56, 132, 227, 0.18)",
                                                cursor: "pointer",
                                              }
                                            : { cursor: "pointer" }
                                        }
                                      >
                                        <Table.Td>
                                          <Text fw={600}>{row.id}</Text>
                                        </Table.Td>
                                        <Table.Td>
                                          {row.title || "untitled"}
                                        </Table.Td>
                                        <Table.Td>{row.artist || "—"}</Table.Td>
                                        <Table.Td>
                                          <Text
                                            size="sm"
                                            c="dimmed"
                                            lineClamp={1}
                                          >
                                            {row.description || "—"}
                                          </Text>
                                        </Table.Td>
                                        <Table.Td>
                                          {row.mediaIds.length}
                                        </Table.Td>
                                        <Table.Td>
                                          <Group gap={6}>
                                            <ActionIcon
                                              color="blue"
                                              variant="light"
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                openPlaylistEditorRoute(row.id);
                                              }}
                                              title="Open playlist editor"
                                            >
                                              <IconPencil size={14} />
                                            </ActionIcon>
                                            <ActionIcon
                                              color="cyan"
                                              variant="light"
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                openQuickSend({
                                                  kind: "playlist",
                                                  id: row.id,
                                                  label: row.title || row.id,
                                                });
                                              }}
                                              title="Send playlist to node"
                                            >
                                              <IconBroadcast size={14} />
                                            </ActionIcon>
                                            <ActionIcon
                                              color="red"
                                              variant="light"
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                deletePlaylistDraft(row.id);
                                              }}
                                              title="Delete playlist"
                                            >
                                              <IconTrash size={14} />
                                            </ActionIcon>
                                          </Group>
                                        </Table.Td>
                                      </Table.Tr>
                                    ))}
                                  </Table.Tbody>
                                </Table>
                              </ScrollArea>
                              <Group
                                justify="space-between"
                                mt="xs"
                                wrap="wrap"
                              >
                                <Text size="xs" c="dimmed">
                                  {tableRangeLabel(
                                    draftStore.playlists.length,
                                    playlistTablePage,
                                    TABLE_PAGE_SIZE.playlists
                                  )}
                                </Text>
                                <Pagination
                                  total={playlistTablePageCount}
                                  value={playlistTablePage}
                                  onChange={setPlaylistTablePage}
                                  size={isMobile ? "sm" : "md"}
                                  siblings={1}
                                  boundaries={1}
                                  withEdges
                                />
                              </Group>
                            </Card>
                          )}
                          {draftStore.playlists.length === 0 ? (
                            <Paper withBorder p="md">
                              <Text size="sm" c="dimmed">
                                No playlists yet. Create one to start assembling
                                programming.
                              </Text>
                            </Paper>
                          ) : null}
                        </>
                      )}
                    </Stack>
                  ) : null}

                  {builderTab === "playlistEditor" ? (
                    <Stack gap="md">
                      <Group justify="space-between" align="center" wrap="wrap">
                        <Stack gap={4}>
                          <Breadcrumbs separator="/" separatorMargin="xs">
                            <Anchor
                              size="sm"
                              href="#"
                              onClick={(event) => {
                                event.preventDefault();
                                closePlaylistEditorRoute();
                              }}
                            >
                              Media Library
                            </Anchor>
                            <Anchor
                              size="sm"
                              href="#"
                              onClick={(event) => {
                                event.preventDefault();
                                closePlaylistEditorRoute();
                              }}
                            >
                              Playlists
                            </Anchor>
                            <Text size="sm" c="dimmed">
                              {playlistDraft.id.trim() || "New Playlist"}
                            </Text>
                          </Breadcrumbs>
                          <Title order={5}>
                            {playlistDraft.title.trim() ||
                              playlistDraft.id.trim() ||
                              "New Playlist"}
                          </Title>
                        </Stack>
                        <Group gap="xs">
                          <Button
                            variant="light"
                            onClick={closePlaylistEditorRoute}
                          >
                            Back
                          </Button>
                          <Button
                            variant="light"
                            leftSection={<IconSearch size={16} />}
                            onClick={() => setMediaPickerOpen(true)}
                          >
                            Select Media
                          </Button>
                          <Button
                            onClick={() => {
                              const playlistId = playlistDraft.id.trim();
                              if (!playlistId) {
                                notifications.show({
                                  color: "red",
                                  title: "Playlist ID required",
                                  message:
                                    "Provide a playlist ID before saving.",
                                });
                                return;
                              }
                              setDraftStore((store) => ({
                                ...store,
                                playlists: [
                                  ...store.playlists.filter(
                                    (p) => p.id !== playlistId
                                  ),
                                  { ...playlistDraft, id: playlistId },
                                ],
                              }));
                              setSelectedPlaylistId(playlistId);
                              closePlaylistEditorRoute();
                              notifications.show({
                                color: "teal",
                                title: "Playlist saved",
                                message: playlistId,
                              });
                            }}
                          >
                            Save Playlist
                          </Button>
                        </Group>
                      </Group>

                      <Text size="sm" c="dimmed">
                        Build playlist order and metadata shown in info
                        overlays.
                      </Text>

                      <SimpleGrid cols={{ base: 1, md: 2 }}>
                        <TextInput
                          label="Playlist ID"
                          value={playlistDraft.id}
                          onChange={(e) => {
                            const value = e.currentTarget.value;
                            setPlaylistDraft((d) => ({ ...d, id: value }));
                          }}
                        />
                        <TextInput
                          label="Title"
                          value={playlistDraft.title}
                          onChange={(e) => {
                            const value = e.currentTarget.value;
                            setPlaylistDraft((d) => ({ ...d, title: value }));
                          }}
                        />
                        <TextInput
                          label="Artist"
                          value={playlistDraft.artist}
                          onChange={(e) => {
                            const value = e.currentTarget.value;
                            setPlaylistDraft((d) => ({ ...d, artist: value }));
                          }}
                        />
                        <TextInput
                          label="Description"
                          value={playlistDraft.description}
                          onChange={(e) => {
                            const value = e.currentTarget.value;
                            setPlaylistDraft((d) => ({
                              ...d,
                              description: value,
                            }));
                          }}
                        />
                      </SimpleGrid>

                      <Paper withBorder p="sm">
                        <Group justify="space-between" mb="xs">
                          <Text fw={700}>
                            Items ({playlistDraft.mediaIds.length})
                          </Text>
                          <Text size="xs" c="dimmed">
                            Drag to reorder
                          </Text>
                        </Group>
                        <ScrollArea
                          h={
                            isMobile
                              ? "max(260px, calc(100dvh - 520px))"
                              : "max(320px, calc(100dvh - 460px))"
                          }
                        >
                          <Stack gap="xs">
                            {playlistDraft.mediaIds.map((id, index) => {
                              const media = mergedMedia.find(
                                (row) => row.id === id
                              );
                              return (
                                <div
                                  key={`${id}-${index}`}
                                  className="ops-playlist-item-wrap"
                                >
                                  {playlistDragIndex !== null &&
                                  playlistDropIndex === index ? (
                                    <div className="ops-playlist-drop-indicator" />
                                  ) : null}
                                  <Paper
                                    withBorder
                                    p="sm"
                                    draggable
                                    onDragStart={() => {
                                      setPlaylistDragIndex(index);
                                      setPlaylistDropIndex(index);
                                    }}
                                    onDragOver={(event) => {
                                      event.preventDefault();
                                      if (playlistDragIndex === null) return;
                                      const rect =
                                        event.currentTarget.getBoundingClientRect();
                                      const midpoint =
                                        rect.top + rect.height / 2;
                                      const nextDropIndex =
                                        event.clientY < midpoint
                                          ? index
                                          : index + 1;
                                      setPlaylistDropIndex((prev) =>
                                        prev === nextDropIndex
                                          ? prev
                                          : nextDropIndex
                                      );
                                    }}
                                    onDrop={(event) => {
                                      event.preventDefault();
                                      commitPlaylistDrop(
                                        playlistDropIndex ?? index
                                      );
                                    }}
                                    onDragEnd={() => {
                                      setPlaylistDragIndex(null);
                                      setPlaylistDropIndex(null);
                                    }}
                                  >
                                    <Group
                                      justify="space-between"
                                      wrap="nowrap"
                                    >
                                      <Group gap="sm" wrap="nowrap">
                                        <ActionIcon
                                          variant="subtle"
                                          color="gray"
                                          title="Drag to reorder"
                                          style={{ cursor: "grab" }}
                                        >
                                          <IconGripVertical size={16} />
                                        </ActionIcon>
                                        {media?.thumbnailUrl ? (
                                          <Image
                                            src={media.thumbnailUrl}
                                            alt={media.title || id}
                                            radius="sm"
                                            w={88}
                                            h={52}
                                            fit="cover"
                                          />
                                        ) : null}
                                        <Stack gap={1}>
                                          <Text fw={700}>
                                            {index + 1}. {id}
                                          </Text>
                                          <Text size="xs" c="dimmed">
                                            {media?.title || "untitled"} •{" "}
                                            {media?.artist || "unknown artist"}
                                          </Text>
                                        </Stack>
                                      </Group>
                                      <ActionIcon
                                        color="red"
                                        variant="light"
                                        onClick={() =>
                                          setPlaylistDraft((d) => ({
                                            ...d,
                                            mediaIds: d.mediaIds.filter(
                                              (_, i) => i !== index
                                            ),
                                          }))
                                        }
                                      >
                                        <IconTrash size={14} />
                                      </ActionIcon>
                                    </Group>
                                  </Paper>
                                </div>
                              );
                            })}
                            {playlistDragIndex !== null ? (
                              <div
                                className="ops-playlist-drop-tail is-active"
                                onDragOver={(event) => {
                                  event.preventDefault();
                                  setPlaylistDropIndex((prev) =>
                                    prev === playlistDraft.mediaIds.length
                                      ? prev
                                      : playlistDraft.mediaIds.length
                                  );
                                }}
                                onDrop={(event) => {
                                  event.preventDefault();
                                  commitPlaylistDrop(
                                    playlistDropIndex ??
                                      playlistDraft.mediaIds.length
                                  );
                                }}
                              >
                                {playlistDropIndex ===
                                playlistDraft.mediaIds.length ? (
                                  <div className="ops-playlist-drop-indicator is-tail" />
                                ) : (
                                  <div className="ops-playlist-drop-tail-placeholder">
                                    Drop at end
                                  </div>
                                )}
                              </div>
                            ) : null}
                          </Stack>
                        </ScrollArea>
                      </Paper>
                    </Stack>
                  ) : null}

                  {builderTab === "mediaDetail" ? (
                    <Stack gap="md">
                      <Group justify="space-between" align="center" wrap="wrap">
                        <Button
                          variant="light"
                          onClick={() => setBuilderTab("media")}
                        >
                          Back To Media Library
                        </Button>
                        {selectedMediaDetail ? (
                          <Group gap="xs">
                            <Button
                              color="cyan"
                              variant="light"
                              leftSection={<IconBroadcast size={14} />}
                              onClick={() =>
                                openQuickSend({
                                  kind: "media",
                                  id: selectedMediaDetail.id,
                                  label:
                                    selectedMediaDetail.title ||
                                    selectedMediaDetail.id,
                                })
                              }
                            >
                              Send To Node
                            </Button>
                            <Button
                              color="red"
                              variant="light"
                              loading={mediaDeleteBusy}
                              onClick={() =>
                                void deleteMediaItem(selectedMediaDetail.id)
                              }
                            >
                              Delete Media
                            </Button>
                          </Group>
                        ) : null}
                      </Group>
                      {selectedMediaDetail ? (
                        <Card withBorder p="md">
                          <Stack>
                            {selectedMediaDetailPreviewSrc ? (
                              <video
                                className="ops-media-detail-video"
                                controls
                                muted
                                loop
                                playsInline
                                preload="metadata"
                                poster={selectedMediaDetail.thumbnailUrl}
                                src={selectedMediaDetailPreviewSrc}
                              />
                            ) : selectedMediaDetail.thumbnailUrl ? (
                              <Image
                                src={selectedMediaDetail.thumbnailUrl}
                                alt={
                                  selectedMediaDetail.title ||
                                  selectedMediaDetail.id
                                }
                                radius="sm"
                                h={isMobile ? 240 : 520}
                                fit="cover"
                              />
                            ) : null}
                            <SimpleGrid cols={{ base: 1, md: 2 }}>
                              <TextInput
                                label="ID"
                                value={selectedMediaDetail.id}
                                readOnly
                              />
                              <TextInput
                                label="Type"
                                value={selectedMediaDetail.sourceType}
                                readOnly
                              />
                              <TextInput
                                label="Title"
                                value={selectedMediaDetail.title || ""}
                                readOnly
                              />
                              <TextInput
                                label="Artist"
                                value={selectedMediaDetail.artist || ""}
                                readOnly
                              />
                            </SimpleGrid>
                            <Stack gap={4}>
                              <Text size="sm" fw={600}>
                                Source
                              </Text>
                              <Code block>
                                {selectedMediaDetail.sourceValue}
                              </Code>
                            </Stack>
                            <Text size="sm" c="dimmed">
                              {selectedMediaDetail.description ||
                                "No description"}
                            </Text>
                            <Code block>
                              {JSON.stringify(selectedMediaDetail, null, 2)}
                            </Code>
                          </Stack>
                        </Card>
                      ) : (
                        <Paper withBorder p="md">
                          <Text size="sm" c="dimmed">
                            Media item not found.
                          </Text>
                        </Paper>
                      )}
                    </Stack>
                  ) : null}

                  {builderTab === "mediaTable" ? (
                    <Stack>
                      <Title order={5}>Media Index</Title>
                      <Card withBorder p="sm">
                        <ScrollArea h={560}>
                          <Table
                            striped
                            highlightOnHover
                            withTableBorder
                            withColumnBorders
                          >
                            <Table.Thead>
                              <Table.Tr>
                                <Table.Th>ID</Table.Th>
                                <Table.Th>Title</Table.Th>
                                <Table.Th>Artist</Table.Th>
                                <Table.Th>Source</Table.Th>
                                <Table.Th>Cache</Table.Th>
                              </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                              {mediaTableRowsPage.map((row) => (
                                <Table.Tr
                                  key={row.id}
                                  style={{ cursor: "pointer" }}
                                  onClick={() => {
                                    setSelectedServerMediaId(row.id);
                                    setMediaDetailId(row.id);
                                    setBuilderTab("mediaDetail");
                                  }}
                                >
                                  <Table.Td>
                                    <Text fw={600}>{row.id}</Text>
                                  </Table.Td>
                                  <Table.Td>{row.title || "untitled"}</Table.Td>
                                  <Table.Td>{row.artist || "—"}</Table.Td>
                                  <Table.Td>
                                    <Text
                                      size="xs"
                                      ff="monospace"
                                      c="dimmed"
                                      lineClamp={1}
                                    >
                                      {row.sourceType}:{row.sourceValue}
                                    </Text>
                                  </Table.Td>
                                  <Table.Td>
                                    {row.cache ? "yes" : "no"}
                                  </Table.Td>
                                </Table.Tr>
                              ))}
                            </Table.Tbody>
                          </Table>
                        </ScrollArea>
                        <Group justify="space-between" mt="xs" wrap="wrap">
                          <Text size="xs" c="dimmed">
                            {tableRangeLabel(
                              serverMedia.length,
                              mediaTablePage,
                              TABLE_PAGE_SIZE.media
                            )}
                          </Text>
                          <Pagination
                            total={mediaTablePageCount}
                            value={mediaTablePage}
                            onChange={setMediaTablePage}
                            size={isMobile ? "sm" : "md"}
                            siblings={1}
                            boundaries={1}
                            withEdges
                          />
                        </Group>
                      </Card>
                    </Stack>
                  ) : null}

                  {builderTab === "playlist" ? (
                    <Stack>
                      <Group justify="space-between">
                        <Title order={5}>Playlists</Title>
                        <Button
                          size="xs"
                          variant="light"
                          onClick={() => {
                            openPlaylistEditorRoute();
                          }}
                        >
                          New Playlist
                        </Button>
                      </Group>
                      <Card withBorder p="sm">
                        <ScrollArea h={560}>
                          <Table
                            striped
                            highlightOnHover
                            withTableBorder
                            withColumnBorders
                          >
                            <Table.Thead>
                              <Table.Tr>
                                <Table.Th>ID</Table.Th>
                                <Table.Th>Title</Table.Th>
                                <Table.Th>Artist</Table.Th>
                                <Table.Th>Description</Table.Th>
                                <Table.Th>Items</Table.Th>
                                <Table.Th w={96}>Actions</Table.Th>
                              </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                              {playlistRowsPage.map((row) => (
                                <Table.Tr
                                  key={row.id}
                                  onClick={() =>
                                    openPlaylistEditorRoute(row.id)
                                  }
                                  style={
                                    selectedPlaylistId === row.id
                                      ? {
                                          background:
                                            "rgba(56, 132, 227, 0.18)",
                                          cursor: "pointer",
                                        }
                                      : { cursor: "pointer" }
                                  }
                                >
                                  <Table.Td>
                                    <Text fw={600}>{row.id}</Text>
                                  </Table.Td>
                                  <Table.Td>{row.title || "untitled"}</Table.Td>
                                  <Table.Td>{row.artist || "—"}</Table.Td>
                                  <Table.Td>
                                    <Text size="sm" c="dimmed" lineClamp={1}>
                                      {row.description || "—"}
                                    </Text>
                                  </Table.Td>
                                  <Table.Td>{row.mediaIds.length}</Table.Td>
                                  <Table.Td>
                                    <Group gap={6}>
                                      <ActionIcon
                                        color="blue"
                                        variant="light"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          openPlaylistEditorRoute(row.id);
                                        }}
                                        title="Open playlist editor"
                                      >
                                        <IconPencil size={14} />
                                      </ActionIcon>
                                      <ActionIcon
                                        color="red"
                                        variant="light"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setDraftStore((store) => ({
                                            ...store,
                                            playlists: store.playlists.filter(
                                              (item) => item.id !== row.id
                                            ),
                                          }));
                                        }}
                                        title="Delete playlist"
                                      >
                                        <IconTrash size={14} />
                                      </ActionIcon>
                                    </Group>
                                  </Table.Td>
                                </Table.Tr>
                              ))}
                            </Table.Tbody>
                          </Table>
                        </ScrollArea>
                        <Group justify="space-between" mt="xs" wrap="wrap">
                          <Text size="xs" c="dimmed">
                            {tableRangeLabel(
                              draftStore.playlists.length,
                              playlistTablePage,
                              TABLE_PAGE_SIZE.playlists
                            )}
                          </Text>
                          <Pagination
                            total={playlistTablePageCount}
                            value={playlistTablePage}
                            onChange={setPlaylistTablePage}
                            size={isMobile ? "sm" : "md"}
                            siblings={1}
                            boundaries={1}
                            withEdges
                          />
                        </Group>
                      </Card>
                    </Stack>
                  ) : null}

                  {builderTab === "block" ? (
                    <Stack>
                      <Group justify="space-between">
                        <Title order={5}>Block Editor</Title>
                        <Button
                          size="xs"
                          variant="light"
                          onClick={() => {
                            setSelectedBlockId(null);
                            setBlockDraft(EMPTY_BLOCK_DRAFT);
                          }}
                        >
                          New Block
                        </Button>
                      </Group>
                      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
                        <Card withBorder p="sm">
                          <Text fw={600} mb="xs">
                            Blocks ({draftStore.blocks.length})
                          </Text>
                          <ScrollArea h={240}>
                            <Table
                              striped
                              highlightOnHover
                              withTableBorder
                              withColumnBorders
                            >
                              <Table.Thead>
                                <Table.Tr>
                                  <Table.Th>ID</Table.Th>
                                  <Table.Th>Title</Table.Th>
                                  <Table.Th>Playlists</Table.Th>
                                  <Table.Th w={96}>Actions</Table.Th>
                                </Table.Tr>
                              </Table.Thead>
                              <Table.Tbody>
                                {blockRowsPage.map((row) => (
                                  <Table.Tr
                                    key={row.id}
                                    onClick={() => openBlockEditor(row.id)}
                                    style={
                                      selectedBlockId === row.id
                                        ? {
                                            background:
                                              "rgba(56, 132, 227, 0.18)",
                                            cursor: "pointer",
                                          }
                                        : { cursor: "pointer" }
                                    }
                                  >
                                    <Table.Td>
                                      <Text fw={600}>{row.id}</Text>
                                    </Table.Td>
                                    <Table.Td>
                                      <Text size="sm" c="dimmed">
                                        {row.title || "untitled"}
                                      </Text>
                                    </Table.Td>
                                    <Table.Td>
                                      {row.playlistIds.length}
                                    </Table.Td>
                                    <Table.Td>
                                      <Group gap={6}>
                                        <ActionIcon
                                          color="blue"
                                          variant="light"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            openBlockEditor(row.id);
                                          }}
                                          title="Edit block"
                                        >
                                          <IconPencil size={14} />
                                        </ActionIcon>
                                        <ActionIcon
                                          color="red"
                                          variant="light"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setDraftStore((store) => ({
                                              ...store,
                                              blocks: store.blocks.filter(
                                                (item) => item.id !== row.id
                                              ),
                                            }));
                                          }}
                                          title="Delete block"
                                        >
                                          <IconTrash size={14} />
                                        </ActionIcon>
                                      </Group>
                                    </Table.Td>
                                  </Table.Tr>
                                ))}
                              </Table.Tbody>
                            </Table>
                          </ScrollArea>
                          <Group justify="space-between" mt="xs" wrap="wrap">
                            <Text size="xs" c="dimmed">
                              {tableRangeLabel(
                                draftStore.blocks.length,
                                blockTablePage,
                                TABLE_PAGE_SIZE.blocks
                              )}
                            </Text>
                            <Pagination
                              total={blockTablePageCount}
                              value={blockTablePage}
                              onChange={setBlockTablePage}
                              size={isMobile ? "sm" : "md"}
                              siblings={1}
                              boundaries={1}
                              withEdges
                            />
                          </Group>
                        </Card>
                        <Card withBorder p="sm">
                          <Stack>
                            <TextInput
                              label="Block ID"
                              value={blockDraft.id}
                              onChange={(e) => {
                                const value = e.currentTarget.value;
                                setBlockDraft((d) => ({ ...d, id: value }));
                              }}
                            />
                            <TextInput
                              label="Title"
                              value={blockDraft.title}
                              onChange={(e) => {
                                const value = e.currentTarget.value;
                                setBlockDraft((d) => ({ ...d, title: value }));
                              }}
                            />
                            <Select
                              label="Add playlist"
                              searchable
                              data={draftStore.playlists.map((p) => ({
                                value: p.id,
                                label: `${p.id} • ${p.title || "untitled"}`,
                              }))}
                              onChange={(value) => {
                                if (!value) return;
                                setBlockDraft((d) => ({
                                  ...d,
                                  playlistIds: Array.from(
                                    new Set([...d.playlistIds, value])
                                  ),
                                }));
                              }}
                            />
                            <Group gap={6}>
                              {blockDraft.playlistIds.map((id) => (
                                <Badge
                                  key={id}
                                  variant="light"
                                  rightSection={
                                    <ActionIcon
                                      color="gray"
                                      variant="transparent"
                                      size="xs"
                                      onClick={() =>
                                        setBlockDraft((d) => ({
                                          ...d,
                                          playlistIds: d.playlistIds.filter(
                                            (x) => x !== id
                                          ),
                                        }))
                                      }
                                    >
                                      ×
                                    </ActionIcon>
                                  }
                                >
                                  {id}
                                </Badge>
                              ))}
                            </Group>
                            <Button
                              onClick={() => {
                                const blockId = blockDraft.id.trim();
                                if (!blockId) return;
                                setDraftStore((store) => ({
                                  ...store,
                                  blocks: [
                                    ...store.blocks.filter(
                                      (b) => b.id !== blockId
                                    ),
                                    { ...blockDraft, id: blockId },
                                  ],
                                }));
                                setSelectedBlockId(blockId);
                                notifications.show({
                                  color: "teal",
                                  title: "Block saved",
                                  message: blockId,
                                });
                              }}
                            >
                              Save Block
                            </Button>
                          </Stack>
                        </Card>
                      </SimpleGrid>
                    </Stack>
                  ) : null}

                  {builderTab === "channel" ? (
                    <Stack>
                      <Group justify="space-between">
                        <Title order={5}>Channel Editor</Title>
                        <Button
                          size="xs"
                          variant="light"
                          onClick={() => {
                            setSelectedChannelId(null);
                            setChannelDraft(EMPTY_CHANNEL_DRAFT);
                          }}
                        >
                          New Channel
                        </Button>
                      </Group>
                      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
                        <Card withBorder p="sm">
                          <Text fw={600} mb="xs">
                            Channels ({draftStore.channels.length})
                          </Text>
                          <ScrollArea h={240}>
                            <Table
                              striped
                              highlightOnHover
                              withTableBorder
                              withColumnBorders
                            >
                              <Table.Thead>
                                <Table.Tr>
                                  <Table.Th>ID</Table.Th>
                                  <Table.Th>Title</Table.Th>
                                  <Table.Th>Blocks</Table.Th>
                                  <Table.Th w={96}>Actions</Table.Th>
                                </Table.Tr>
                              </Table.Thead>
                              <Table.Tbody>
                                {channelRowsPage.map((row) => (
                                  <Table.Tr
                                    key={row.id}
                                    onClick={() => openChannelEditor(row.id)}
                                    style={
                                      selectedChannelId === row.id
                                        ? {
                                            background:
                                              "rgba(56, 132, 227, 0.18)",
                                            cursor: "pointer",
                                          }
                                        : { cursor: "pointer" }
                                    }
                                  >
                                    <Table.Td>
                                      <Text fw={600}>{row.id}</Text>
                                    </Table.Td>
                                    <Table.Td>
                                      <Text size="sm" c="dimmed">
                                        {row.title || "untitled"}
                                      </Text>
                                    </Table.Td>
                                    <Table.Td>{row.blockIds.length}</Table.Td>
                                    <Table.Td>
                                      <Group gap={6}>
                                        <ActionIcon
                                          color="blue"
                                          variant="light"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            openChannelEditor(row.id);
                                          }}
                                          title="Edit channel"
                                        >
                                          <IconPencil size={14} />
                                        </ActionIcon>
                                        <ActionIcon
                                          color="red"
                                          variant="light"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setDraftStore((store) => ({
                                              ...store,
                                              channels: store.channels.filter(
                                                (item) => item.id !== row.id
                                              ),
                                            }));
                                          }}
                                          title="Delete channel"
                                        >
                                          <IconTrash size={14} />
                                        </ActionIcon>
                                      </Group>
                                    </Table.Td>
                                  </Table.Tr>
                                ))}
                              </Table.Tbody>
                            </Table>
                          </ScrollArea>
                          <Group justify="space-between" mt="xs" wrap="wrap">
                            <Text size="xs" c="dimmed">
                              {tableRangeLabel(
                                draftStore.channels.length,
                                channelTablePage,
                                TABLE_PAGE_SIZE.channels
                              )}
                            </Text>
                            <Pagination
                              total={channelTablePageCount}
                              value={channelTablePage}
                              onChange={setChannelTablePage}
                              size={isMobile ? "sm" : "md"}
                              siblings={1}
                              boundaries={1}
                              withEdges
                            />
                          </Group>
                        </Card>
                        <Card withBorder p="sm">
                          <Stack>
                            <TextInput
                              label="Channel ID"
                              value={channelDraft.id}
                              onChange={(e) => {
                                const value = e.currentTarget.value;
                                setChannelDraft((d) => ({ ...d, id: value }));
                              }}
                            />
                            <TextInput
                              label="Title"
                              value={channelDraft.title}
                              onChange={(e) => {
                                const value = e.currentTarget.value;
                                setChannelDraft((d) => ({
                                  ...d,
                                  title: value,
                                }));
                              }}
                            />
                            <Select
                              label="Add block"
                              searchable
                              data={draftStore.blocks.map((b) => ({
                                value: b.id,
                                label: `${b.id} • ${b.title || "untitled"}`,
                              }))}
                              onChange={(value) => {
                                if (!value) return;
                                setChannelDraft((d) => ({
                                  ...d,
                                  blockIds: Array.from(
                                    new Set([...d.blockIds, value])
                                  ),
                                }));
                              }}
                            />
                            <Group gap={6}>
                              {channelDraft.blockIds.map((id) => (
                                <Badge
                                  key={id}
                                  variant="light"
                                  rightSection={
                                    <ActionIcon
                                      color="gray"
                                      variant="transparent"
                                      size="xs"
                                      onClick={() =>
                                        setChannelDraft((d) => ({
                                          ...d,
                                          blockIds: d.blockIds.filter(
                                            (x) => x !== id
                                          ),
                                        }))
                                      }
                                    >
                                      ×
                                    </ActionIcon>
                                  }
                                >
                                  {id}
                                </Badge>
                              ))}
                            </Group>
                            <Button
                              onClick={() => {
                                const channelId = channelDraft.id.trim();
                                if (!channelId) return;
                                setDraftStore((store) => ({
                                  ...store,
                                  channels: [
                                    ...store.channels.filter(
                                      (c) => c.id !== channelId
                                    ),
                                    { ...channelDraft, id: channelId },
                                  ],
                                }));
                                setSelectedChannelId(channelId);
                                notifications.show({
                                  color: "teal",
                                  title: "Channel saved",
                                  message: channelId,
                                });
                              }}
                            >
                              Save Channel
                            </Button>
                          </Stack>
                        </Card>
                      </SimpleGrid>
                    </Stack>
                  ) : null}

                  {builderTab === "profile" ? (
                    <Stack>
                      <Group justify="space-between">
                        <Title order={5}>Profile Editor</Title>
                        <Button
                          size="xs"
                          variant="light"
                          onClick={() => {
                            setSelectedProfileId(null);
                            setProfileDraft(EMPTY_PROFILE_DRAFT);
                          }}
                        >
                          New Profile
                        </Button>
                      </Group>
                      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
                        <Card withBorder p="sm">
                          <Text fw={600} mb="xs">
                            Profiles ({draftStore.profiles.length})
                          </Text>
                          <ScrollArea h={240}>
                            <Table
                              striped
                              highlightOnHover
                              withTableBorder
                              withColumnBorders
                            >
                              <Table.Thead>
                                <Table.Tr>
                                  <Table.Th>ID</Table.Th>
                                  <Table.Th>Title</Table.Th>
                                  <Table.Th>Default target</Table.Th>
                                  <Table.Th w={96}>Actions</Table.Th>
                                </Table.Tr>
                              </Table.Thead>
                              <Table.Tbody>
                                {profileRowsPage.map((row) => (
                                  <Table.Tr
                                    key={row.id}
                                    onClick={() => openProfileEditor(row.id)}
                                    style={
                                      selectedProfileId === row.id
                                        ? {
                                            background:
                                              "rgba(56, 132, 227, 0.18)",
                                            cursor: "pointer",
                                          }
                                        : { cursor: "pointer" }
                                    }
                                  >
                                    <Table.Td>
                                      <Text fw={600}>{row.id}</Text>
                                    </Table.Td>
                                    <Table.Td>
                                      <Text size="sm" c="dimmed">
                                        {row.title || "untitled"}
                                      </Text>
                                    </Table.Td>
                                    <Table.Td>
                                      <Text size="sm" c="dimmed">
                                        {row.defaultTargetKind}:
                                        {row.defaultTargetId || "unset"}
                                      </Text>
                                    </Table.Td>
                                    <Table.Td>
                                      <Group gap={6}>
                                        <ActionIcon
                                          color="blue"
                                          variant="light"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            openProfileEditor(row.id);
                                          }}
                                          title="Edit profile"
                                        >
                                          <IconPencil size={14} />
                                        </ActionIcon>
                                        <ActionIcon
                                          color="red"
                                          variant="light"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setDraftStore((store) => ({
                                              ...store,
                                              profiles: store.profiles.filter(
                                                (item) => item.id !== row.id
                                              ),
                                            }));
                                          }}
                                          title="Delete profile"
                                        >
                                          <IconTrash size={14} />
                                        </ActionIcon>
                                      </Group>
                                    </Table.Td>
                                  </Table.Tr>
                                ))}
                              </Table.Tbody>
                            </Table>
                          </ScrollArea>
                          <Group justify="space-between" mt="xs" wrap="wrap">
                            <Text size="xs" c="dimmed">
                              {tableRangeLabel(
                                draftStore.profiles.length,
                                profileTablePage,
                                TABLE_PAGE_SIZE.profiles
                              )}
                            </Text>
                            <Pagination
                              total={profileTablePageCount}
                              value={profileTablePage}
                              onChange={setProfileTablePage}
                              size={isMobile ? "sm" : "md"}
                              siblings={1}
                              boundaries={1}
                              withEdges
                            />
                          </Group>
                        </Card>
                        <Card withBorder p="sm">
                          <Stack>
                            <TextInput
                              label="Profile ID"
                              value={profileDraft.id}
                              onChange={(e) => {
                                const value = e.currentTarget.value;
                                setProfileDraft((d) => ({ ...d, id: value }));
                              }}
                            />
                            <TextInput
                              label="Title"
                              value={profileDraft.title}
                              onChange={(e) => {
                                const value = e.currentTarget.value;
                                setProfileDraft((d) => ({
                                  ...d,
                                  title: value,
                                }));
                              }}
                            />
                            <Select
                              label="Default target kind"
                              data={[
                                { value: "media", label: "media" },
                                { value: "playlist", label: "playlist" },
                                { value: "block", label: "block" },
                                { value: "channel", label: "channel" },
                              ]}
                              value={profileDraft.defaultTargetKind}
                              onChange={(value) =>
                                setProfileDraft((d) => ({
                                  ...d,
                                  defaultTargetKind:
                                    (value as
                                      | "media"
                                      | "playlist"
                                      | "block"
                                      | "channel") || d.defaultTargetKind,
                                }))
                              }
                            />
                            <TextInput
                              label="Default target id"
                              value={profileDraft.defaultTargetId}
                              onChange={(e) => {
                                const value = e.currentTarget.value;
                                setProfileDraft((d) => ({
                                  ...d,
                                  defaultTargetId: value,
                                }));
                              }}
                            />
                            <Select
                              label="Suggested target id"
                              searchable
                              data={profileTargetOptions}
                              onChange={(value) =>
                                setProfileDraft((d) => ({
                                  ...d,
                                  defaultTargetId: value || d.defaultTargetId,
                                }))
                              }
                            />
                            <Button
                              onClick={() => {
                                const profileId = profileDraft.id.trim();
                                if (!profileId) return;
                                setDraftStore((store) => ({
                                  ...store,
                                  profiles: [
                                    ...store.profiles.filter(
                                      (p) => p.id !== profileId
                                    ),
                                    { ...profileDraft, id: profileId },
                                  ],
                                }));
                                setSelectedProfileId(profileId);
                                notifications.show({
                                  color: "teal",
                                  title: "Profile saved",
                                  message: profileId,
                                });
                              }}
                            >
                              Save Profile
                            </Button>
                          </Stack>
                        </Card>
                      </SimpleGrid>
                    </Stack>
                  ) : null}
                </Stack>
              </Paper>
            </SimpleGrid>
          </Tabs.Panel>
        </Tabs>
      </AppShell.Main>

      <MediaPickerModal
        opened={mediaPickerOpen}
        onClose={() => setMediaPickerOpen(false)}
        media={pickerMedia}
        selectedIds={playlistDraft.mediaIds}
        onApply={(mediaIds) =>
          setPlaylistDraft((current) => ({
            ...current,
            mediaIds,
          }))
        }
      />

      <ResourcePickerModal
        opened={targetPickerOpen}
        onClose={() => setTargetPickerOpen(false)}
        title={`Select ${applyKind}`}
        items={applyResourcePickerItems}
        selectedIds={applyId ? [applyId] : []}
        multi={false}
        applyLabel="Use selected target"
        onApply={(ids) => setApplyId(ids[0] || "")}
      />

      <Modal
        opened={quickSendOpen}
        onClose={() => setQuickSendOpen(false)}
        title={
          quickSendTarget
            ? `Send ${quickSendTarget.kind} to nodes`
            : "Send to nodes"
        }
        size={isMobile ? "100%" : "lg"}
      >
        <Stack gap="md">
          <TextInput
            leftSection={<IconSearch size={16} />}
            placeholder="Filter nodes by id/host/ip"
            value={quickSendQuery}
            onChange={(event) => setQuickSendQuery(event.currentTarget.value)}
          />
          <ScrollArea h={320}>
            <Stack gap="xs">
              {quickSendRows.map((row) => {
                const checked = quickSendNodeIds.includes(row.id);
                return (
                  <Card
                    key={`quick-send-${row.id}`}
                    withBorder
                    p="xs"
                    className={`ops-media-card${checked ? " is-selected" : ""}`}
                    onClick={() =>
                      setQuickSendNodeIds((prev) => {
                        if (prev.includes(row.id))
                          return prev.filter((id) => id !== row.id);
                        return [...prev, row.id];
                      })
                    }
                  >
                    <Group justify="space-between" align="center" wrap="nowrap">
                      <Stack gap={2}>
                        <Text fw={600}>{row.id}</Text>
                        <Text size="xs" c="dimmed">
                          {row.nodeName || row.host || row.ip || "node"}
                        </Text>
                      </Stack>
                      <Checkbox
                        checked={checked}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() =>
                          setQuickSendNodeIds((prev) => {
                            if (prev.includes(row.id))
                              return prev.filter((id) => id !== row.id);
                            return [...prev, row.id];
                          })
                        }
                      />
                    </Group>
                  </Card>
                );
              })}
              {quickSendRows.length === 0 ? (
                <Text size="sm" c="dimmed">
                  No nodes match this filter.
                </Text>
              ) : null}
            </Stack>
          </ScrollArea>
          <Group justify="space-between" align="center">
            <Text size="sm" c="dimmed">
              {quickSendNodeIds.length} selected
            </Text>
            <Group gap="xs">
              <Button variant="light" onClick={() => setQuickSendOpen(false)}>
                Cancel
              </Button>
              <Button
                leftSection={<IconBroadcast size={14} />}
                loading={quickSendBusy}
                disabled={!quickSendTarget || quickSendNodeIds.length === 0}
                onClick={() => void runQuickSend()}
              >
                Send to selected
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={nodeEditorOpen}
        onClose={() => setNodeEditorOpen(false)}
        title={editingNodeId ? `Edit Node • ${editingNodeId}` : "Add Node"}
        size={isMobile ? "100%" : "xl"}
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Node records drive fleet probing, deployments, and profile
            overrides. Define identity first, then network/runtime settings.
          </Text>

          <Paper withBorder p="md" radius="md">
            <Stack gap="sm">
              <Group justify="space-between">
                <Title order={6}>Identity</Title>
                <Badge color="red" variant="light">
                  Required
                </Badge>
              </Group>
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput
                  label="Registry ID"
                  placeholder="local"
                  value={nodeDraft.registryId}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setNodeDraft((prev) => ({ ...prev, registryId: value }));
                  }}
                />
                <TextInput
                  label="Node ID"
                  description="Unique stable node identifier"
                  placeholder="upper-east-1"
                  value={nodeDraft.nodeId}
                  disabled={Boolean(editingNodeId)}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setNodeDraft((prev) => ({ ...prev, nodeId: value }));
                  }}
                />
                <TextInput
                  label="Node name"
                  placeholder="Upper East 1"
                  value={nodeDraft.nodeName}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setNodeDraft((prev) => ({ ...prev, nodeName: value }));
                  }}
                />
                <Select
                  label="Orientation"
                  placeholder="Choose orientation"
                  data={[
                    { value: "landscape", label: "landscape" },
                    { value: "portrait", label: "portrait" },
                  ]}
                  value={nodeDraft.orientation || null}
                  onChange={(value) =>
                    setNodeDraft((prev) => ({
                      ...prev,
                      orientation: value || "",
                    }))
                  }
                  clearable
                />
              </SimpleGrid>
            </Stack>
          </Paper>

          <Paper withBorder p="md" radius="md">
            <Stack gap="sm">
              <Title order={6}>Network</Title>
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <TextInput
                  label="Host"
                  placeholder="upper-east-1.local"
                  value={nodeDraft.host}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setNodeDraft((prev) => ({ ...prev, host: value }));
                  }}
                />
                <TextInput
                  label="IP"
                  placeholder="10.0.0.21"
                  value={nodeDraft.ip}
                  onChange={(e) => {
                    const value = e.currentTarget.value;
                    setNodeDraft((prev) => ({ ...prev, ip: value }));
                  }}
                />
              </SimpleGrid>
            </Stack>
          </Paper>

          <Paper withBorder p="md" radius="md">
            <Stack gap="sm">
              <Title order={6}>Node Runtime</Title>
              <Text size="sm" c="dimmed">
                Configure node-local runtime only. Guide/Cable app endpoints are
                server-hosted and not configured per node.
              </Text>
              <SimpleGrid cols={{ base: 1, sm: 2 }}>
                <NumberInput
                  label="Node API port"
                  placeholder="8080"
                  value={nodeDraft.nodePort}
                  onChange={(value) =>
                    setNodeDraft((prev) => ({
                      ...prev,
                      nodePort:
                        typeof value === "number" && Number.isFinite(value)
                          ? value
                          : undefined,
                    }))
                  }
                  min={1}
                  max={65535}
                />
                <Select
                  label="Display rotate"
                  data={[
                    { value: "", label: "inherit/default" },
                    { value: "0", label: "0" },
                    { value: "90", label: "90" },
                    { value: "180", label: "180" },
                    { value: "270", label: "270" },
                  ]}
                  value={nodeDraft.displayRotate}
                  onChange={(value) =>
                    setNodeDraft((prev) => ({
                      ...prev,
                      displayRotate:
                        (value as "" | "0" | "90" | "180" | "270") || "",
                    }))
                  }
                />
              </SimpleGrid>
            </Stack>
          </Paper>

          <Paper withBorder p="md" radius="md">
            <Stack gap="sm">
              <Group justify="space-between">
                <Title order={6}>Security</Title>
                <Badge color="gray" variant="light">
                  Optional
                </Badge>
              </Group>
              <TextInput
                label="API key"
                placeholder="Used for node-side protected endpoints"
                value={nodeDraft.apiKey}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setNodeDraft((prev) => ({ ...prev, apiKey: value }));
                }}
              />
            </Stack>
          </Paper>

          <Group justify="space-between">
            <Button variant="light" onClick={() => setNodeEditorOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void saveNodeDraft()}
              loading={nodeSaving}
              disabled={
                !nodeDraft.registryId.trim() || !nodeDraft.nodeId.trim()
              }
            >
              {editingNodeId ? "Save Node" : "Create Node"}
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={Boolean(selectedNode)}
        onClose={() => setActiveNodeId(null)}
        title={
          selectedNode
            ? `Node Inspector • ${selectedNode.id}`
            : "Node Inspector"
        }
        size={isMobile ? "100%" : "xl"}
      >
        {selectedNode ? (
          <Stack>
            <Breadcrumbs separator="›">
              <Anchor
                size="sm"
                c="dimmed"
                href="#"
                onClick={(event) => {
                  event.preventDefault();
                  setActiveNodeId(null);
                }}
              >
                Node Workspace
              </Anchor>
              <Text size="sm">Node Inspector</Text>
              <Text size="sm" fw={600}>
                {selectedNode.id}
              </Text>
            </Breadcrumbs>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <Card withBorder>
                <Text size="sm" c="dimmed">
                  Runtime target
                </Text>
                <Text fw={700}>
                  {parseTargetFromKioskUrl(
                    selectedNode.chibaNode.kioskUrl ?? null
                  )}
                </Text>
                <Text size="xs" c="dimmed" ff="monospace">
                  {selectedNode.chibaNode.kioskUrl || "—"}
                </Text>
              </Card>
              <Card withBorder>
                <Text size="sm" c="dimmed">
                  Connectivity
                </Text>
                <Group gap={6} mt={6}>
                  {statusBadge(selectedNode.dnsOk, "DNS", "DNS")}
                  {statusBadge(selectedNode.ping.ok, "Ping", "Ping")}
                  {statusBadge(selectedNode.tcp.ssh22.ok, "SSH", "SSH")}
                  {statusBadge(
                    selectedNode.http.nodeStatus.ok,
                    "Node API",
                    "Node API"
                  )}
                </Group>
              </Card>
            </SimpleGrid>
            <Group justify="flex-end">
              <Button
                variant="light"
                leftSection={<IconPencil size={14} />}
                onClick={() => {
                  if (!selectedNode) return;
                  openEditNodeEditor(selectedNode.id);
                }}
              >
                Edit Node
              </Button>
            </Group>
            <JsonInput
              label="Raw node state"
              value={JSON.stringify(selectedNode, null, 2)}
              autosize
              minRows={18}
              formatOnBlur
            />
          </Stack>
        ) : null}
      </Modal>
    </AppShell>
  );
}
