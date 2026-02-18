import {
  AppShell,
  Button,
  Group,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Tabs,
  Title,
} from "@mantine/core";
import { IngestSection } from "./components/builder/IngestSection";
import { ContainerEditorsView } from "./components/builder/ContainerEditorsView";
import { MediaDetailView } from "./components/builder/MediaDetailView";
import { MediaLibraryView } from "./components/builder/MediaLibraryView";
import { MediaPlaylistTablesView } from "./components/builder/MediaPlaylistTablesView";
import { PlaylistEditorView } from "./components/builder/PlaylistEditorView";
import { MediaPickerModal } from "./components/MediaPickerModal";
import { NodeInspectorModal } from "./components/NodeInspectorModal";
import { OpsHeader } from "./components/OpsHeader";
import { OpsSidebar } from "./components/OpsSidebar";
import { QuickSendModal } from "./components/QuickSendModal";
import { ResourcePickerModal } from "./components/ResourcePickerModal";
import { FleetScreen } from "./components/screens/FleetScreen";
import { useOpsAppModel } from "./hooks/useOpsAppModel";

export default function App() {
  const {
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
  } = useOpsAppModel();

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
        <OpsHeader
          isMobile={Boolean(isMobile)}
          controlOpen={controlOpen}
          onToggleControl={toggleControlOpen}
          autoRefresh={autoRefresh}
          onAutoRefreshChange={setAutoRefresh}
          loadingFleet={loadingFleet}
          onRefreshAll={() => {
            refreshFleet();
            void refreshNodesInventory();
            void refreshCatalogAndProfiles();
            void refreshServerSnapshot();
          }}
        />
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <OpsSidebar
          isMobile={Boolean(isMobile)}
          mainTab={mainTab}
          builderTab={builderTab}
          onOpenNodeOps={() => {
            setMainTab("fleet");
            setFleetView("table");
            updateOpsUrl({ view: null, playlistId: null }, "replace");
            if (isMobile) setControlOpen(false);
          }}
          onOpenIngestion={() => {
            setMainTab("builder");
            setBuilderTab("ingest");
            updateOpsUrl({ view: null, playlistId: null }, "replace");
            if (isMobile) setControlOpen(false);
          }}
          onOpenMediaLibrary={() => {
            setMainTab("builder");
            setBuilderTab("media");
            setMediaLibrarySection("media");
            updateOpsUrl({ view: null, playlistId: null }, "replace");
            if (isMobile) setControlOpen(false);
          }}
          selectedNodeCount={selectedNodeIds.length}
          visibleNodeCount={filteredRows.length}
          metrics={metrics}
          onOpenNodeWorkspace={() => {
            openNodeWorkspace();
            if (isMobile) setControlOpen(false);
          }}
          lastTick={lastTick}
        />
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
          <FleetScreen vm={fleetScreenVm} />

          <Tabs.Panel value="builder" pt="md">
            <SimpleGrid cols={1} spacing="md">
              <Paper withBorder radius="md" p="md">
                <Stack gap="md">
                  <Group justify="space-between" align="center" wrap="wrap">
                    <Title order={4}>
                      {builderTab === "ingest"
                        ? "Add Media"
                        : builderTab === "playlistEditor"
                        ? "Playlist Editor"
                        : builderTab === "mediaDetail"
                        ? "Media Detail"
                        : "Media Library"}
                    </Title>
                    {builderTab !== "ingest" &&
                    builderTab !== "mediaDetail" &&
                    builderTab !== "playlistEditor" ? (
                      <Button
                        size="xs"
                        variant="light"
                        onClick={() => {
                          if (currentLibraryPane === "media") {
                            setBuilderTab("ingest");
                            return;
                          }
                          if (currentLibraryPane === "playlists") {
                            openPlaylistEditorRoute();
                            return;
                          }
                          if (currentLibraryPane === "blocks") {
                            setBuilderTab("block");
                            setSelectedBlockId(null);
                            setBlockDraft({
                              id: "",
                              title: "",
                              playlistIds: [],
                            });
                            return;
                          }
                          if (currentLibraryPane === "channels") {
                            setBuilderTab("channel");
                            setSelectedChannelId(null);
                            setChannelDraft({
                              id: "",
                              title: "",
                              blockIds: [],
                            });
                            return;
                          }
                          setBuilderTab("profile");
                          setSelectedProfileId(null);
                          setProfileDraft({
                            id: "",
                            title: "",
                            defaultTargetKind: "channel",
                            defaultTargetId: "",
                          });
                        }}
                      >
                        {currentLibraryPane === "media"
                          ? "Add Media"
                          : currentLibraryPane === "playlists"
                          ? "New Playlist"
                          : currentLibraryPane === "blocks"
                          ? "New Block"
                          : currentLibraryPane === "channels"
                          ? "New Channel"
                          : "New Profile"}
                      </Button>
                    ) : null}
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
                    <IngestSection vm={ingestSectionVm} />
                  ) : null}

                  <MediaLibraryView vm={mediaLibraryVm} />

                  {builderTab === "playlistEditor" ? (
                    <PlaylistEditorView vm={playlistEditorVm} />
                  ) : null}

                  {builderTab === "mediaDetail" ? (
                    <MediaDetailView vm={mediaDetailVm} />
                  ) : null}

                  <MediaPlaylistTablesView vm={mediaPlaylistTablesVm} />

                  <ContainerEditorsView vm={containerEditorsVm} />
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

      <QuickSendModal
        opened={quickSendOpen}
        onClose={() => setQuickSendOpen(false)}
        isMobile={Boolean(isMobile)}
        target={quickSendTarget}
        query={quickSendQuery}
        setQuery={setQuickSendQuery}
        rows={quickSendRows}
        nodeIds={quickSendNodeIds}
        setNodeIds={setQuickSendNodeIds}
        busy={quickSendBusy}
        onRun={runQuickSend}
      />

      <NodeInspectorModal
        opened={Boolean(selectedNode)}
        onClose={() => setActiveNodeId(null)}
        isMobile={Boolean(isMobile)}
        selectedNode={selectedNode}
        parseTargetFromKioskUrl={parseTargetFromKioskUrl}
        statusBadge={statusBadge}
        onEditNode={(nodeId) => {
          if (!nodeId) return;
          openEditNodeEditor(nodeId);
        }}
      />
    </AppShell>
  );
}
