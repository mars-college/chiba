import { useEffect, useMemo, useState } from "react";
import {
  Accordion,
  Button,
  Card,
  Code,
  Group,
  Image,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconBroadcast } from "@tabler/icons-react";
import { DetailBreadcrumbs } from "../DetailBreadcrumbs";
import type { Media } from "../../lib/controlApi";
import type { BuilderMode } from "../../store/uiStore";
import type { QuickSendTarget } from "../../lib/opsModel";

export type MediaDetailViewVm = {
  isMobile: boolean;
  setBuilderTab: (tab: BuilderMode) => void;
  setMediaLibrarySection: (
    section: "media" | "playlists" | "blocks" | "channels" | "profiles"
  ) => void;
  selectedMediaDetail: Media | null;
  selectedMediaDetailPreviewSrc: string | null;
  selectedMediaDetailIsVideo: boolean;
  openQuickSend: (target: QuickSendTarget) => void;
  mediaDeleteBusy: boolean;
  deleteMediaItem: (mediaId: string) => Promise<void>;
  mediaSaveBusy: boolean;
  saveMediaMetadata: (args: {
    id: string;
    title?: string;
    artist?: string;
    description?: string;
  }) => Promise<void>;
};

export function MediaDetailView({ vm }: { vm: MediaDetailViewVm }) {
  const {
    isMobile,
    setBuilderTab,
    setMediaLibrarySection,
    selectedMediaDetail,
    selectedMediaDetailPreviewSrc,
    selectedMediaDetailIsVideo,
    openQuickSend,
    mediaDeleteBusy,
    deleteMediaItem,
    mediaSaveBusy,
    saveMediaMetadata,
  } = vm;

  const [titleDraft, setTitleDraft] = useState("");
  const [artistDraft, setArtistDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");

  useEffect(() => {
    setTitleDraft(selectedMediaDetail?.title || "");
    setArtistDraft(selectedMediaDetail?.artist || "");
    setDescriptionDraft(selectedMediaDetail?.description || "");
  }, [selectedMediaDetail]);

  const hasUnsavedChanges = useMemo(() => {
    if (!selectedMediaDetail) return false;
    return (
      titleDraft.trim() !== (selectedMediaDetail.title || "") ||
      artistDraft.trim() !== (selectedMediaDetail.artist || "") ||
      descriptionDraft.trim() !== (selectedMediaDetail.description || "")
    );
  }, [artistDraft, descriptionDraft, selectedMediaDetail, titleDraft]);

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center" wrap="wrap">
        <Stack gap={4}>
          <DetailBreadcrumbs
            items={[
              {
                label: "Media Library",
                onClick: () => {
                  setMediaLibrarySection("media");
                  setBuilderTab("media");
                },
              },
              { label: selectedMediaDetail?.title || selectedMediaDetail?.id || "Media Detail" },
            ]}
          />
          <Title order={5}>Media Detail</Title>
        </Stack>
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
                  label: selectedMediaDetail.title || selectedMediaDetail.id,
                })
              }
            >
              Send To Node
            </Button>
            <Button
              variant="light"
              loading={mediaSaveBusy}
              disabled={!hasUnsavedChanges}
              onClick={() => {
                void saveMediaMetadata({
                  id: selectedMediaDetail.id,
                  title: titleDraft,
                  artist: artistDraft,
                  description: descriptionDraft,
                }).catch((error) => {
                  notifications.show({
                    color: "red",
                    title: "Save media failed",
                    message: error instanceof Error ? error.message : String(error),
                  });
                });
              }}
            >
              Save Changes
            </Button>
            <Button
              color="red"
              variant="light"
              loading={mediaDeleteBusy}
              onClick={() => void deleteMediaItem(selectedMediaDetail.id)}
            >
              Delete Media
            </Button>
          </Group>
        ) : null}
      </Group>
      {selectedMediaDetail ? (
        <Card withBorder p="md">
          <Stack>
            {selectedMediaDetailPreviewSrc && selectedMediaDetailIsVideo ? (
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
            ) : selectedMediaDetailPreviewSrc ? (
              <Image
                src={selectedMediaDetailPreviewSrc}
                alt={selectedMediaDetail.title || selectedMediaDetail.id}
                radius="sm"
                h={isMobile ? 240 : 520}
                fit="cover"
              />
            ) : selectedMediaDetail.thumbnailUrl ? (
              <Image
                src={selectedMediaDetail.thumbnailUrl}
                alt={selectedMediaDetail.title || selectedMediaDetail.id}
                radius="sm"
                h={isMobile ? 240 : 520}
                fit="cover"
              />
            ) : null}
            <SimpleGrid cols={{ base: 1, md: 2 }}>
              <TextInput label="ID" value={selectedMediaDetail.id} readOnly />
              <TextInput label="Type" value={selectedMediaDetail.sourceType} readOnly />
              <TextInput
                label="Title"
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.currentTarget.value)}
              />
              <TextInput
                label="Artist"
                value={artistDraft}
                onChange={(e) => setArtistDraft(e.currentTarget.value)}
              />
            </SimpleGrid>
            <Textarea
              label="Description"
              autosize
              minRows={3}
              maxRows={8}
              value={descriptionDraft}
              onChange={(e) => setDescriptionDraft(e.currentTarget.value)}
            />
            <Accordion multiple defaultValue={[]}>
              <Accordion.Item value="source">
                <Accordion.Control>Advanced Source</Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="sm">
                    <Text size="sm" c="dimmed">
                      Source path/url is immutable for this media record.
                    </Text>
                    <Code block>{selectedMediaDetail.sourceValue}</Code>
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
              <Accordion.Item value="raw-json">
                <Accordion.Control>Raw JSON</Accordion.Control>
                <Accordion.Panel>
                  <Code block>{JSON.stringify(selectedMediaDetail, null, 2)}</Code>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
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
  );
}
