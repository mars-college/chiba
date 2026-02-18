import { useEffect, useMemo, useRef, useState } from 'react'
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

const CARD_HEIGHT = 262
const GRID_GAP = 12
const ROW_HEIGHT = CARD_HEIGHT + GRID_GAP
const OVERSCAN_ROWS = 2

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
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [viewportWidth, setViewportWidth] = useState(0)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const selectedIdsKey = useMemo(() => props.selectedIds.join('\u0001'), [props.selectedIds])

  useEffect(() => {
    if (!props.opened) return
    setSelectedSet(new Set(props.selectedIds))
    setQuery('')
    setScrollTop(0)
  }, [props.opened, selectedIdsKey])

  useEffect(() => {
    if (!props.opened) return
    const viewport = viewportRef.current
    if (!viewport) return
    const measure = () => {
      setViewportHeight(viewport.clientHeight)
      setViewportWidth(viewport.clientWidth)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [props.opened])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return props.items
    return props.items.filter((item) => normalizeSearch(item).includes(q))
  }, [props.items, query])

  const selectedOrdered = useMemo(
    () => props.items.filter((item) => selectedSet.has(item.id)).map((item) => item.id),
    [props.items, selectedSet]
  )

  const columns = useMemo(() => {
    if (viewportWidth >= 1408) return 4
    if (viewportWidth >= 1200) return 3
    if (viewportWidth >= 768) return 2
    return 1
  }, [viewportWidth])

  const totalRows = useMemo(
    () => Math.max(1, Math.ceil(filtered.length / columns)),
    [columns, filtered.length]
  )

  const { startRow, endRow } = useMemo(() => {
    const estimatedVisibleRows = Math.ceil((viewportHeight || ROW_HEIGHT) / ROW_HEIGHT)
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS)
    const end = Math.min(
      totalRows - 1,
      Math.floor(scrollTop / ROW_HEIGHT) + estimatedVisibleRows + OVERSCAN_ROWS
    )
    return { startRow: start, endRow: end }
  }, [scrollTop, totalRows, viewportHeight])

  const visibleStartIndex = startRow * columns
  const visibleEndIndex = Math.min(filtered.length, (endRow + 1) * columns)
  const visibleItems = useMemo(
    () => filtered.slice(visibleStartIndex, visibleEndIndex),
    [filtered, visibleEndIndex, visibleStartIndex]
  )
  const topSpacerHeight = startRow * ROW_HEIGHT
  const bottomSpacerHeight = Math.max(0, (totalRows - endRow - 1) * ROW_HEIGHT)

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
        <ScrollArea
          h="62vh"
          viewportRef={viewportRef}
          onScrollPositionChange={(position) => setScrollTop(position.y)}
        >
          <Stack gap={0}>
            <div style={{ height: topSpacerHeight }} />
            <SimpleGrid cols={columns} spacing="sm">
              {visibleItems.map((item) => {
              const selected = selectedSet.has(item.id)
              return (
                <Card
                  key={item.id}
                  withBorder
                  p="sm"
                  radius="md"
                  className={`ops-media-card${selected ? ' is-selected' : ''}`}
                  style={{ cursor: 'pointer', height: CARD_HEIGHT }}
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
                      <Image
                        src={item.thumbnailUrl}
                        alt={item.title || item.id}
                        h={120}
                        fit="cover"
                        radius="sm"
                        loading="lazy"
                        decoding="async"
                      />
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
            <div style={{ height: bottomSpacerHeight }} />
          </Stack>
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
