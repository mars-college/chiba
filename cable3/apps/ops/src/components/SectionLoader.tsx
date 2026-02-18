import { Group, Loader, Text } from "@mantine/core";

type SectionLoaderProps = {
  label?: string;
  size?: number | string;
};

export function SectionLoader({
  label = "Loading...",
  size = "sm",
}: SectionLoaderProps) {
  return (
    <Group gap="xs" justify="center" py="xl">
      <Loader size={size} />
      <Text size="sm" c="dimmed">
        {label}
      </Text>
    </Group>
  );
}
