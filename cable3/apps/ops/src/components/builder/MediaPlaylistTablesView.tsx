import type { Dispatch, SetStateAction } from "react";
import {
  ActionIcon,
  Button,
  Card,
  Group,
  Pagination,
  ScrollArea,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import { IconPencil, IconTrash } from "@tabler/icons-react";
import type { Media } from "../../lib/controlApi";
import type { BuilderMode } from "../../store/uiStore";
import {
  TABLE_PAGE_SIZE,
  tableRangeLabel,
  type DraftPlaylist,
  type DraftStore,
} from "../../lib/opsModel";

export type MediaPlaylistTablesVm = {
  builderTab: BuilderMode;
  mediaTableRowsPage: Media[];
  setSelectedServerMediaId: (id: string | null) => void;
  setMediaDetailId: (id: string | null) => void;
  setBuilderTab: (tab: BuilderMode) => void;
  serverMediaCount: number;
  mediaTablePage: number;
  setMediaTablePage: (page: number) => void;
  mediaTablePageCount: number;
  isMobile: boolean;
  playlistRowsPage: DraftPlaylist[];
  openPlaylistEditorRoute: (playlistId?: string) => void;
  selectedPlaylistId: string | null;
  setDraftStore: Dispatch<SetStateAction<DraftStore>>;
  playlistCount: number;
  playlistTablePage: number;
  setPlaylistTablePage: (page: number) => void;
  playlistTablePageCount: number;
};

export function MediaPlaylistTablesView({ vm }: { vm: MediaPlaylistTablesVm }) {
  const {
    builderTab,
    mediaTableRowsPage,
    setSelectedServerMediaId,
    setMediaDetailId,
    setBuilderTab,
    serverMediaCount,
    mediaTablePage,
    setMediaTablePage,
    mediaTablePageCount,
    isMobile,
    playlistRowsPage,
    openPlaylistEditorRoute,
    selectedPlaylistId,
    setDraftStore,
    playlistCount,
    playlistTablePage,
    setPlaylistTablePage,
    playlistTablePageCount,
  } = vm;

  return (
    <>
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
                                    serverMediaCount,
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
                                    playlistCount,
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
    </>
  );
}
