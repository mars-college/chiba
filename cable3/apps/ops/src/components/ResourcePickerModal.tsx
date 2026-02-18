import { useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Image,
  Modal,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'

export type ResourcePickerItem = {
  id: string
  title: string
  subtitle?: string
  description?: string
  thumbnailUrl?: string
  previewUrl?: string
  badge?: string
  searchText?: string
}

type Props = {
  opened: boolean
  onClose: () => void
  title: string
  items: ResourcePickerItem[]
  selectedIds: string[]
  multi?: boolean
  applyLabel?: string
  onApply: (ids: string[]) => void
}

function normalizeSearch(item: ResourcePickerItem): string {
  if (item.searchText?.trim()) return item.searchText.toLowerCase()
  return [item.id, item.title, item.subtitle, item.description, item.badge]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function ResourcePickerModal(props: Props) {
  const multi = props.multi !== false
  const [query, setQuery] = useState('')
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set(props.selectedIds))

  useEffect(() => {
    if (!props.opened) return
    setSelectedSet(new Set(props.selectedIds))
    setQuery('')
  }, [props.opened, props.selectedIds])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return props.items
    return props.items.filter((item) => normalizeSearch(item).includes(q))
  }, [props.items, query])

  const selectedOrdered = useMemo(
    () => props.items.filter((item) => selectedSet.has(item.id)).map((item) => item.id),
    [props.items, selectedSet]
  )

  const toggle = (id: string) => {
    setSelectedSet((prev) => {
      const next = new Set(prev)
      if (multi) {
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      }
      if (next.has(id)) return new Set()
      return new Set([id])
    })
  }

  return (
    <Modal opened={props.opened} onClose={props.onClose} title={props.title} fullScreen>
      <Stack>
        <TextInput
          leftSection={<IconSearch size={16} />}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Search by id/title/artist/description"
        />
        <Text size="xs" c="dimmed">
          {filtered.length} result(s), {selectedOrdered.length} selected
        </Text>
        <ScrollArea h="62vh">
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3, xl: 4 }} spacing="sm">
            {filtered.map((item) => {
              const selected = selectedSet.has(item.id)
              return (
                <Card
                  key={item.id}
                  withBorder
                  p="sm"
                  radius="md"
                  className={`ops-media-card${selected ? ' is-selected' : ''}`}
                  onClick={() => toggle(item.id)}
                >
                  <Stack gap="sm">
                    <Group justify="space-between" align="center" wrap="nowrap">
                      {item.badge ? (
                        <Badge variant="light" color="cyan">
                          {item.badge}
                        </Badge>
                      ) : (
                        <span />
                      )}
                      <Checkbox
                        checked={selected}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => toggle(item.id)}
                      />
                    </Group>

                    {item.previewUrl ? (
                      <video
                        className="ops-media-thumb-video"
                        muted
                        loop
                        playsInline
                        preload="metadata"
                        poster={item.thumbnailUrl}
                        src={item.previewUrl}
                        onMouseEnter={(event) => {
                          void event.currentTarget.play().catch(() => {})
                        }}
                        onMouseLeave={(event) => {
                          event.currentTarget.pause()
                          event.currentTarget.currentTime = 0
                        }}
                      />
                    ) : item.thumbnailUrl ? (
                      <Image src={item.thumbnailUrl} alt={item.title || item.id} h={120} fit="cover" radius="sm" />
                    ) : (
                      <Paper withBorder h={120} radius="sm" p="sm">
                        <Group justify="center" align="center" h="100%">
                          <Text size="sm" c="dimmed">
                            No preview
                          </Text>
                        </Group>
                      </Paper>
                    )}

                    <Stack gap={2}>
                      <Text fw={700} lineClamp={1}>
                        {item.title || item.id}
                      </Text>
                      {item.subtitle ? (
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {item.subtitle}
                        </Text>
                      ) : null}
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {item.description || item.id}
                      </Text>
                    </Stack>
                  </Stack>
                </Card>
              )
            })}
          </SimpleGrid>
        </ScrollArea>
        <Paper withBorder p="sm">
          <Group justify="space-between" align="center">
            <Text size="sm" c="dimmed">
              Selected: {selectedOrdered.length}
            </Text>
            <Group gap="xs">
              <Button variant="light" onClick={props.onClose}>
                Cancel
              </Button>
              <Button
                disabled={selectedOrdered.length === 0}
                onClick={() => {
                  props.onApply(selectedOrdered)
                  props.onClose()
                }}
              >
                {props.applyLabel || (multi ? `Apply (${selectedOrdered.length})` : 'Select')}
              </Button>
            </Group>
          </Group>
        </Paper>
      </Stack>
    </Modal>
  )
}
