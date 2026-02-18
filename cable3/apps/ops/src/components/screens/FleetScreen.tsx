import { useEffect, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Image,
  Pagination,
  Paper,
  Progress,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  IconAdjustments,
  IconArrowLeft,
  IconBroadcast,
  IconChecklist,
  IconDownload,
  IconKeyboard,
  IconPencil,
  IconRefresh,
  IconSearch,
  IconSquareRoundedPlus,
  IconTrash,
} from "@tabler/icons-react";
import { AssignTargetPanel } from "../AssignTargetPanel";
import { DetailBreadcrumbs } from "../DetailBreadcrumbs";
import { NodeControlPanel } from "../NodeControlPanel";
import { NodeEditorPanel, type NodeDraft } from "../NodeEditorPanel";
import { SectionLoader } from "../SectionLoader";
import { type Media } from "../../lib/controlApi";
import { type FleetPiHealth } from "../../types";
import type { NodeRuntimeInputAction } from "@chiba-cable3/contracts";
import {
  TABLE_PAGE_SIZE,
  formatBytes,
  formatDurationSec,
  isVideoMedia,
  mediaPreviewSource,
  parseKioskTarget,
  statusBadge,
  tableRangeLabel,
} from "../../lib/opsModel";

export type FleetScreenVm = {
  isMobile: boolean;
  loadingFleet: boolean;
  fleetView: "table" | "workspace";
  setFleetView: (view: "table" | "workspace") => void;
  selectedNodeIds: string[];
  nodeWorkspaceFocus: FleetPiHealth | null;
  activeRegistryId: string;
  openEditNodeEditor: (nodeId: string) => void;
  setAssignTargetOpen: (open: boolean) => void;
  setActiveNodeId: (nodeId: string) => void;
  returnToGuide: () => Promise<void>;
  nodeRuntimeBusy: boolean;
  refreshNodeRuntime: (nodeId: string, silent?: boolean) => Promise<void>;
  nodeRuntimeError: string | null;
  nodeRuntimeStatus: any;
  workspacePlaybackMedia: Media | null;
  nodeStashBusy: boolean;
  refreshNodeStash: (nodeId: string, silent?: boolean) => Promise<void>;
  nodeStashClearing: boolean;
  nodeStash: any;
  clearNodeStash: () => Promise<void>;
  nodeStashError: string | null;
  sendNodeInputAction: (action: NodeRuntimeInputAction) => Promise<void>;
  nodeInputBusy: boolean;
  nodeInputError: string | null;
  nodeInputLastAction: string | null;
  nodeStashFilterQuery: string;
  setNodeStashFilterQuery: (query: string) => void;
  nodeStashSort: "name" | "size_desc" | "size_asc" | "updated_desc" | "updated_asc";
  setNodeStashSort: (
    sort: "name" | "size_desc" | "size_asc" | "updated_desc" | "updated_asc"
  ) => void;
  filteredNodeStashItems: Array<{ fileName: string; sizeBytes: number; updatedAtMs: number }>;
  nodeEditorOpen: boolean;
  setNodeEditorOpen: (open: boolean) => void;
  editingNodeId: string | null;
  nodeDraft: NodeDraft;
  setNodeDraft: Dispatch<SetStateAction<NodeDraft>>;
  nodeSaving: boolean;
  saveNodeDraft: () => Promise<void>;
  assignTargetOpen: boolean;
  applyKind: "media" | "playlist" | "block" | "channel" | "profile";
  setApplyKind: (value: "media" | "playlist" | "block" | "channel" | "profile") => void;
  applyId: string;
  setApplyId: (value: string) => void;
  currentApplyOptions: Array<{ value: string; label: string }>;
  setTargetPickerOpen: (open: boolean) => void;
  applyTargetPreviewCard: ReactNode;
  optMode: "inherit" | "guide" | "gallery";
  setOptMode: (value: "inherit" | "guide" | "gallery") => void;
  optLock: "inherit" | "on" | "off";
  setOptLock: (value: "inherit" | "on" | "off") => void;
  optQr: "inherit" | "on" | "off";
  setOptQr: (value: "inherit" | "on" | "off") => void;
  optPlaylist: "inherit" | "on" | "off";
  setOptPlaylist: (value: "inherit" | "on" | "off") => void;
  optNosplash: "inherit" | "on" | "off";
  setOptNosplash: (value: "inherit" | "on" | "off") => void;
  optHud: "inherit" | "always" | "start" | "never";
  setOptHud: (value: "inherit" | "always" | "start" | "never") => void;
  optHudSec: number | "";
  setOptHudSec: (value: number | "") => void;
  optTheme: string;
  setOptTheme: (value: string) => void;
  optRotate: "inherit" | "0" | "90" | "180" | "270";
  setOptRotate: (value: "inherit" | "0" | "90" | "180" | "270") => void;
  runApply: () => Promise<void>;
  applyResult: any;
  summarizeApplyResult: (result: any) => string;
  search: string;
  setSearch: (value: string) => void;
  selectVisible: () => void;
  clearSelection: () => void;
  openNodeWorkspace: () => void;
  setControlOpen: (open: boolean) => void;
  openCreateNodeEditor: () => void;
  filteredRows: FleetPiHealth[];
  toggleNodeSelection: (nodeId: string, checked: boolean) => void;
  removeNode: (nodeId: string) => Promise<void>;
  fleetRowsPage: FleetPiHealth[];
  selectedNodeRows: FleetPiHealth[];
  setSelectedNodeIds: Dispatch<SetStateAction<string[]>>;
  fleetPage: number;
  setFleetPage: (page: number) => void;
  fleetPageCount: number;
  mergedMediaById: Map<string, Media>;
  mergedPlaylists: Array<{
    id: string;
    title?: string;
    artist?: string;
    description?: string;
    mediaIds: string[];
  }>;
};

type WorkspacePanel =
  | "overview"
  | "assign"
  | "control"
  | "edit"
  | "stash"
  | "runtime";

export function FleetScreen({ vm }: { vm: FleetScreenVm }) {
  const {
    isMobile,
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
  } = vm;

  const [workspacePanel, setWorkspacePanel] = useState<WorkspacePanel>("overview");

  useEffect(() => {
    if (nodeEditorOpen) setWorkspacePanel("edit");
  }, [nodeEditorOpen]);

  useEffect(() => {
    if (assignTargetOpen) setWorkspacePanel("assign");
  }, [assignTargetOpen]);

  useEffect(() => {
    if (fleetView !== "workspace") {
      setWorkspacePanel("overview");
      setAssignTargetOpen(false);
      setNodeEditorOpen(false);
    }
  }, [fleetView, setAssignTargetOpen, setNodeEditorOpen]);

  const openRowWorkspace = (nodeId: string) => {
    setSelectedNodeIds([nodeId]);
    setFleetView("workspace");
  };

  const resolveRuntimeCard = (kioskUrl: string | null | undefined) => {
    const target = parseKioskTarget(kioskUrl);
    if (target.kind === "media" && target.id) {
      const media = mergedMediaById.get(target.id);
      if (!media) {
        return {
          kind: "media",
          label: target.id,
          subtitle: target.label,
          thumbnailUrl: null as string | null,
        };
      }
      return {
        kind: "media",
        label: media.title || media.id,
        subtitle: media.artist || media.id,
        thumbnailUrl: media.thumbnailUrl || null,
      };
    }
    if (target.kind === "playlist" && target.id) {
      const playlist = mergedPlaylists.find((row) => row.id === target.id);
      if (!playlist) {
        return {
          kind: "playlist",
          label: target.id,
          subtitle: target.label,
          thumbnailUrl: null as string | null,
        };
      }
      const thumb = playlist.mediaIds
        .map((mediaId) => mergedMediaById.get(mediaId))
        .find((row) => Boolean(row?.thumbnailUrl));
      return {
        kind: "playlist",
        label: playlist.title || playlist.id,
        subtitle: playlist.artist || `${playlist.mediaIds.length} item(s)`,
        thumbnailUrl: thumb?.thumbnailUrl || null,
      };
    }
    return {
      kind: target.kind,
      label: target.label,
      subtitle: "",
      thumbnailUrl: null as string | null,
    };
  };

  const openEditPanel = () => {
    if (selectedNodeIds.length === 1 && nodeWorkspaceFocus) {
      openEditNodeEditor(nodeWorkspaceFocus.id);
    } else if (!nodeEditorOpen) {
      openCreateNodeEditor();
    }
    setAssignTargetOpen(false);
    setNodeEditorOpen(true);
    setWorkspacePanel("edit");
  };

  const openAssignPanel = () => {
    setNodeEditorOpen(false);
    setAssignTargetOpen(true);
    setWorkspacePanel("assign");
  };

  const openControlPanel = () => {
    setAssignTargetOpen(false);
    setNodeEditorOpen(false);
    setWorkspacePanel("control");
  };

  const openStashPanel = () => {
    setAssignTargetOpen(false);
    setNodeEditorOpen(false);
    setWorkspacePanel("stash");
  };

  const closeWorkspacePanels = () => {
    setAssignTargetOpen(false);
    setNodeEditorOpen(false);
    setWorkspacePanel("overview");
  };

  return (
    <Tabs.Panel value="fleet" pt="md">
      {fleetView === "workspace" ? (
        <Paper withBorder radius="md" p="md">
          <Stack gap="md">
            <Group justify="space-between" align="center" wrap="wrap">
              <Stack gap={4}>
                <DetailBreadcrumbs
                  items={[
                    {
                      label: "Node Ops",
                      onClick: () => {
                        setFleetView("table");
                        closeWorkspacePanels();
                      },
                    },
                    {
                      label: "Node Workspace",
                      onClick: closeWorkspacePanels,
                    },
                    ...(workspacePanel === "assign"
                      ? [{ label: "Assign Target" }]
                      : workspacePanel === "control"
                        ? [{ label: "Control App/Web" }]
                      : workspacePanel === "edit"
                        ? [{ label: editingNodeId ? "Edit Node" : "Add Node" }]
                        : workspacePanel === "stash"
                          ? [{ label: "Media Stash" }]
                          : workspacePanel === "runtime"
                            ? [{ label: "Runtime" }]
                            : []),
                  ]}
                />
              </Stack>
              <Badge variant="light">{selectedNodeIds.length} selected</Badge>
            </Group>

            {selectedNodeIds.length === 0 ? (
              <>
                <Card withBorder p="md">
                  <Stack gap="xs">
                    <Text fw={700}>No nodes selected</Text>
                    <Text size="sm" c="dimmed">
                      Select one or more nodes from Node Ops to edit details or apply state.
                    </Text>
                    <Group>
                      <Button variant="light" onClick={() => setFleetView("table")}>
                        Open node list
                      </Button>
                      <Button
                        variant="light"
                        leftSection={<IconSquareRoundedPlus size={14} />}
                        onClick={openEditPanel}
                      >
                        Add Node
                      </Button>
                    </Group>
                  </Stack>
                </Card>
                {workspacePanel === "edit" && nodeEditorOpen ? (
                  <NodeEditorPanel
                    editingNodeId={editingNodeId}
                    nodeDraft={nodeDraft}
                    setNodeDraft={setNodeDraft}
                    onSave={saveNodeDraft}
                    saving={nodeSaving}
                    onClose={closeWorkspacePanels}
                    breadcrumbs={[
                      {
                        label: "Node Workspace",
                        onClick: closeWorkspacePanels,
                      },
                      { label: editingNodeId ? "Edit Node" : "Add Node" },
                    ]}
                  />
                ) : null}
              </>
            ) : (
              <>
                {workspacePanel === "overview" &&
                selectedNodeIds.length === 1 &&
                nodeWorkspaceFocus ? (
                  <Card withBorder p="md">
                    <Stack gap="sm">
                      <Group justify="space-between" align="flex-start">
                        <div>
                          <Text fw={700}>{nodeWorkspaceFocus.id}</Text>
                          <Text size="sm" c="dimmed">
                            {nodeWorkspaceFocus.nodeName || "Unnamed node"}
                          </Text>
                        </div>
                        <Badge variant="light">{nodeWorkspaceFocus.registryId || activeRegistryId}</Badge>
                      </Group>
                      <Text size="xs" ff="monospace">
                        {nodeWorkspaceFocus.host || "—"}{" "}
                        {nodeWorkspaceFocus.ip ? `• ${nodeWorkspaceFocus.ip}` : ""}
                      </Text>
                      <Group gap={6}>
                        {statusBadge(nodeWorkspaceFocus.dnsOk, "DNS", "DNS")}
                        {statusBadge(nodeWorkspaceFocus.tcp.ssh22.ok, "SSH", "SSH")}
                        {statusBadge(nodeWorkspaceFocus.http.nodeStatus.ok, "Node", "Node")}
                        {statusBadge(nodeWorkspaceFocus.http.cableVersion.ok, "Cable", "Cable")}
                      </Group>
                      <Paper withBorder p="sm" radius="md">
                        <Stack gap="xs">
                          <Group justify="space-between" align="center" wrap="wrap">
                            <Text fw={600}>Now Playing</Text>
                            <Button
                              size="xs"
                              variant="light"
                              leftSection={<IconRefresh size={12} />}
                              loading={nodeRuntimeBusy}
                              onClick={() => void refreshNodeRuntime(nodeWorkspaceFocus.id)}
                            >
                              Refresh
                            </Button>
                          </Group>
                          {nodeRuntimeError ? (
                            <Text size="sm" c="red">
                              {nodeRuntimeError}
                            </Text>
                          ) : null}
                          {!nodeRuntimeStatus && nodeRuntimeBusy ? (
                            <SectionLoader label="Loading runtime playback..." />
                          ) : nodeRuntimeStatus ? (
                            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                              <Card withBorder p="xs">
                                {workspacePlaybackMedia?.thumbnailUrl ? (
                                  <Image
                                    src={workspacePlaybackMedia.thumbnailUrl}
                                    alt={workspacePlaybackMedia.title || workspacePlaybackMedia.id}
                                    radius="sm"
                                    h={112}
                                    fit="cover"
                                  />
                                ) : workspacePlaybackMedia &&
                                  isVideoMedia(workspacePlaybackMedia) &&
                                  mediaPreviewSource(workspacePlaybackMedia) ? (
                                  <video
                                    key={`workspace-inline-video-preview-${workspacePlaybackMedia.id}`}
                                    src={mediaPreviewSource(workspacePlaybackMedia) || undefined}
                                    muted
                                    playsInline
                                    autoPlay
                                    loop
                                    style={{
                                      width: "100%",
                                      height: 112,
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
                                    {nodeRuntimeStatus.status.playback?.state || "unknown"}
                                  </Badge>
                                </Group>
                                <Text fw={700} lineClamp={1}>
                                  {nodeRuntimeStatus.status.playback?.title ||
                                    workspacePlaybackMedia?.title ||
                                    nodeRuntimeStatus.status.playback?.mediaId ||
                                    nodeRuntimeStatus.status.currentItemId ||
                                    "No active media"}
                                </Text>
                                <Text size="sm" c="dimmed" lineClamp={1}>
                                  {nodeRuntimeStatus.status.playback?.artist ||
                                    workspacePlaybackMedia?.artist ||
                                    "unknown artist"}
                                </Text>
                                {typeof nodeRuntimeStatus.status.playback?.progressPercent ===
                                "number" ? (
                                  <>
                                    <Progress
                                      value={Math.max(
                                        0,
                                        Math.min(
                                          100,
                                          nodeRuntimeStatus.status.playback.progressPercent
                                        )
                                      )}
                                    />
                                    <Text size="xs" c="dimmed">
                                      {formatDurationSec(
                                        nodeRuntimeStatus.status.playback.positionSec ?? null
                                      )}{" "}
                                      /{" "}
                                      {formatDurationSec(
                                        nodeRuntimeStatus.status.playback.durationSec ?? null
                                      )}
                                    </Text>
                                  </>
                                ) : (
                                  <Text size="xs" c="dimmed">
                                    Playback progress unavailable for this target.
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
                      <Stack gap="xs">
                        <Button leftSection={<IconPencil size={14} />} onClick={openEditPanel}>
                          Edit Node Details
                        </Button>
                        <Button
                          variant="light"
                          color="teal"
                          leftSection={<IconAdjustments size={14} />}
                          onClick={openAssignPanel}
                        >
                          Assign Media/Container
                        </Button>
                        <Button
                          variant="light"
                          color="green"
                          leftSection={<IconKeyboard size={14} />}
                          onClick={openControlPanel}
                        >
                          Control App/Web
                        </Button>
                        <Button
                          variant="light"
                          leftSection={<IconBroadcast size={14} />}
                          onClick={() => setWorkspacePanel("runtime")}
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
                        <Button
                          variant="light"
                          color="gray"
                          leftSection={<IconDownload size={14} />}
                          onClick={openStashPanel}
                        >
                          Inspect Media Stash
                        </Button>
                      </Stack>
                    </Stack>
                  </Card>
                ) : workspacePanel === "overview" ? (
                  <Card withBorder p="md">
                    <Stack gap="sm">
                      <Text fw={700}>Selected Nodes ({selectedNodeRows.length})</Text>
                      <ScrollArea h={260}>
                        <Stack gap="xs">
                          {selectedNodeRows.map((row) => (
                            <Card key={`workspace-node-${row.id}`} withBorder p="xs">
                              <Group justify="space-between" align="flex-start" wrap="nowrap">
                                <div>
                                  <Text fw={600}>{row.id}</Text>
                                  <Text size="xs" c="dimmed">
                                    {row.nodeName || row.host || row.ip || "node"}
                                  </Text>
                                </div>
                                <Badge
                                  variant="light"
                                  color={
                                    row.connectivity?.status === "online"
                                      ? "teal"
                                      : row.connectivity?.status === "degraded"
                                      ? "yellow"
                                      : "red"
                                  }
                                >
                                  {row.connectivity?.status || "offline"}
                                </Badge>
                              </Group>
                            </Card>
                          ))}
                        </Stack>
                      </ScrollArea>
                      <Group>
                        <Button
                          variant="light"
                          color="teal"
                          leftSection={<IconAdjustments size={14} />}
                          onClick={openAssignPanel}
                        >
                          Assign Media/Container
                        </Button>
                        <Button
                          variant="light"
                          color="orange"
                          leftSection={<IconChecklist size={14} />}
                          onClick={() => void returnToGuide()}
                        >
                          Return Selected to Guide
                        </Button>
                      </Group>
                    </Stack>
                  </Card>
                ) : null}

                {workspacePanel === "edit" && nodeEditorOpen ? (
                  <NodeEditorPanel
                    editingNodeId={editingNodeId}
                    nodeDraft={nodeDraft}
                    setNodeDraft={setNodeDraft}
                    onSave={saveNodeDraft}
                    saving={nodeSaving}
                    onClose={closeWorkspacePanels}
                    breadcrumbs={[]}
                  />
                ) : null}

                {workspacePanel === "assign" && assignTargetOpen ? (
                  <AssignTargetPanel
                    selectedNodeCount={selectedNodeIds.length}
                    applyKind={applyKind}
                    setApplyKind={setApplyKind}
                    applyId={applyId}
                    setApplyId={setApplyId}
                    currentApplyOptions={currentApplyOptions}
                    onOpenTargetPicker={() => setTargetPickerOpen(true)}
                    applyTargetPreviewCard={applyTargetPreviewCard}
                    optMode={optMode}
                    setOptMode={setOptMode}
                    optLock={optLock}
                    setOptLock={setOptLock}
                    optQr={optQr}
                    setOptQr={setOptQr}
                    optPlaylist={optPlaylist}
                    setOptPlaylist={setOptPlaylist}
                    optNosplash={optNosplash}
                    setOptNosplash={setOptNosplash}
                    optHud={optHud}
                    setOptHud={setOptHud}
                    optHudSec={optHudSec}
                    setOptHudSec={setOptHudSec}
                    optTheme={optTheme}
                    setOptTheme={setOptTheme}
                    optRotate={optRotate}
                    setOptRotate={setOptRotate}
                    runApply={runApply}
                    applyResult={applyResult}
                    summarizeApplyResult={summarizeApplyResult}
                    onClose={closeWorkspacePanels}
                    breadcrumbs={[]}
                  />
                ) : null}

                {workspacePanel === "control" && selectedNodeIds.length === 1 ? (
                  <NodeControlPanel
                    selectedNodeCount={selectedNodeIds.length}
                    nodeId={selectedNodeIds[0]}
                    busy={nodeInputBusy}
                    error={nodeInputError}
                    lastAction={nodeInputLastAction}
                    onSendAction={sendNodeInputAction}
                    onClose={closeWorkspacePanels}
                    breadcrumbs={[]}
                  />
                ) : null}

                {workspacePanel === "stash" && selectedNodeIds.length === 1 ? (
                  <Paper withBorder p="sm" radius="md">
                    <Stack gap="xs">
                      <Group justify="space-between" align="center" wrap="wrap">
                        <Text fw={700}>Media Stash</Text>
                        <Group gap={8}>
                          <Button
                            size="xs"
                            variant="light"
                            leftSection={<IconRefresh size={14} />}
                            loading={nodeStashBusy}
                            onClick={() => {
                              if (nodeWorkspaceFocus) {
                                void refreshNodeStash(nodeWorkspaceFocus.id);
                              }
                            }}
                          >
                            Refresh
                          </Button>
                          <Button
                            size="xs"
                            color="red"
                            variant="light"
                            leftSection={<IconTrash size={14} />}
                            loading={nodeStashClearing}
                            disabled={!nodeStash || nodeStash.cache.fileCount === 0}
                            onClick={() => void clearNodeStash()}
                          >
                            Clear Stash
                          </Button>
                        </Group>
                      </Group>
                      <SimpleGrid cols={{ base: 1, sm: 2 }}>
                        <TextInput
                          leftSection={<IconSearch size={14} />}
                          placeholder="Filter stash files"
                          value={nodeStashFilterQuery}
                          onChange={(event) => setNodeStashFilterQuery(event.currentTarget.value)}
                        />
                        <Select
                          data={[
                            { value: "updated_desc", label: "Updated (newest)" },
                            { value: "updated_asc", label: "Updated (oldest)" },
                            { value: "size_desc", label: "Size (largest)" },
                            { value: "size_asc", label: "Size (smallest)" },
                            { value: "name", label: "Name" },
                          ]}
                          value={nodeStashSort}
                          onChange={(value) =>
                            setNodeStashSort(
                              (value as
                                | "name"
                                | "size_desc"
                                | "size_asc"
                                | "updated_desc"
                                | "updated_asc") || "updated_desc"
                            )
                          }
                        />
                      </SimpleGrid>
                      {nodeStashError ? <Text c="red">{nodeStashError}</Text> : null}
                      {nodeStashBusy && !nodeStash ? (
                        <SectionLoader label="Loading node stash..." />
                      ) : nodeStash ? (
                        <>
                          <Group gap="xs">
                            <Badge variant="light">{nodeStash.cache.fileCount} files</Badge>
                            <Badge variant="light">{formatBytes(nodeStash.cache.bytes)}</Badge>
                          </Group>
                          {filteredNodeStashItems.length > 0 ? (
                            <ScrollArea h={260}>
                              <Table striped highlightOnHover withTableBorder withColumnBorders>
                                <Table.Thead>
                                  <Table.Tr>
                                    <Table.Th>File</Table.Th>
                                    <Table.Th w={120}>Size</Table.Th>
                                    <Table.Th w={180}>Updated</Table.Th>
                                  </Table.Tr>
                                </Table.Thead>
                                <Table.Tbody>
                                  {filteredNodeStashItems.map((file) => (
                                    <Table.Tr key={`stash-${file.fileName}`}>
                                      <Table.Td>
                                        <Text size="xs" ff="monospace">
                                          {file.fileName}
                                        </Text>
                                      </Table.Td>
                                      <Table.Td>{formatBytes(file.sizeBytes)}</Table.Td>
                                      <Table.Td>
                                        <Text size="xs" c="dimmed">
                                          {new Date(file.updatedAtMs).toLocaleString()}
                                        </Text>
                                      </Table.Td>
                                    </Table.Tr>
                                  ))}
                                </Table.Tbody>
                              </Table>
                            </ScrollArea>
                          ) : (
                            <Text size="sm" c="dimmed">
                              No files in stash.
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
                ) : null}

                {workspacePanel === "runtime" ? (
                  <Paper withBorder p="sm" radius="md">
                    <Stack gap="xs">
                      <Group justify="space-between" align="center" wrap="wrap">
                        <Text fw={700}>Runtime</Text>
                        <Group gap={8}>
                          <Button
                            size="xs"
                            variant="light"
                            leftSection={<IconRefresh size={14} />}
                            loading={nodeRuntimeBusy}
                            onClick={() => {
                              if (nodeWorkspaceFocus) {
                                void refreshNodeRuntime(nodeWorkspaceFocus.id);
                              }
                            }}
                          >
                            Refresh
                          </Button>
                          <Button
                            size="xs"
                            variant="light"
                            onClick={closeWorkspacePanels}
                          >
                            Close
                          </Button>
                        </Group>
                      </Group>
                      {nodeRuntimeError ? (
                        <Text size="sm" c="red">
                          {nodeRuntimeError}
                        </Text>
                      ) : null}
                      {!nodeRuntimeStatus && nodeRuntimeBusy ? (
                        <SectionLoader label="Loading runtime playback..." />
                      ) : nodeRuntimeStatus ? (
                        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                          <Card withBorder p="xs">
                            {workspacePlaybackMedia?.thumbnailUrl ? (
                              <Image
                                src={workspacePlaybackMedia.thumbnailUrl}
                                alt={workspacePlaybackMedia.title || workspacePlaybackMedia.id}
                                radius="sm"
                                h={140}
                                fit="cover"
                              />
                            ) : workspacePlaybackMedia &&
                              isVideoMedia(workspacePlaybackMedia) &&
                              mediaPreviewSource(workspacePlaybackMedia) ? (
                              <video
                                key={`workspace-video-preview-${workspacePlaybackMedia.id}`}
                                src={mediaPreviewSource(workspacePlaybackMedia) || undefined}
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
                              <Badge variant="light">{nodeRuntimeStatus.status.backend}</Badge>
                              <Badge variant="light">
                                {nodeRuntimeStatus.status.playback?.state || "unknown"}
                              </Badge>
                              {nodeRuntimeBusy ? <Badge variant="light">refreshing</Badge> : null}
                            </Group>
                            <Text fw={700}>
                              {nodeRuntimeStatus.status.playback?.title ||
                                workspacePlaybackMedia?.title ||
                                nodeRuntimeStatus.status.playback?.mediaId ||
                                nodeRuntimeStatus.status.currentItemId ||
                                "No active media"}
                            </Text>
                            <Text size="sm" c="dimmed">
                              {nodeRuntimeStatus.status.playback?.artist ||
                                workspacePlaybackMedia?.artist ||
                                "unknown artist"}
                            </Text>
                            {typeof nodeRuntimeStatus.status.playback?.progressPercent ===
                            "number" ? (
                              <>
                                <Progress
                                  value={Math.max(
                                    0,
                                    Math.min(100, nodeRuntimeStatus.status.playback.progressPercent)
                                  )}
                                />
                                <Text size="xs" c="dimmed">
                                  {formatDurationSec(nodeRuntimeStatus.status.playback.positionSec ?? null)} /{" "}
                                  {formatDurationSec(nodeRuntimeStatus.status.playback.durationSec ?? null)}
                                </Text>
                              </>
                            ) : (
                              <Text size="xs" c="dimmed">
                                Playback progress unavailable for this target.
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
                ) : null}
              </>
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
              <Button size={isMobile ? "xs" : "sm"} variant="light" onClick={selectVisible}>
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
                {`Edit ${selectedNodeIds.length} ${selectedNodeIds.length === 1 ? "node" : "nodes"}`}
              </Button>
              <Button
                size={isMobile ? "xs" : "sm"}
                variant="light"
                leftSection={<IconSquareRoundedPlus size={16} />}
                onClick={() => {
                  openCreateNodeEditor();
                  setFleetView("workspace");
                }}
              >
                Add Node
              </Button>
            </Group>
          </Stack>

          {loadingFleet && filteredRows.length === 0 ? (
            <SectionLoader label="Loading node inventory..." />
          ) : isMobile ? (
            <Stack>
              {filteredRows.map((row) => (
                <Card
                  key={row.id}
                  withBorder
                  p="sm"
                  style={{ cursor: "pointer" }}
                  onClick={() => openRowWorkspace(row.id)}
                >
                  <Stack gap="xs">
                    <Group justify="space-between" wrap="nowrap">
                      <Group gap="xs" wrap="nowrap">
                        <Checkbox
                          checked={selectedNodeIds.includes(row.id)}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(e) => toggleNodeSelection(row.id, e.currentTarget.checked)}
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
                        {row.connectivity?.status || "offline"} {row.connectivity?.score ?? 0}/
                        {row.connectivity?.total ?? 5}
                      </Badge>
                    </Group>
                    <Text size="xs" ff="monospace">
                      {row.host} {row.ip ? `• ${row.ip}` : ""}
                    </Text>
                    <Group gap={6}>
                      {statusBadge(row.dnsOk, "DNS", "DNS")}
                      {statusBadge(row.tcp.ssh22.ok, "SSH", "SSH")}
                      {statusBadge(row.http.nodeStatus.ok, "Node", "Node")}
                      {statusBadge(row.http.cableVersion.ok, "Cable", "Cable")}
                    </Group>
                    {(() => {
                      const runtime = resolveRuntimeCard(row.chibaNode.kioskUrl ?? null);
                      return (
                        <Group gap="xs" wrap="nowrap">
                          {runtime.thumbnailUrl ? (
                            <Image
                              src={runtime.thumbnailUrl}
                              alt={runtime.label}
                              w={72}
                              h={42}
                              radius="sm"
                              fit="cover"
                            />
                          ) : null}
                          <Stack gap={0} style={{ minWidth: 0 }}>
                            <Group gap={6}>
                              <Badge size="xs" variant="light">
                                {runtime.kind}
                              </Badge>
                            </Group>
                            <Text size="xs" fw={600} lineClamp={1}>
                              {runtime.label}
                            </Text>
                            {runtime.subtitle ? (
                              <Text size="xs" c="dimmed" lineClamp={1}>
                                {runtime.subtitle}
                              </Text>
                            ) : null}
                          </Stack>
                        </Group>
                      );
                    })()}
                    <Text size="xs" c="dimmed">
                      node {row.chibaNode.version ?? "?"} • cable {row.cableServer?.version ?? "?"} •{" "}
                      {Math.max(0, Math.round((Date.now() - row.lastCheckedAt) / 1000))}
                      s ago
                    </Text>
                    <Group gap="xs" grow>
                      <Button
                        variant="light"
                        size="xs"
                        onClick={(event) => {
                          event.stopPropagation();
                          setActiveNodeId(row.id);
                        }}
                      >
                        Inspect
                      </Button>
                      <Button
                        variant="light"
                        color="blue"
                        size="xs"
                        onClick={(event) => {
                          event.stopPropagation();
                          openEditNodeEditor(row.id);
                          setFleetView("workspace");
                          setNodeEditorOpen(true);
                          setAssignTargetOpen(false);
                          setWorkspacePanel("edit");
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="light"
                        color="red"
                        size="xs"
                        onClick={(event) => {
                          event.stopPropagation();
                          void removeNode(row.id);
                        }}
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
                <Table striped highlightOnHover withTableBorder withColumnBorders>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={42}>
                        <Checkbox
                          checked={
                            filteredRows.length > 0 &&
                            filteredRows.every((row) => selectedNodeIds.includes(row.id))
                          }
                          onChange={(e) => {
                            if (e.currentTarget.checked) {
                              setSelectedNodeIds(
                                Array.from(new Set([...selectedNodeIds, ...filteredRows.map((row) => row.id)]))
                              );
                            } else {
                              setSelectedNodeIds((prev) =>
                                prev.filter((id) => !filteredRows.some((row) => row.id === id))
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
                      <Table.Tr
                        key={row.id}
                        onClick={() => openRowWorkspace(row.id)}
                        style={{ cursor: "pointer" }}
                      >
                        <Table.Td>
                          <Checkbox
                            checked={selectedNodeIds.includes(row.id)}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(e) => toggleNodeSelection(row.id, e.currentTarget.checked)}
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
                              registry: {row.registryId || activeRegistryId}
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
                                    : row.connectivity?.status === "degraded"
                                    ? "yellow"
                                    : "red"
                                }
                                variant="light"
                              >
                                {row.connectivity?.status || "offline"} {row.connectivity?.score ?? 0}/
                                {row.connectivity?.total ?? 5}
                              </Badge>
                            </Group>
                            <Group gap={6}>
                              {statusBadge(row.dnsOk, "DNS", "DNS")}
                              {statusBadge(row.tcp.ssh22.ok, "SSH", "SSH")}
                              {statusBadge(row.http.nodeStatus.ok, "Node", "Node")}
                              {statusBadge(row.http.cableVersion.ok, "Cable", "Cable")}
                            </Group>
                          </Stack>
                        </Table.Td>
                        <Table.Td>
                          <Stack gap={4}>
                            {(() => {
                              const runtime = resolveRuntimeCard(row.chibaNode.kioskUrl ?? null);
                              return (
                                <Group gap="xs" wrap="nowrap" align="flex-start">
                                  {runtime.thumbnailUrl ? (
                                    <Image
                                      src={runtime.thumbnailUrl}
                                      alt={runtime.label}
                                      w={88}
                                      h={52}
                                      radius="sm"
                                      fit="cover"
                                    />
                                  ) : null}
                                  <Stack gap={2} style={{ minWidth: 0 }}>
                                    <Group gap={6}>
                                      <Badge size="xs" variant="light">
                                        {runtime.kind}
                                      </Badge>
                                    </Group>
                                    <Text size="sm" fw={600} lineClamp={1}>
                                      {runtime.label}
                                    </Text>
                                    {runtime.subtitle ? (
                                      <Text size="xs" c="dimmed" lineClamp={1}>
                                        {runtime.subtitle}
                                      </Text>
                                    ) : null}
                                  </Stack>
                                </Group>
                              );
                            })()}
                            <Button
                              variant="subtle"
                              size="compact-xs"
                              leftSection={<IconBroadcast size={12} />}
                              onClick={(event) => {
                                event.stopPropagation();
                                setActiveNodeId(row.id);
                              }}
                            >
                              Inspect
                            </Button>
                          </Stack>
                        </Table.Td>
                        <Table.Td>
                          <Stack gap={2}>
                            <Text size="xs">node: {row.chibaNode.version ?? "?"}</Text>
                            <Text size="xs">cable: {row.cableServer?.version ?? "?"}</Text>
                            <Text size="xs" c="dimmed">
                              sha: {row.cableServer?.gitSha ?? "—"}
                            </Text>
                          </Stack>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {Math.max(0, Math.round((Date.now() - row.lastCheckedAt) / 1000))}
                            s ago
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={6}>
                            <ActionIcon
                              variant="light"
                              color="blue"
                              onClick={(event) => {
                                event.stopPropagation();
                                openEditNodeEditor(row.id);
                                setFleetView("workspace");
                                setNodeEditorOpen(true);
                                setAssignTargetOpen(false);
                                setWorkspacePanel("edit");
                              }}
                              title="Edit node"
                            >
                              <IconPencil size={14} />
                            </ActionIcon>
                            <ActionIcon
                              variant="light"
                              color="red"
                              onClick={(event) => {
                                event.stopPropagation();
                                void removeNode(row.id);
                              }}
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
                  {tableRangeLabel(filteredRows.length, fleetPage, TABLE_PAGE_SIZE.fleet)}
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
  );
}
