import type { Dispatch, SetStateAction } from "react";
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  Pagination,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPencil, IconTrash } from "@tabler/icons-react";
import type { BuilderMode } from "../../store/uiStore";
import {
  EMPTY_BLOCK_DRAFT,
  EMPTY_CHANNEL_DRAFT,
  EMPTY_PROFILE_DRAFT,
  TABLE_PAGE_SIZE,
  tableRangeLabel,
  type CatalogOption,
  type DraftBlock,
  type DraftChannel,
  type DraftProfile,
  type DraftStore,
} from "../../lib/opsModel";

export type ContainerEditorsVm = {
  builderTab: BuilderMode;
  setSelectedBlockId: (id: string | null) => void;
  setBlockDraft: Dispatch<SetStateAction<DraftBlock>>;
  draftStore: DraftStore;
  blockRowsPage: DraftBlock[];
  openBlockEditor: (id: string) => void;
  selectedBlockId: string | null;
  setDraftStore: Dispatch<SetStateAction<DraftStore>>;
  blockTablePage: number;
  setBlockTablePage: (page: number) => void;
  blockTablePageCount: number;
  isMobile: boolean;
  blockDraft: DraftBlock;
  setSelectedChannelId: (id: string | null) => void;
  setChannelDraft: Dispatch<SetStateAction<DraftChannel>>;
  channelRowsPage: DraftChannel[];
  openChannelEditor: (id: string) => void;
  selectedChannelId: string | null;
  channelTablePage: number;
  setChannelTablePage: (page: number) => void;
  channelTablePageCount: number;
  channelDraft: DraftChannel;
  setSelectedProfileId: (id: string | null) => void;
  setProfileDraft: Dispatch<SetStateAction<DraftProfile>>;
  profileRowsPage: DraftProfile[];
  openProfileEditor: (id: string) => void;
  selectedProfileId: string | null;
  profileTablePage: number;
  setProfileTablePage: (page: number) => void;
  profileTablePageCount: number;
  profileDraft: DraftProfile;
  profileTargetOptions: CatalogOption[];
};

export function ContainerEditorsView({ vm }: { vm: ContainerEditorsVm }) {
  const {
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
    isMobile,
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
  } = vm;

  return (
    <>
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
    </>
  );
}
