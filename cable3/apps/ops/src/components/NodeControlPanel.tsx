import { useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUp,
  IconClick,
  IconKeyboard,
  IconSend,
} from "@tabler/icons-react";
import type { NodeRuntimeInputAction } from "@chiba-cable3/contracts";
import { DetailBreadcrumbs, type DetailBreadcrumb } from "./DetailBreadcrumbs";

type NodeControlPanelProps = {
  selectedNodeCount: number;
  nodeId: string;
  busy: boolean;
  error: string | null;
  lastAction: string | null;
  onSendAction: (action: NodeRuntimeInputAction) => Promise<void>;
  onClose: () => void;
  breadcrumbs: DetailBreadcrumb[];
};

type KeyAction = {
  label: string;
  keyValue: string;
  icon?: ReactNode;
};

const KEY_ACTIONS: KeyAction[] = [
  { label: "Up", keyValue: "Up", icon: <IconArrowUp size={14} /> },
  { label: "Down", keyValue: "Down", icon: <IconArrowDown size={14} /> },
  { label: "Left", keyValue: "Left", icon: <IconArrowLeft size={14} /> },
  { label: "Right", keyValue: "Right", icon: <IconArrowRight size={14} /> },
  { label: "Enter", keyValue: "Enter" },
  { label: "Escape", keyValue: "Escape" },
  { label: "Space", keyValue: "Space" },
  { label: "Backspace", keyValue: "Backspace" },
];

export function NodeControlPanel({
  selectedNodeCount,
  nodeId,
  busy,
  error,
  lastAction,
  onSendAction,
  onClose,
  breadcrumbs,
}: NodeControlPanelProps) {
  const [textInput, setTextInput] = useState("");

  const sendText = async () => {
    const text = textInput.trim();
    if (!text) return;
    await onSendAction({ kind: "text", text });
    setTextInput("");
  };

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="md">
        <Stack gap={4}>
          <DetailBreadcrumbs items={breadcrumbs} />
          <Title order={5}>Control App/Web</Title>
        </Stack>

        <Group gap="xs" wrap="wrap">
          <Badge variant="light">{selectedNodeCount} selected node(s)</Badge>
          <Badge variant="light" color="blue">
            target: {nodeId}
          </Badge>
          {lastAction ? (
            <Badge variant="light" color="teal">
              last: {lastAction}
            </Badge>
          ) : null}
        </Group>

        <Text size="sm" c="dimmed">
          Send keyboard, text, and click input to the active runtime window on
          the selected node.
        </Text>

        <Paper withBorder p="sm" radius="sm">
          <Stack gap="sm">
            <Group gap={8}>
              <IconKeyboard size={16} />
              <Text fw={600}>Quick keys</Text>
            </Group>
            <SimpleGrid cols={{ base: 2, sm: 4 }}>
              {KEY_ACTIONS.map((keyAction) => (
                <Button
                  key={keyAction.keyValue}
                  variant="light"
                  leftSection={keyAction.icon}
                  loading={busy}
                  onClick={() =>
                    void onSendAction({ kind: "key", key: keyAction.keyValue })
                  }
                >
                  {keyAction.label}
                </Button>
              ))}
            </SimpleGrid>
          </Stack>
        </Paper>

        <Paper withBorder p="sm" radius="sm">
          <Stack gap="sm">
            <Group gap={8}>
              <IconSend size={16} />
              <Text fw={600}>Send text</Text>
            </Group>
            <Group align="flex-end" wrap="nowrap">
              <TextInput
                style={{ flex: 1 }}
                value={textInput}
                placeholder="Type text to send to focused app input"
                onChange={(event) => setTextInput(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  void sendText();
                }}
              />
              <Button
                loading={busy}
                disabled={!textInput.trim()}
                onClick={() => void sendText()}
              >
                Send
              </Button>
            </Group>
          </Stack>
        </Paper>

        <Paper withBorder p="sm" radius="sm">
          <Stack gap="sm">
            <Group gap={8}>
              <IconClick size={16} />
              <Text fw={600}>Pointer</Text>
            </Group>
            <Group>
              <Button
                variant="light"
                loading={busy}
                onClick={() =>
                  void onSendAction({ kind: "mouse_click", button: "left" })
                }
              >
                Left Click
              </Button>
              <Button
                variant="light"
                loading={busy}
                onClick={() =>
                  void onSendAction({ kind: "mouse_click", button: "right" })
                }
              >
                Right Click
              </Button>
            </Group>
          </Stack>
        </Paper>

        {error ? (
          <Text size="sm" c="red">
            {error}
          </Text>
        ) : null}

        <Group justify="space-between">
          <Button variant="light" onClick={onClose}>
            Close
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
