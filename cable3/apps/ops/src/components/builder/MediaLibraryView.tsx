import type { Dispatch, SetStateAction } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Image,
  Loader,
  Pagination,
  Paper,
  Progress,
  ScrollArea,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import {
  IconBroadcast,
  IconPencil,
  IconSearch,
  IconTrash,
} from "@tabler/icons-react";
import type { Media, MediaIngestJob } from "../../lib/controlApi";
import type { BuilderMode } from "../../store/uiStore";
import {
  isVideoMedia,
  mediaPreviewSource,
  TABLE_PAGE_SIZE,
  tableRangeLabel,
  type DraftPlaylist,
} from "../../lib/opsModel";
import { SectionLoader } from "../SectionLoader";

export type MediaLibraryViewVm = {
  builderTab: BuilderMode;
  loadingSnapshot: boolean;
  mediaLibrarySection: "media" | "playlists" | "blocks" | "channels" | "profiles";
  playlistLibraryView: "cards" | "table";
  setPlaylistLibraryView: (value: "cards" | "table") => void;
  serverMediaFiltered: Media[];
  serverMedia: Media[];
  refreshServerSnapshot: () => Promise<void>;
  openPlaylistEditorRoute: (playlistId?: string) => void;
  serverMediaQuery: string;
  setServerMediaQuery: (value: string) => void;
  serverMediaSourceFilter: "all" | "path" | "url";
  setServerMediaSourceFilter: (value: "all" | "path" | "url") => void;
  mediaFilterData: Array<{ value: string; label: string }>;
  hasMoreMediaFeed: boolean;
  setMediaFeedLimit: Dispatch<SetStateAction<number>>;
  activeIngestJobs: MediaIngestJob[];
  mediaFeedItems: Media[];
  selectedServerMediaId: string | null;
  setSelectedServerMediaId: (id: string | null) => void;
  setMediaDetailId: (id: string | null) => void;
  setBuilderTab: (tab: BuilderMode) => void;
  openQuickSend: (target: { kind: "media" | "playlist"; id: string; label: string }) => void;
  deleteMediaItem: (id: string) => Promise<void>;
  draftPlaylists: DraftPlaylist[];
  mergedMediaById: Map<string, Media>;
  deletePlaylistDraft: (id: string) => void;
  playlistRowsPage: DraftPlaylist[];
  selectedPlaylistId: string | null;
  playlistTablePage: number;
  setPlaylistTablePage: (page: number) => void;
  playlistTablePageCount: number;
  isMobile: boolean;
};

export function MediaLibraryView({ vm }: { vm: MediaLibraryViewVm }) {
  const {
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
    draftPlaylists,
    mergedMediaById,
    deletePlaylistDraft,
    playlistRowsPage,
    selectedPlaylistId,
    playlistTablePage,
    setPlaylistTablePage,
    playlistTablePageCount,
    isMobile,
  } = vm;

  return (
    <>
                        {builderTab === "media" ? (
                          <Stack gap="md">
                            <Group
                              justify="space-between"
                              align="flex-end"
                              wrap="wrap"
                            >
                              <Group gap="sm" wrap="wrap">
                                {mediaLibrarySection === "media" ? (
                                  <Button
                                    size="xs"
                                    variant="light"
                                    onClick={() => setBuilderTab("ingest")}
                                  >
                                    Add Media
                                  </Button>
                                ) : null}
                                {mediaLibrarySection === "playlists" ? (
                                  <Button
                                    size="xs"
                                    variant="light"
                                    onClick={() => openPlaylistEditorRoute()}
                                  >
                                    New Playlist
                                  </Button>
                                ) : null}
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
                              ) : null}
                            </Group>
      
                            {mediaLibrarySection === "media" ? (
                              <>
                                {loadingSnapshot && serverMedia.length === 0 ? (
                                  <SectionLoader label="Loading media library..." />
                                ) : null}
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
                                    {draftPlaylists.map((row) => (
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
                                          draftPlaylists.length,
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
                                {draftPlaylists.length === 0 ? (
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
    </>
  );
}
