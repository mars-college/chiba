import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Code,
  Divider,
  Group,
  Image,
  Loader,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  TextInput,
} from "@mantine/core";
import {
  IconPhotoPlus,
  IconStack2,
  IconTrash,
  IconUpload,
  IconWorldWww,
} from "@tabler/icons-react";
import type { MediaIngestJob } from "../../lib/controlApi";
import {
  formatBytes,
  type IngestSource,
  type UploadPreviewItem,
} from "../../lib/opsModel";

export type IngestSectionVm = {
  ingestStep: 1 | 2 | 3;
  activeIngestJobs: MediaIngestJob[];
  runningIngestCount: number;
  ingestSource: IngestSource;
  setIngestSource: (source: IngestSource) => void;
  setIngestStep: (step: 1 | 2 | 3) => void;
  selectedIngestLabel: string;
  youtubeUrl: string;
  setYoutubeUrl: (value: string) => void;
  youtubeTitle: string;
  setYoutubeTitle: (value: string) => void;
  youtubeArtist: string;
  setYoutubeArtist: (value: string) => void;
  webUrl: string;
  setWebUrl: (value: string) => void;
  webTitle: string;
  setWebTitle: (value: string) => void;
  webArtist: string;
  setWebArtist: (value: string) => void;
  webDescription: string;
  setWebDescription: (value: string) => void;
  webCache: boolean;
  setWebCache: (value: boolean) => void;
  edenInput: string;
  setEdenInput: (value: string) => void;
  getUploadRootProps: () => any;
  getUploadInputProps: () => any;
  isUploadDragActive: boolean;
  uploadFiles: File[];
  uploadArtist: string;
  setUploadArtist: (value: string) => void;
  uploadDescription: string;
  setUploadDescription: (value: string) => void;
  uploadPreviewItems: UploadPreviewItem[];
  removeUploadFileAtIndex: (index: number) => void;
  uploadDropError: string | null;
  canQueueIngest: boolean;
  ingestBusy: boolean;
  runYouTubeIngest: () => Promise<void>;
  runEdenIngest: () => Promise<void>;
  runWebIngest: () => Promise<void>;
  runUploadIngest: () => Promise<void>;
};

export function IngestSection({ vm }: { vm: IngestSectionVm }) {
  const {
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
  } = vm;

  return (
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
                            <Stack gap="md">
                              <Stack gap={2}>
                                <Text fw={700} size="sm">
                                  Online Sources
                                </Text>
                                <Text size="xs" c="dimmed">
                                  Pull from existing URLs and external catalogs.
                                </Text>
                              </Stack>
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
                                    ingestSource === "web" ? " is-selected" : ""
                                  }`}
                                  onClick={() => {
                                    setIngestSource("web");
                                    setIngestStep(2);
                                  }}
                                >
                                  <Stack gap="xs">
                                    <Group gap={8}>
                                      <IconWorldWww size={18} />
                                      <Text fw={700}>Web Link</Text>
                                    </Group>
                                    <Text size="sm" c="dimmed">
                                      Add a direct URL as media without uploading.
                                    </Text>
                                  </Stack>
                                </Card>
                              </SimpleGrid>

                              <Divider />

                              <Stack gap={2}>
                                <Text fw={700} size="sm">
                                  Local Assets
                                </Text>
                                <Text size="xs" c="dimmed">
                                  Upload files to asset storage and auto-create media records.
                                </Text>
                              </Stack>
                              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
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
                            </Stack>
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
                                {ingestSource === "web" ? (
                                  <Stack>
                                    <TextInput
                                      label="Web URL"
                                      placeholder="https://example.com/media.mp4"
                                      value={webUrl}
                                      onChange={(e) =>
                                        setWebUrl(e.currentTarget.value)
                                      }
                                    />
                                    <SimpleGrid cols={{ base: 1, sm: 2 }}>
                                      <TextInput
                                        label="Title (optional)"
                                        value={webTitle}
                                        onChange={(e) =>
                                          setWebTitle(e.currentTarget.value)
                                        }
                                      />
                                      <TextInput
                                        label="Artist (optional)"
                                        value={webArtist}
                                        onChange={(e) =>
                                          setWebArtist(e.currentTarget.value)
                                        }
                                      />
                                    </SimpleGrid>
                                    <Textarea
                                      label="Description (optional)"
                                      minRows={2}
                                      maxRows={4}
                                      autosize
                                      value={webDescription}
                                      onChange={(e) =>
                                        setWebDescription(e.currentTarget.value)
                                      }
                                    />
                                    <Button
                                      variant={webCache ? "filled" : "light"}
                                      onClick={() => setWebCache(!webCache)}
                                      style={{ alignSelf: "flex-start" }}
                                    >
                                      {webCache
                                        ? "Cache enabled on nodes"
                                        : "Cache disabled on nodes"}
                                    </Button>
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
                                <Group justify="space-between">
                                  <Button
                                    variant="light"
                                    onClick={() => setIngestStep(1)}
                                    disabled={ingestBusy}
                                  >
                                    Back
                                  </Button>
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
                                      : ingestSource === "web"
                                      ? JSON.stringify(
                                          {
                                            sourceType: "url",
                                            sourceValue: webUrl.trim(),
                                            title: webTitle.trim() || undefined,
                                            artist: webArtist.trim() || undefined,
                                            description:
                                              webDescription.trim() || undefined,
                                            cache: webCache,
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
                                      if (ingestSource === "web") {
                                        void runWebIngest();
                                        return;
                                      }
                                      void runUploadIngest();
                                    }}
                                  >
                                    {ingestSource === "web"
                                      ? "Create Media Record"
                                      : "Queue Ingest Job"}
                                  </Button>
                                </Group>
                              </Stack>
                            </Card>
                          ) : null}
                        </Stack>
  );
}
