import {
  Button,
  Card,
  Divider,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  IconDeviceDesktopAnalytics,
  IconPencil,
  IconPhotoPlus,
  IconUpload,
} from "@tabler/icons-react";
import type { BuilderMode, MainTab } from "../store/uiStore";

type Props = {
  isMobile: boolean;
  mainTab: MainTab;
  builderTab: BuilderMode;
  onOpenNodeOps: () => void;
  onOpenIngestion: () => void;
  onOpenMediaLibrary: () => void;
  selectedNodeCount: number;
  visibleNodeCount: number;
  metrics: {
    online: number;
    degraded: number;
    updating: number;
    total: number;
  };
  onOpenNodeWorkspace: () => void;
  lastTick: number | null;
};

export function OpsSidebar(props: Props) {
  return (
    <ScrollArea h="100%" type="auto">
      <Stack gap="sm">
        <Text size="xs" c="dimmed" tt="uppercase" fw={700} className="ops-side-title">
          Workspaces
        </Text>
        <Button
          className="ops-side-action"
          variant={props.mainTab === "fleet" ? "filled" : "light"}
          leftSection={<IconDeviceDesktopAnalytics size={16} />}
          onClick={props.onOpenNodeOps}
        >
          Node Ops
        </Button>
        <Button
          className="ops-side-action"
          variant={props.mainTab === "builder" && props.builderTab === "ingest" ? "filled" : "light"}
          leftSection={<IconUpload size={16} />}
          onClick={props.onOpenIngestion}
        >
          Add Media
        </Button>
        <Button
          className="ops-side-action"
          variant={
            props.mainTab === "builder" &&
            (props.builderTab === "media" ||
              props.builderTab === "mediaDetail" ||
              props.builderTab === "playlistEditor" ||
              props.builderTab === "block" ||
              props.builderTab === "channel" ||
              props.builderTab === "profile")
              ? "filled"
              : "light"
          }
          leftSection={<IconPhotoPlus size={16} />}
          onClick={props.onOpenMediaLibrary}
        >
          Media Library
        </Button>
        <Divider />
        <Card withBorder radius="md" p="sm">
          <Text size="xs" c="dimmed">
            Selected nodes
          </Text>
          <Title order={2}>{props.selectedNodeCount}</Title>
          <Text size="xs" c="dimmed">
            of {props.visibleNodeCount} visible
          </Text>
        </Card>
        <SimpleGrid cols={2} spacing="xs">
          <Card withBorder p="xs">
            <Text size="xs" c="dimmed">
              Online
            </Text>
            <Text fw={700}>{props.metrics.online}</Text>
          </Card>
          <Card withBorder p="xs">
            <Text size="xs" c="dimmed">
              Degraded
            </Text>
            <Text fw={700}>{props.metrics.degraded}</Text>
          </Card>
          <Card withBorder p="xs">
            <Text size="xs" c="dimmed">
              Updating
            </Text>
            <Text fw={700}>{props.metrics.updating}</Text>
          </Card>
          <Card withBorder p="xs">
            <Text size="xs" c="dimmed">
              Total
            </Text>
            <Text fw={700}>{props.metrics.total}</Text>
          </Card>
        </SimpleGrid>
        <Button
          leftSection={<IconPencil size={16} />}
          color="blue"
          variant="light"
          onClick={props.onOpenNodeWorkspace}
          disabled={props.selectedNodeCount === 0}
        >
          {`Edit ${props.selectedNodeCount} ${props.selectedNodeCount === 1 ? "node" : "nodes"}`}
        </Button>
        <Text size="xs" c="dimmed">
          Last tick: {props.lastTick ? `${Math.round((Date.now() - props.lastTick) / 1000)}s ago` : "—"}
        </Text>
      </Stack>
    </ScrollArea>
  );
}
