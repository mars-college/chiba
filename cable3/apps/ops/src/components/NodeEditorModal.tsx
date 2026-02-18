import type { Dispatch, SetStateAction } from "react";
import {
  Badge,
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
  Title,
} from "@mantine/core";

export type NodeDraft = {
  registryId: string;
  nodeId: string;
  host: string;
  ip: string;
  nodeName: string;
  orientation: string;
  displayRotate: "" | "0" | "90" | "180" | "270";
  guidePort: number | undefined;
  nodePort: number | undefined;
  serverPort: number | undefined;
  apiKey: string;
};

type Props = {
  opened: boolean;
  onClose: () => void;
  editingNodeId: string | null;
  isMobile: boolean;
  nodeDraft: NodeDraft;
  setNodeDraft: Dispatch<SetStateAction<NodeDraft>>;
  onSave: () => Promise<void>;
  saving: boolean;
};

export function NodeEditorModal(props: Props) {
  return (
    <Modal
      opened={props.opened}
      onClose={props.onClose}
      title={props.editingNodeId ? `Edit Node • ${props.editingNodeId}` : "Add Node"}
      size={props.isMobile ? "100%" : "xl"}
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Node records drive fleet probing, deployments, and profile overrides.
          Define identity first, then network/runtime settings.
        </Text>

        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Group justify="space-between">
              <Title order={6}>Identity</Title>
              <Badge color="red" variant="light">
                Required
              </Badge>
            </Group>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput
                label="Registry ID"
                placeholder="local"
                value={props.nodeDraft.registryId}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  props.setNodeDraft((prev) => ({ ...prev, registryId: value }));
                }}
              />
              <TextInput
                label="Node ID"
                description="Unique stable node identifier"
                placeholder="upper-east-1"
                value={props.nodeDraft.nodeId}
                disabled={Boolean(props.editingNodeId)}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  props.setNodeDraft((prev) => ({ ...prev, nodeId: value }));
                }}
              />
              <TextInput
                label="Node name"
                placeholder="Upper East 1"
                value={props.nodeDraft.nodeName}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  props.setNodeDraft((prev) => ({ ...prev, nodeName: value }));
                }}
              />
              <Select
                label="Orientation"
                placeholder="Choose orientation"
                data={[
                  { value: "landscape", label: "landscape" },
                  { value: "portrait", label: "portrait" },
                ]}
                value={props.nodeDraft.orientation || null}
                onChange={(value) =>
                  props.setNodeDraft((prev) => ({
                    ...prev,
                    orientation: value || "",
                  }))
                }
                clearable
              />
            </SimpleGrid>
          </Stack>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Title order={6}>Network</Title>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <TextInput
                label="Host"
                placeholder="upper-east-1.local"
                value={props.nodeDraft.host}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  props.setNodeDraft((prev) => ({ ...prev, host: value }));
                }}
              />
              <TextInput
                label="IP"
                placeholder="10.0.0.21"
                value={props.nodeDraft.ip}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  props.setNodeDraft((prev) => ({ ...prev, ip: value }));
                }}
              />
            </SimpleGrid>
          </Stack>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Title order={6}>Node Runtime</Title>
            <Text size="sm" c="dimmed">
              Configure node-local runtime only. Guide/Cable app endpoints are
              server-hosted and not configured per node.
            </Text>
            <SimpleGrid cols={{ base: 1, sm: 2 }}>
              <NumberInput
                label="Node API port"
                placeholder="8080"
                value={props.nodeDraft.nodePort}
                onChange={(value) =>
                  props.setNodeDraft((prev) => ({
                    ...prev,
                    nodePort:
                      typeof value === "number" && Number.isFinite(value)
                        ? value
                        : undefined,
                  }))
                }
                min={1}
                max={65535}
              />
              <Select
                label="Display rotate"
                data={[
                  { value: "", label: "inherit/default" },
                  { value: "0", label: "0" },
                  { value: "90", label: "90" },
                  { value: "180", label: "180" },
                  { value: "270", label: "270" },
                ]}
                value={props.nodeDraft.displayRotate}
                onChange={(value) =>
                  props.setNodeDraft((prev) => ({
                    ...prev,
                    displayRotate: (value as "" | "0" | "90" | "180" | "270") || "",
                  }))
                }
              />
            </SimpleGrid>
          </Stack>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Group justify="space-between">
              <Title order={6}>Security</Title>
              <Badge color="gray" variant="light">
                Optional
              </Badge>
            </Group>
            <TextInput
              label="API key"
              placeholder="Used for node-side protected endpoints"
              value={props.nodeDraft.apiKey}
              onChange={(e) => {
                const value = e.currentTarget.value;
                props.setNodeDraft((prev) => ({ ...prev, apiKey: value }));
              }}
            />
          </Stack>
        </Paper>

        <Group justify="space-between">
          <Button variant="light" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void props.onSave()}
            loading={props.saving}
            disabled={!props.nodeDraft.registryId.trim() || !props.nodeDraft.nodeId.trim()}
          >
            {props.editingNodeId ? "Save Node" : "Create Node"}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
