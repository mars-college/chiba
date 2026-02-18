import type { ReactNode } from "react";
import {
  Accordion,
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { IconAdjustments } from "@tabler/icons-react";
import type { OpsApplyTarget, OpsApplyResponse } from "../types";

type CatalogOption = { value: string; label: string };

type Props = {
  opened: boolean;
  onClose: () => void;
  isMobile: boolean;
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
};

export function AssignTargetModal(props: Props) {
  return (
    <Modal
      opened={props.opened}
      onClose={props.onClose}
      size={props.isMobile ? "100%" : "xl"}
      title="Assign Target + Launch Options"
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Apply media/container state to selected nodes. Use “inherit” to keep existing launch
          behavior.
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
                  value={props.applyKind}
                  onChange={(value) => {
                    const next = (value as OpsApplyTarget) || "profile";
                    props.setApplyKind(next);
                    props.setApplyId("");
                  }}
                />
                {props.applyKind === "media" || props.applyKind === "playlist" ? (
                  <Stack gap={6}>
                    <Group gap="xs" align="end" wrap="nowrap">
                      <TextInput
                        label="Target resource"
                        placeholder={`Select ${props.applyKind}`}
                        value={props.applyId}
                        readOnly
                        style={{ flex: 1 }}
                      />
                      <Button variant="light" onClick={props.onOpenTargetPicker}>
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
                    data={props.currentApplyOptions}
                    value={props.applyId}
                    onChange={(value) => props.setApplyId(value || "")}
                  />
                )}
                {props.applyTargetPreviewCard}
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
                value={props.optMode}
                onChange={(v) => props.setOptMode((v as "inherit" | "guide" | "gallery") || "inherit")}
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
                  value={props.optLock}
                  onChange={(v) => props.setOptLock((v as "inherit" | "on" | "off") || "inherit")}
                />
                <Select
                  label="QR overlay"
                  data={[
                    { value: "inherit", label: "inherit" },
                    { value: "on", label: "on" },
                    { value: "off", label: "off" },
                  ]}
                  value={props.optQr}
                  onChange={(v) => props.setOptQr((v as "inherit" | "on" | "off") || "inherit")}
                />
                <Select
                  label="Playlist overlay"
                  data={[
                    { value: "inherit", label: "inherit" },
                    { value: "on", label: "on" },
                    { value: "off", label: "off" },
                  ]}
                  value={props.optPlaylist}
                  onChange={(v) =>
                    props.setOptPlaylist((v as "inherit" | "on" | "off") || "inherit")
                  }
                />
                <Select
                  label="Skip splash"
                  data={[
                    { value: "inherit", label: "inherit" },
                    { value: "on", label: "on" },
                    { value: "off", label: "off" },
                  ]}
                  value={props.optNosplash}
                  onChange={(v) =>
                    props.setOptNosplash((v as "inherit" | "on" | "off") || "inherit")
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
                  value={props.optHud}
                  onChange={(v) =>
                    props.setOptHud((v as "inherit" | "always" | "start" | "never") || "inherit")
                  }
                />
                <NumberInput
                  label="Visible seconds"
                  value={props.optHudSec}
                  onChange={(value) =>
                    props.setOptHudSec(
                      typeof value === "number" && Number.isFinite(value) ? value : ""
                    )
                  }
                  min={1}
                  max={120}
                  placeholder="inherit"
                />
                <TextInput
                  label="Theme"
                  value={props.optTheme}
                  onChange={(e) => props.setOptTheme(e.currentTarget.value)}
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
                value={props.optRotate}
                onChange={(v) =>
                  props.setOptRotate((v as "inherit" | "0" | "90" | "180" | "270") || "inherit")
                }
              />
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>

        <Group justify="space-between" wrap="wrap">
          <Text size="sm" c="dimmed">
            {props.selectedNodeCount} selected node(s)
          </Text>
          <Group gap="xs">
            <Button variant="light" color="gray" onClick={props.onClose}>
              Close
            </Button>
            <Button
              leftSection={<IconAdjustments size={16} />}
              onClick={() => void props.runApply()}
              disabled={!props.applyId.trim() || props.selectedNodeCount === 0}
            >
              Apply to selected
            </Button>
          </Group>
        </Group>

        {props.applyResult ? (
          <Paper withBorder p="sm">
            <Text fw={600} mb={4}>
              Last apply
            </Text>
            <Text size="sm" c={props.applyResult.ok ? "teal" : "orange"}>
              {props.summarizeApplyResult(props.applyResult)}
            </Text>
          </Paper>
        ) : null}
      </Stack>
    </Modal>
  );
}
