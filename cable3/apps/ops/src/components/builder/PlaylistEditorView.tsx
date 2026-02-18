import type { Dispatch, SetStateAction } from "react";
import {
  ActionIcon,
  Anchor,
  Breadcrumbs,
  Button,
  Group,
  Image,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconGripVertical, IconSearch, IconTrash } from "@tabler/icons-react";
import type { Media } from "../../lib/controlApi";
import type { DraftPlaylist, DraftStore } from "../../lib/opsModel";

export type PlaylistEditorViewVm = {
  isMobile: boolean;
  playlistDraft: DraftPlaylist;
  setPlaylistDraft: Dispatch<SetStateAction<DraftPlaylist>>;
  closePlaylistEditorRoute: () => void;
  setMediaPickerOpen: (open: boolean) => void;
  setDraftStore: Dispatch<SetStateAction<DraftStore>>;
  setSelectedPlaylistId: (id: string | null) => void;
  mergedMedia: Media[];
  playlistDragIndex: number | null;
  setPlaylistDragIndex: (index: number | null) => void;
  playlistDropIndex: number | null;
  setPlaylistDropIndex: Dispatch<SetStateAction<number | null>>;
  commitPlaylistDrop: (targetIndex: number) => void;
};

export function PlaylistEditorView({ vm }: { vm: PlaylistEditorViewVm }) {
  const {
    isMobile,
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
  } = vm;

  return (
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
  );
}
