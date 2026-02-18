import {
  ActionIcon,
  Burger,
  Checkbox,
  Group,
  Loader,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconRefresh } from "@tabler/icons-react";

type Props = {
  isMobile: boolean;
  controlOpen: boolean;
  onToggleControl: () => void;
  autoRefresh: boolean;
  onAutoRefreshChange: (value: boolean) => void;
  loadingFleet: boolean;
  onRefreshAll: () => void;
};

export function OpsHeader(props: Props) {
  return (
    <Group h="100%" px="md" justify="space-between" wrap="nowrap">
      <Group gap="sm">
        <Burger
          opened={props.controlOpen}
          onClick={props.onToggleControl}
          aria-label="Toggle navigation"
          size="sm"
        />
        <Title order={props.isMobile ? 4 : 3}>Chiba Controller</Title>
      </Group>
      <Group gap="xs" wrap="nowrap">
        {!props.isMobile ? (
          <Checkbox
            checked={props.autoRefresh}
            onChange={(e) => props.onAutoRefreshChange(e.currentTarget.checked)}
            label="Auto refresh"
          />
        ) : null}
        <Tooltip label="Refresh fleet + data">
          <ActionIcon size="lg" variant="filled" color="blue" onClick={props.onRefreshAll}>
            {props.loadingFleet ? (
              <Loader size={16} color="white" />
            ) : (
              <IconRefresh size={16} />
            )}
          </ActionIcon>
        </Tooltip>
      </Group>
    </Group>
  );
}
