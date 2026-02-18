import type { ReactNode } from "react";
import {
  Anchor,
  Breadcrumbs,
  Button,
  Card,
  Group,
  JsonInput,
  Modal,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import { IconPencil } from "@tabler/icons-react";
import type { FleetPiHealth } from "../types";

type Props = {
  opened: boolean;
  onClose: () => void;
  isMobile: boolean;
  selectedNode: FleetPiHealth | null;
  parseTargetFromKioskUrl: (value: string | null) => string;
  statusBadge: (ok: boolean, onlineLabel: string, offlineLabel: string) => ReactNode;
  onEditNode: (nodeId: string) => void;
};

export function NodeInspectorModal(props: Props) {
  return (
    <Modal
      opened={props.opened}
      onClose={props.onClose}
      title={props.selectedNode ? `Node Inspector • ${props.selectedNode.id}` : "Node Inspector"}
      size={props.isMobile ? "100%" : "xl"}
    >
      {props.selectedNode ? (
        <Stack>
          <Breadcrumbs separator="›">
            <Anchor
              size="sm"
              c="dimmed"
              href="#"
              onClick={(event) => {
                event.preventDefault();
                props.onClose();
              }}
            >
              Node Workspace
            </Anchor>
            <Text size="sm">Node Inspector</Text>
            <Text size="sm" fw={600}>
              {props.selectedNode.id}
            </Text>
          </Breadcrumbs>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Card withBorder>
              <Text size="sm" c="dimmed">
                Runtime target
              </Text>
              <Text fw={700}>
                {props.parseTargetFromKioskUrl(props.selectedNode.chibaNode.kioskUrl ?? null)}
              </Text>
              <Text size="xs" c="dimmed" ff="monospace">
                {props.selectedNode.chibaNode.kioskUrl || "—"}
              </Text>
            </Card>
            <Card withBorder>
              <Text size="sm" c="dimmed">
                Connectivity
              </Text>
              <Group gap={6} mt={6}>
                {props.statusBadge(props.selectedNode.dnsOk, "DNS", "DNS")}
                {props.statusBadge(props.selectedNode.ping.ok, "Ping", "Ping")}
                {props.statusBadge(props.selectedNode.tcp.ssh22.ok, "SSH", "SSH")}
                {props.statusBadge(props.selectedNode.http.nodeStatus.ok, "Node API", "Node API")}
              </Group>
            </Card>
          </SimpleGrid>
          <Group justify="flex-end">
            <Button
              variant="light"
              leftSection={<IconPencil size={14} />}
              onClick={() => props.onEditNode(props.selectedNode?.id || "")}
            >
              Edit Node
            </Button>
          </Group>
          <JsonInput
            label="Raw node state"
            value={JSON.stringify(props.selectedNode, null, 2)}
            autosize
            minRows={18}
            formatOnBlur
          />
        </Stack>
      ) : null}
    </Modal>
  );
}
