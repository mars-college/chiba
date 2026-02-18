import { Anchor, Breadcrumbs, Text } from "@mantine/core";

export type DetailBreadcrumb = {
  label: string;
  onClick?: () => void;
};

type DetailBreadcrumbsProps = {
  items: DetailBreadcrumb[];
};

export function DetailBreadcrumbs({ items }: DetailBreadcrumbsProps) {
  return (
    <Breadcrumbs separator="/" separatorMargin="xs">
      {items.map((item, index) =>
        item.onClick ? (
          <Anchor
            key={`${item.label}-${index}`}
            size="sm"
            href="#"
            onClick={(event) => {
              event.preventDefault();
              item.onClick?.();
            }}
          >
            {item.label}
          </Anchor>
        ) : (
          <Text key={`${item.label}-${index}`} size="sm" c="dimmed">
            {item.label}
          </Text>
        )
      )}
    </Breadcrumbs>
  );
}
