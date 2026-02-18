import type { ReactNode } from "react";
import {
  Accordion,
  Button,
  Group,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAdjustments } from "@tabler/icons-react";
import type { OpsApplyResponse, OpsApplyTarget } from "../types";
import { DetailBreadcrumbs, type DetailBreadcrumb } from "./DetailBreadcrumbs";

type CatalogOption = { value: string; label: string };

type AssignTargetPanelProps = {
  selectedNodeCount: number;
  applyKind: OpsApplyTarget;
  setApplyKind: (value: OpsApplyTarget) => void;
  applyId: string;
  setApplyId: (value: string) => void;
  currentApplyOptions: CatalogOption[];
  onOpenTargetPicker: () => void;
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
  applyResult: OpsApplyResponse | null;
  summarizeApplyResult: (result: OpsApplyResponse) => string;
  onClose: () => void;
  breadcrumbs: DetailBreadcrumb[];
};

export function AssignTargetPanel({
  selectedNodeCount,
  applyKind,
  setApplyKind,
  applyId,
  setApplyId,
  currentApplyOptions,
  onOpenTargetPicker,
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
  onClose,
  breadcrumbs,
}: AssignTargetPanelProps) {
  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="md">
        <Stack gap={4}>
          <DetailBreadcrumbs items={breadcrumbs} />
          <Title order={5}>Assign Target + Launch Options</Title>
        </Stack>

        <Text size="sm" c="dimmed">
          Apply media/container state to selected nodes. Use "inherit" to keep
          existing launch behavior.
        </Text>

        <Accordion multiple defaultValue={["target", "playback", "overlays"]}>
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
                    const next = (value as OpsApplyTarget) || "profile";
                    setApplyKind(next);
                    setApplyId("");
                  }}
                />
                {applyKind === "media" || applyKind === "playlist" ? (
                  <Stack gap={6}>
                    <Group gap="xs" align="end" wrap="nowrap">
                      <TextInput
                        label="Target resource"
                        placeholder={`Select ${applyKind}`}
                        value={applyId}
                        readOnly
                        style={{ flex: 1 }}
                      />
                      <Button variant="light" onClick={onOpenTargetPicker}>
                        Browse
                      </Button>
                    </Group>
                    <Text size="xs" c="dimmed">
                      Use searchable card picker for media and playlists.
                    </Text>
                  </Stack>
                ) : (
                  <Select
                    label="Target resource"
                    placeholder="Search target id"
                    searchable
                    data={currentApplyOptions}
                    value={applyId}
                    onChange={(value) => setApplyId(value || "")}
                  />
                )}
                {applyTargetPreviewCard}
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>

          <Accordion.Item value="playback">
            <Accordion.Control>Playback Mode</Accordion.Control>
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
                  setOptMode((v as "inherit" | "guide" | "gallery") || "inherit")
                }
              />
            </Accordion.Panel>
          </Accordion.Item>

          <Accordion.Item value="overlays">
            <Accordion.Control>Overlays & Lock</Accordion.Control>
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
                    setOptLock((v as "inherit" | "on" | "off") || "inherit")
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
                    setOptQr((v as "inherit" | "on" | "off") || "inherit")
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
                    setOptPlaylist((v as "inherit" | "on" | "off") || "inherit")
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
                    setOptNosplash((v as "inherit" | "on" | "off") || "inherit")
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
                    setOptHud(
                      (v as "inherit" | "always" | "start" | "never") || "inherit"
                    )
                  }
                />
                <NumberInput
                  label="Visible seconds"
                  value={optHudSec}
                  onChange={(value) =>
                    setOptHudSec(
                      typeof value === "number" && Number.isFinite(value) ? value : ""
                    )
                  }
                  min={1}
                  max={120}
                  placeholder="inherit"
                />
                <TextInput
                  label="Theme"
                  value={optTheme}
                  onChange={(e) => setOptTheme(e.currentTarget.value)}
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
                  setOptRotate((v as "inherit" | "0" | "90" | "180" | "270") || "inherit")
                }
              />
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>

        <Group justify="space-between" wrap="wrap">
          <Text size="sm" c="dimmed">
            {selectedNodeCount} selected node(s)
          </Text>
          <Group gap="xs">
            <Button variant="light" color="gray" onClick={onClose}>
              Close
            </Button>
            <Button
              leftSection={<IconAdjustments size={16} />}
              onClick={() => void runApply()}
              disabled={!applyId.trim() || selectedNodeCount === 0}
            >
              Apply to selected
            </Button>
          </Group>
        </Group>

        {applyResult ? (
          <Paper withBorder p="sm">
            <Text fw={600} mb={4}>
              Last apply
            </Text>
            <Text size="sm" c={applyResult.ok ? "teal" : "orange"}>
              {summarizeApplyResult(applyResult)}
            </Text>
          </Paper>
        ) : null}
      </Stack>
    </Paper>
  );
}
