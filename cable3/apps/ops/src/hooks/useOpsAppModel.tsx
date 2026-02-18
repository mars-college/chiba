import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import { notifications } from "@mantine/notifications";
import { useMediaQuery } from "@mantine/hooks";
import {
  Badge,
  Card,
  Group,
  Image,
  Paper,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
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
  sendOpsNodeInput,
  updateOpsNode,
} from "../lib/api";
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
  type ResourcePayload,
} from "../lib/controlApi";
import type {
  FleetPi,
  FleetPiHealth,
  OpsNodeRecord,
  OpsApplyResponse,
  OpsApplyTarget,
  OpsProfile,
} from "../types";
import type { OpsNodeCacheInspectResponse } from "@chiba-cable3/contracts";
import type { OpsNodeRuntimeStatusResponse } from "@chiba-cable3/contracts";
import type { NodeRuntimeInputAction } from "@chiba-cable3/contracts";
import type { ResourcePickerItem } from "../components/ResourcePickerModal";
import {
  useOpsUiStore,
  type BuilderMode,
} from "../store/uiStore";
import {
  DRAFT_STORAGE_KEY,
  EMPTY_BLOCK_DRAFT,
  EMPTY_CHANNEL_DRAFT,
  EMPTY_PLAYLIST_DRAFT,
  EMPTY_PROFILE_DRAFT,
  TABLE_PAGE_SIZE,
  emptyNodeDraft,
  formatBytes,
  formatDurationSec,
  fromResourcePayload,
  inferUploadPreviewKind,
  isLikelyVideoSource,
  isVideoMedia,
  loadDraftStore,
  mediaPreviewSource,
  nodeDraftFromRecord,
  paginateRows,
  parseTargetFromKioskUrl,
  playlistMediaIdsFromSnapshot,
  readOpsViewFromUrl,
  readString,
  statusBadge,
  summarizeApplyResult,
  tableRangeLabel,
  toOptionBool,
  toPendingFleetHealth,
  toResourcePayload,
  triggerDownload,
  updateOpsUrl,
  type CatalogOption,
  type DraftBlock,
  type DraftChannel,
  type DraftPlaylist,
  type DraftProfile,
  type DraftStore,
  type IngestSource,
  type NodeDraft,
  type OptionBool,
  type OptionHud,
  type OptionMode,
  type OptionRotate,
  type QuickSendTarget,
  type UploadPreviewItem,
} from "../lib/opsModel";

export function useOpsAppModel() {
  const isMobile = useMediaQuery("(max-width: 48em)");
  const controlOpen = useOpsUiStore((s) => s.controlOpen);
  const setControlOpen = useOpsUiStore((s) => s.setControlOpen);
  const toggleControlOpen = useOpsUiStore((s) => s.toggleControlOpen);
  const mainTab = useOpsUiStore((s) => s.mainTab);
  const setMainTab = useOpsUiStore((s) => s.setMainTab);
  const builderTab = useOpsUiStore((s) => s.builderTab);
  const setBuilderTab = useOpsUiStore((s) => s.setBuilderTab);
  const fleetView = useOpsUiStore((s) => s.fleetView);
  const setFleetView = useOpsUiStore((s) => s.setFleetView);
  const mediaLibrarySection = useOpsUiStore((s) => s.mediaLibrarySection);
  const setMediaLibrarySection = useOpsUiStore((s) => s.setMediaLibrarySection);
  const playlistLibraryView = useOpsUiStore((s) => s.playlistLibraryView);
  const setPlaylistLibraryView = useOpsUiStore((s) => s.setPlaylistLibraryView);
  const mediaPickerOpen = useOpsUiStore((s) => s.mediaPickerOpen);
  const setMediaPickerOpen = useOpsUiStore((s) => s.setMediaPickerOpen);
  const targetPickerOpen = useOpsUiStore((s) => s.targetPickerOpen);
  const setTargetPickerOpen = useOpsUiStore((s) => s.setTargetPickerOpen);
  const quickSendOpen = useOpsUiStore((s) => s.quickSendOpen);
  const setQuickSendOpen = useOpsUiStore((s) => s.setQuickSendOpen);
  const nodeEditorOpen = useOpsUiStore((s) => s.nodeEditorOpen);
  const setNodeEditorOpen = useOpsUiStore((s) => s.setNodeEditorOpen);
  const assignTargetOpen = useOpsUiStore((s) => s.assignTargetOpen);
  const setAssignTargetOpen = useOpsUiStore((s) => s.setAssignTargetOpen);
  const [profiles, setProfiles] = useState<OpsProfile[]>([]);
  const [fleetMap, setFleetMap] = useState<Record<string, FleetPiHealth>>({});
  const [opsNodeMap, setOpsNodeMap] = useState<Record<string, OpsNodeRecord>>(
    {}
  );
  const [activeRegistryId, setActiveRegistryId] = useState("local");
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [nodeDraft, setNodeDraft] = useState<NodeDraft>(() => emptyNodeDraft());
  const [nodeSaving, setNodeSaving] = useState(false);
  const [loadingFleet, setLoadingFleet] = useState(false);
  const [search, setSearch] = useState("");
  const [lastTick, setLastTick] = useState<number | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [applyResult, setApplyResult] = useState<OpsApplyResponse | null>(null);
  const [draftStore, setDraftStore] = useState<DraftStore>(() =>
    loadDraftStore()
  );
  const [serverSnapshot, setServerSnapshot] = useState<ResourcePayload | null>(
    null
  );
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [builderBusy, setBuilderBusy] = useState(false);
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
  const [mediaSaveBusy, setMediaSaveBusy] = useState(false);
  const [serverMediaQuery, setServerMediaQuery] = useState("");
  const [serverMediaSourceFilter, setServerMediaSourceFilter] = useState<
    "all" | "path" | "url"
  >("all");
  const [selectedServerMediaId, setSelectedServerMediaId] = useState<
    string | null
  >(null);
  const [mediaDetailId, setMediaDetailId] = useState<string | null>(null);
  const [mediaFeedLimit, setMediaFeedLimit] = useState(24);
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
  const [nodeStashFilterQuery, setNodeStashFilterQuery] = useState("");
  const [nodeStashSort, setNodeStashSort] = useState<
    "name" | "size_desc" | "size_asc" | "updated_desc" | "updated_asc"
  >("updated_desc");
  const [nodeRuntimeStatus, setNodeRuntimeStatus] =
    useState<OpsNodeRuntimeStatusResponse | null>(null);
  const [nodeRuntimeBusy, setNodeRuntimeBusy] = useState(false);
  const [nodeRuntimeError, setNodeRuntimeError] = useState<string | null>(null);
  const [nodeInputBusy, setNodeInputBusy] = useState(false);
  const [nodeInputError, setNodeInputError] = useState<string | null>(null);
  const [nodeInputLastAction, setNodeInputLastAction] = useState<string | null>(
    null
  );
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestSource, setIngestSource] = useState<IngestSource>("youtube");
  const [ingestStep, setIngestStep] = useState<1 | 2 | 3>(1);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [youtubeTitle, setYoutubeTitle] = useState("");
  const [youtubeArtist, setYoutubeArtist] = useState("");
  const [webUrl, setWebUrl] = useState("");
  const [webTitle, setWebTitle] = useState("");
  const [webArtist, setWebArtist] = useState("");
  const [webDescription, setWebDescription] = useState("");
  const [webCache, setWebCache] = useState(true);
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

  const refreshServerSnapshot = useCallback(
    async (options?: { silent?: boolean }) => {
      const silent = Boolean(options?.silent);
      if (!silent) setLoadingSnapshot(true);
      try {
        const result = await fetchResourceSnapshot();
        setServerSnapshot(result.snapshot);
      } catch (error) {
        notifications.show({
          color: "orange",
          title: "Server snapshot refresh warning",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (!silent) setLoadingSnapshot(false);
      }
    },
    []
  );

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

  const filteredNodeStashItems = useMemo(() => {
    const files = (nodeStash?.cache?.files ?? []).map((file) => ({
      fileName: readString((file as any)?.name),
      sizeBytes:
        typeof (file as any)?.size === "number" ? (file as any).size : 0,
      updatedAtMs:
        typeof (file as any)?.mtimeMs === "number" ? (file as any).mtimeMs : 0,
    }));
    const query = nodeStashFilterQuery.trim().toLowerCase();
    const filtered = query
      ? files.filter((file) => file.fileName.toLowerCase().includes(query))
      : files;
    return [...filtered].sort((a, b) => {
      if (nodeStashSort === "name") return a.fileName.localeCompare(b.fileName);
      if (nodeStashSort === "size_desc") return b.sizeBytes - a.sizeBytes;
      if (nodeStashSort === "size_asc") return a.sizeBytes - b.sizeBytes;
      if (nodeStashSort === "updated_asc") return a.updatedAtMs - b.updatedAtMs;
      return b.updatedAtMs - a.updatedAtMs;
    });
  }, [nodeStash, nodeStashFilterQuery, nodeStashSort]);

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
        if (!silent) setNodeStash(null);
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
        if (!silent) setNodeRuntimeStatus(null);
        setNodeRuntimeError(
          error instanceof Error ? error.message : String(error)
        );
      } finally {
        if (!silent) setNodeRuntimeBusy(false);
      }
    },
    []
  );

  const sendNodeInputAction = useCallback(
    async (action: NodeRuntimeInputAction) => {
      const nodeId = workspaceSingleNodeId.trim();
      if (!nodeId) {
        notifications.show({
          color: "red",
          title: "No node selected",
          message: "Select one node before sending runtime input.",
        });
        return;
      }
      setNodeInputBusy(true);
      setNodeInputError(null);
      try {
        const result = await sendOpsNodeInput(nodeId, { action });
        const actionLabel =
          action.kind === "key"
            ? `key:${action.key}`
            : action.kind === "text"
            ? "text"
            : action.kind === "mouse_move"
            ? "mouse_move"
            : `mouse_click:${action.button || "left"}`;
        setNodeInputLastAction(actionLabel);
        if (result.code !== 0) {
          const detail = (result.stderr || result.stdout || "unknown_error")
            .split("\n")
            .filter(Boolean)[0];
          setNodeInputError(detail || `runtime_input_exit_${result.code}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setNodeInputError(message);
        notifications.show({
          color: "red",
          title: "Node input failed",
          message,
        });
      } finally {
        setNodeInputBusy(false);
      }
    },
    [workspaceSingleNodeId]
  );

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
      setNodeInputError(null);
      setNodeInputLastAction(null);
      setNodeInputBusy(false);
      return;
    }
    void refreshNodeStash(workspaceSingleNodeId, Boolean(nodeStash));
    void refreshNodeRuntime(workspaceSingleNodeId, Boolean(nodeRuntimeStatus));
  }, [
    lastTick,
    nodeRuntimeStatus,
    nodeStash,
    refreshNodeRuntime,
    refreshNodeStash,
    workspaceSingleNodeId,
  ]);

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

  const runWebIngest = useCallback(async () => {
    const url = webUrl.trim();
    if (!url) {
      notifications.show({
        color: "red",
        title: "Web URL required",
        message: "Provide an http(s) URL to add as media.",
      });
      return;
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        notifications.show({
          color: "red",
          title: "Invalid URL protocol",
          message: "Only http:// and https:// URLs are supported.",
        });
        return;
      }
    } catch {
      notifications.show({
        color: "red",
        title: "Invalid URL",
        message: "Enter a valid web URL.",
      });
      return;
    }
    try {
      setIngestBusy(true);
      const idSeed =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
          : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const mediaId = `m-web-${idSeed}`;
      await importResources({
        media: [
          {
            id: mediaId,
            title: webTitle.trim() || undefined,
            artist: webArtist.trim() || undefined,
            description: webDescription.trim() || undefined,
            sourceType: "url",
            sourceValue: url,
            cache: webCache,
          },
        ],
        playlists: [],
        blocks: [],
        channels: [],
        profiles: [],
      });
      await refreshServerSnapshot({ silent: true });
      notifications.show({
        color: "teal",
        title: "Web media added",
        message: mediaId,
      });
      setWebUrl("");
      setWebTitle("");
      setWebArtist("");
      setWebDescription("");
      setWebCache(true);
      routeToMediaLibraryAfterQueue();
    } catch (error) {
      notifications.show({
        color: "red",
        title: "Web media add failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIngestBusy(false);
    }
  }, [
    refreshServerSnapshot,
    routeToMediaLibraryAfterQueue,
    webArtist,
    webCache,
    webDescription,
    webTitle,
    webUrl,
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

  const serverMedia = useMemo(() => {
    const rows = serverSnapshot?.media ?? [];
    return [...rows].reverse();
  }, [serverSnapshot]);

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

  const saveMediaMetadata = useCallback(
    async (args: {
      id: string;
      title?: string;
      artist?: string;
      description?: string;
    }) => {
      const existing = serverMedia.find((row) => row.id === args.id);
      if (!existing) {
        throw new Error(`media_not_found:${args.id}`);
      }
      setMediaSaveBusy(true);
      try {
        await importResources({
          media: [
            {
              ...existing,
              title: args.title?.trim() || undefined,
              artist: args.artist?.trim() || undefined,
              description: args.description?.trim() || undefined,
            },
          ],
          playlists: [],
          blocks: [],
          channels: [],
          profiles: [],
        });
        await refreshDraftsAfterIngest();
        notifications.show({
          color: "teal",
          title: "Media updated",
          message: existing.id,
        });
      } finally {
        setMediaSaveBusy(false);
      }
    },
    [refreshDraftsAfterIngest, serverMedia]
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
    if (ingestSource === "web") return webUrl.trim().length > 0;
    return uploadFiles.length > 0;
  }, [edenInput, ingestSource, uploadFiles.length, webUrl, youtubeUrl]);

  const selectedIngestLabel = useMemo(() => {
    if (ingestSource === "youtube") return "YouTube (yt-dlp)";
    if (ingestSource === "eden") return "Eden Collection";
    if (ingestSource === "web") return "Web Link";
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

  const fleetScreenVm = {
    isMobile: Boolean(isMobile),
    loadingFleet,
    fleetView,
    setFleetView,
    selectedNodeIds,
    nodeWorkspaceFocus,
    activeRegistryId,
    openEditNodeEditor,
    setAssignTargetOpen,
    setActiveNodeId,
    returnToGuide,
    nodeRuntimeBusy,
    refreshNodeRuntime,
    nodeRuntimeError,
    nodeRuntimeStatus,
    workspacePlaybackMedia,
    nodeStashBusy,
    refreshNodeStash,
    nodeStashClearing,
    nodeStash,
    clearNodeStash,
    nodeStashError,
    sendNodeInputAction,
    nodeInputBusy,
    nodeInputError,
    nodeInputLastAction,
    nodeStashFilterQuery,
    setNodeStashFilterQuery,
    nodeStashSort,
    setNodeStashSort,
    filteredNodeStashItems,
    nodeEditorOpen,
    setNodeEditorOpen,
    editingNodeId,
    nodeDraft,
    setNodeDraft,
    nodeSaving,
    saveNodeDraft,
    assignTargetOpen,
    applyKind,
    setApplyKind,
    applyId,
    setApplyId,
    currentApplyOptions,
    setTargetPickerOpen,
    applyTargetPreviewCard,
    optMode,
    setOptMode,
    optLock,
    setOptLock,
    optQr,
    setOptQr,
    optPlaylist,
    setOptPlaylist,
    optNosplash,
    setOptNosplash,
    optHud,
    setOptHud,
    optHudSec,
    setOptHudSec,
    optTheme,
    setOptTheme,
    optRotate,
    setOptRotate,
    runApply,
    applyResult,
    summarizeApplyResult,
    search,
    setSearch,
    selectVisible,
    clearSelection,
    openNodeWorkspace,
    setControlOpen,
    openCreateNodeEditor,
    exportNodes,
    filteredRows,
    toggleNodeSelection,
    removeNode,
    fleetRowsPage,
    selectedNodeRows,
    setSelectedNodeIds,
    fleetPage,
    setFleetPage,
    fleetPageCount,
    mergedMediaById,
    mergedPlaylists,
  };

  const ingestSectionVm = {
    ingestStep,
    activeIngestJobs,
    runningIngestCount,
    ingestSource,
    setIngestSource,
    setIngestStep,
    selectedIngestLabel,
    youtubeUrl,
    setYoutubeUrl,
    youtubeTitle,
    setYoutubeTitle,
    youtubeArtist,
    setYoutubeArtist,
    webUrl,
    setWebUrl,
    webTitle,
    setWebTitle,
    webArtist,
    setWebArtist,
    webDescription,
    setWebDescription,
    webCache,
    setWebCache,
    edenInput,
    setEdenInput,
    getUploadRootProps,
    getUploadInputProps,
    isUploadDragActive,
    uploadFiles,
    uploadArtist,
    setUploadArtist,
    uploadDescription,
    setUploadDescription,
    uploadPreviewItems,
    removeUploadFileAtIndex,
    uploadDropError,
    canQueueIngest,
    ingestBusy,
    runYouTubeIngest,
    runEdenIngest,
    runWebIngest,
    runUploadIngest,
  };

  const mediaLibraryVm = {
    builderTab,
    loadingSnapshot,
    mediaLibrarySection,
    playlistLibraryView,
    setPlaylistLibraryView,
    serverMediaFiltered,
    serverMedia,
    refreshServerSnapshot,
    openPlaylistEditorRoute,
    serverMediaQuery,
    setServerMediaQuery,
    serverMediaSourceFilter,
    setServerMediaSourceFilter,
    mediaFilterData,
    hasMoreMediaFeed,
    setMediaFeedLimit,
    activeIngestJobs,
    mediaFeedItems,
    selectedServerMediaId,
    setSelectedServerMediaId,
    setMediaDetailId,
    setBuilderTab,
    openQuickSend,
    deleteMediaItem,
    draftPlaylists: draftStore.playlists,
    mergedMediaById,
    deletePlaylistDraft,
    playlistRowsPage,
    selectedPlaylistId,
    playlistTablePage,
    setPlaylistTablePage,
    playlistTablePageCount,
    isMobile: Boolean(isMobile),
  };

  const playlistEditorVm = {
    isMobile: Boolean(isMobile),
    playlistDraft,
    setPlaylistDraft,
    closePlaylistEditorRoute,
    setMediaPickerOpen,
    setDraftStore,
    setSelectedPlaylistId,
    mergedMedia,
    playlistDragIndex,
    setPlaylistDragIndex,
    playlistDropIndex,
    setPlaylistDropIndex,
    commitPlaylistDrop,
  };

  const mediaDetailVm = {
    isMobile: Boolean(isMobile),
    setBuilderTab,
    setMediaLibrarySection,
    selectedMediaDetail,
    selectedMediaDetailPreviewSrc,
    openQuickSend,
    mediaDeleteBusy,
    deleteMediaItem,
    mediaSaveBusy,
    saveMediaMetadata,
  };

  const mediaPlaylistTablesVm = {
    builderTab,
    mediaTableRowsPage,
    setSelectedServerMediaId,
    setMediaDetailId,
    setBuilderTab,
    serverMediaCount: serverMedia.length,
    mediaTablePage,
    setMediaTablePage,
    mediaTablePageCount,
    isMobile: Boolean(isMobile),
    playlistRowsPage,
    openPlaylistEditorRoute,
    selectedPlaylistId,
    setDraftStore,
    playlistCount: draftStore.playlists.length,
    playlistTablePage,
    setPlaylistTablePage,
    playlistTablePageCount,
  };

  const containerEditorsVm = {
    builderTab,
    setSelectedBlockId,
    setBlockDraft,
    draftStore,
    blockRowsPage,
    openBlockEditor,
    selectedBlockId,
    setDraftStore,
    blockTablePage,
    setBlockTablePage,
    blockTablePageCount,
    isMobile: Boolean(isMobile),
    blockDraft,
    setSelectedChannelId,
    setChannelDraft,
    channelRowsPage,
    openChannelEditor,
    selectedChannelId,
    channelTablePage,
    setChannelTablePage,
    channelTablePageCount,
    channelDraft,
    setSelectedProfileId,
    setProfileDraft,
    profileRowsPage,
    openProfileEditor,
    selectedProfileId,
    profileTablePage,
    setProfileTablePage,
    profileTablePageCount,
    profileDraft,
    profileTargetOptions,
  };

  return {
    isMobile,
    controlOpen,
    setControlOpen,
    toggleControlOpen,
    mainTab,
    setMainTab,
    builderTab,
    setBuilderTab,
    fleetView,
    setFleetView,
    mediaLibrarySection,
    setMediaLibrarySection,
    playlistLibraryView,
    setPlaylistLibraryView,
    mediaPickerOpen,
    setMediaPickerOpen,
    targetPickerOpen,
    setTargetPickerOpen,
    quickSendOpen,
    setQuickSendOpen,
    nodeEditorOpen,
    setNodeEditorOpen,
    assignTargetOpen,
    setAssignTargetOpen,
    ingestPollersRef,
    ingestJobStatusRef,
    ingestWatchWarnedRef,
    refreshCatalogAndProfiles,
    refreshServerSnapshot,
    refreshNodesInventory,
    refreshFleet,
    fleetRows,
    filteredRows,
    selectedNode,
    metrics,
    profileOptions,
    channelOptions,
    blockOptions,
    playlistOptions,
    mediaOptions,
    currentApplyOptions,
    selectedNodeRows,
    nodeWorkspaceFocus,
    workspaceSingleNodeId,
    filteredNodeStashItems,
    quickSendRows,
    toggleNodeSelection,
    selectVisible,
    clearSelection,
    openNodeWorkspace,
    refreshNodeStash,
    refreshNodeRuntime,
    clearNodeStash,
    openCreateNodeEditor,
    openEditNodeEditor,
    saveNodeDraft,
    removeNode,
    exportNodes,
    applyTargetToNodes,
    buildMediaLookup,
    runApply,
    returnToGuide,
    openQuickSend,
    runQuickSend,
    exportDrafts,
    pushDraftsToControlDb,
    loadDraftsFromControlDb,
    refreshDraftsAfterIngest,
    upsertIngestJob,
    stopPollingJob,
    startPollingJob,
    syncIngestJobs,
    routeToMediaLibraryAfterQueue,
    runYouTubeIngest,
    runEdenIngest,
    runUploadIngest,
    serverMedia,
    mergedMedia,
    mergedMediaById,
    workspacePlaybackMedia,
    mergedPlaylists,
    applyResourcePickerItems,
    applyTargetPreviewCard,
    serverMediaKinds,
    serverMediaFiltered,
    mediaFeedItems,
    hasMoreMediaFeed,
    selectedMediaDetail,
    selectedMediaDetailPreviewSrc,
    deleteMediaItem,
    saveMediaMetadata,
    deletePlaylistDraft,
    mediaFilterData,
    profileTargetOptions,
    pickerMedia,
    canQueueIngest,
    selectedIngestLabel,
    activeIngestJobs,
    runningIngestCount,
    currentLibraryPane,
    fleetPageCount,
    mediaTablePageCount,
    playlistTablePageCount,
    blockTablePageCount,
    channelTablePageCount,
    profileTablePageCount,
    fleetRowsPage,
    mediaTableRowsPage,
    playlistRowsPage,
    blockRowsPage,
    channelRowsPage,
    profileRowsPage,
    onUploadDrop,
    removeUploadFileAtIndex,
    uploadPreviewItems,
    loadPlaylistDraftById,
    openPlaylistEditorRoute,
    closePlaylistEditorRoute,
    commitPlaylistDrop,
    openProfileEditor,
    openBlockEditor,
    openChannelEditor,
    fleetScreenVm,
    ingestSectionVm,
    mediaLibraryVm,
    playlistEditorVm,
    mediaDetailVm,
    mediaPlaylistTablesVm,
    containerEditorsVm,
    profiles,
    setProfiles,
    fleetMap,
    setFleetMap,
    opsNodeMap,
    setOpsNodeMap,
    activeRegistryId,
    setActiveRegistryId,
    selectedNodeIds,
    setSelectedNodeIds,
    activeNodeId,
    setActiveNodeId,
    editingNodeId,
    setEditingNodeId,
    nodeDraft,
    setNodeDraft,
    nodeSaving,
    setNodeSaving,
    loadingFleet,
    setLoadingFleet,
    loadingSnapshot,
    search,
    setSearch,
    lastTick,
    setLastTick,
    autoRefresh,
    setAutoRefresh,
    applyResult,
    setApplyResult,
    draftStore,
    setDraftStore,
    serverSnapshot,
    setServerSnapshot,
    builderBusy,
    setBuilderBusy,
    quickSendTarget,
    setQuickSendTarget,
    quickSendNodeIds,
    setQuickSendNodeIds,
    quickSendQuery,
    setQuickSendQuery,
    quickSendBusy,
    setQuickSendBusy,
    playlistDragIndex,
    setPlaylistDragIndex,
    playlistDropIndex,
    setPlaylistDropIndex,
    fleetPage,
    setFleetPage,
    mediaTablePage,
    setMediaTablePage,
    playlistTablePage,
    setPlaylistTablePage,
    blockTablePage,
    setBlockTablePage,
    channelTablePage,
    setChannelTablePage,
    profileTablePage,
    setProfileTablePage,
    mediaDeleteBusy,
    setMediaDeleteBusy,
    mediaSaveBusy,
    setMediaSaveBusy,
    serverMediaQuery,
    setServerMediaQuery,
    serverMediaSourceFilter,
    setServerMediaSourceFilter,
    selectedServerMediaId,
    setSelectedServerMediaId,
    mediaDetailId,
    setMediaDetailId,
    mediaFeedLimit,
    setMediaFeedLimit,
    selectedPlaylistId,
    setSelectedPlaylistId,
    selectedProfileId,
    setSelectedProfileId,
    selectedBlockId,
    setSelectedBlockId,
    selectedChannelId,
    setSelectedChannelId,
    nodeWorkspaceFocusId,
    setNodeWorkspaceFocusId,
    nodeStash,
    setNodeStash,
    nodeStashBusy,
    setNodeStashBusy,
    nodeStashClearing,
    setNodeStashClearing,
    nodeStashError,
    setNodeStashError,
    nodeStashFilterQuery,
    setNodeStashFilterQuery,
    nodeStashSort,
    setNodeStashSort,
    nodeRuntimeStatus,
    setNodeRuntimeStatus,
    nodeRuntimeBusy,
    setNodeRuntimeBusy,
    nodeRuntimeError,
    setNodeRuntimeError,
    ingestBusy,
    setIngestBusy,
    ingestSource,
    setIngestSource,
    ingestStep,
    setIngestStep,
    youtubeUrl,
    setYoutubeUrl,
    youtubeTitle,
    setYoutubeTitle,
    youtubeArtist,
    setYoutubeArtist,
    edenInput,
    setEdenInput,
    uploadFiles,
    setUploadFiles,
    uploadArtist,
    setUploadArtist,
    uploadDescription,
    setUploadDescription,
    uploadDropError,
    setUploadDropError,
    ingestJobs,
    setIngestJobs,
    applyKind,
    setApplyKind,
    applyId,
    setApplyId,
    optMode,
    setOptMode,
    optLock,
    setOptLock,
    optQr,
    setOptQr,
    optPlaylist,
    setOptPlaylist,
    optNosplash,
    setOptNosplash,
    optHud,
    setOptHud,
    optHudSec,
    setOptHudSec,
    optTheme,
    setOptTheme,
    optRotate,
    setOptRotate,
    playlistDraft,
    setPlaylistDraft,
    blockDraft,
    setBlockDraft,
    channelDraft,
    setChannelDraft,
    profileDraft,
    setProfileDraft,
    updateOpsUrl,
    parseTargetFromKioskUrl,
    statusBadge,
    summarizeApplyResult,
  };
}

export type OpsAppModel = ReturnType<typeof useOpsAppModel>;
