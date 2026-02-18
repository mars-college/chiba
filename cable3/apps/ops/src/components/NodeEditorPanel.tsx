import type { Dispatch, SetStateAction } from "react";
import {
  Badge,
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
import { DetailBreadcrumbs, type DetailBreadcrumb } from "./DetailBreadcrumbs";

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

type NodeEditorPanelProps = {
  editingNodeId: string | null;
  nodeDraft: NodeDraft;
  setNodeDraft: Dispatch<SetStateAction<NodeDraft>>;
  onSave: () => Promise<void>;
  saving: boolean;
  onClose: () => void;
  breadcrumbs: DetailBreadcrumb[];
};

export function NodeEditorPanel({
  editingNodeId,
  nodeDraft,
  setNodeDraft,
  onSave,
  saving,
  onClose,
  breadcrumbs,
}: NodeEditorPanelProps) {
  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="md">
        <Stack gap={4}>
          <DetailBreadcrumbs items={breadcrumbs} />
          <Title order={5}>
            {editingNodeId ? `Edit Node • ${editingNodeId}` : "Add Node"}
          </Title>
        </Stack>

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
                value={nodeDraft.registryId}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setNodeDraft((prev) => ({ ...prev, registryId: value }));
                }}
              />
              <TextInput
                label="Node ID"
                description="Unique stable node identifier"
                placeholder="upper-east-1"
                value={nodeDraft.nodeId}
                disabled={Boolean(editingNodeId)}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setNodeDraft((prev) => ({ ...prev, nodeId: value }));
                }}
              />
              <TextInput
                label="Node name"
                placeholder="Upper East 1"
                value={nodeDraft.nodeName}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setNodeDraft((prev) => ({ ...prev, nodeName: value }));
                }}
              />
              <Select
                label="Orientation"
                placeholder="Choose orientation"
                data={[
                  { value: "landscape", label: "landscape" },
                  { value: "portrait", label: "portrait" },
                ]}
                value={nodeDraft.orientation || null}
                onChange={(value) =>
                  setNodeDraft((prev) => ({
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
                value={nodeDraft.host}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setNodeDraft((prev) => ({ ...prev, host: value }));
                }}
              />
              <TextInput
                label="IP"
                placeholder="10.0.0.21"
                value={nodeDraft.ip}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  setNodeDraft((prev) => ({ ...prev, ip: value }));
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
                value={nodeDraft.nodePort}
                onChange={(value) =>
                  setNodeDraft((prev) => ({
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
                value={nodeDraft.displayRotate}
                onChange={(value) =>
                  setNodeDraft((prev) => ({
                    ...prev,
                    displayRotate:
                      (value as "" | "0" | "90" | "180" | "270") || "",
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
              value={nodeDraft.apiKey}
              onChange={(e) => {
                const value = e.currentTarget.value;
                setNodeDraft((prev) => ({ ...prev, apiKey: value }));
              }}
            />
          </Stack>
        </Paper>

        <Group justify="space-between">
          <Button variant="light" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void onSave()}
            loading={saving}
            disabled={!nodeDraft.registryId.trim() || !nodeDraft.nodeId.trim()}
          >
            {editingNodeId ? "Save Node" : "Create Node"}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
