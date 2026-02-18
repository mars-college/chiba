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
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import { useDebouncedValue } from '@mantine/hooks'
import { IconSearch } from '@tabler/icons-react'
import type { Media } from '../lib/controlApi'

type Props = {
  opened: boolean
  onClose: () => void
  media: Media[]
  selectedIds: string[]
  onApply: (mediaIds: string[]) => void
}

const PAGE_SIZE = 48

function searchText(media: Media): string {
  return [media.id, media.title, media.artist, media.description, media.sourceValue]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function isLikelyVideoSource(value: string): boolean {
  const raw = value.trim()
  if (!raw) return false
  try {
    const pathname = new URL(raw).pathname || ''
    return /\.(mp4|mov|webm|m4v|ogg|ogv|mkv|avi|mpeg|mpg)$/i.test(pathname)
  } catch {
    return /\.(mp4|mov|webm|m4v|ogg|ogv|mkv|avi|mpeg|mpg)$/i.test(raw)
  }
}

function isLikelyAudioSource(value: string): boolean {
  const raw = value.trim()
  if (!raw) return false
  try {
    const pathname = new URL(raw).pathname || ''
    return /\.(mp3|wav|flac|m4a|aac|ogg|oga)$/i.test(pathname)
  } catch {
    return /\.(mp3|wav|flac|m4a|aac|ogg|oga)$/i.test(raw)
  }
}

function isLikelyImageSource(value: string): boolean {
  const raw = value.trim()
  if (!raw) return false
  try {
    const pathname = new URL(raw).pathname || ''
    return /\.(jpg|jpeg|png|gif|webp|bmp|avif|tif|tiff)$/i.test(pathname)
  } catch {
    return /\.(jpg|jpeg|png|gif|webp|bmp|avif|tif|tiff)$/i.test(raw)
  }
}

export function MediaPickerModal(props: Props) {
  const [query, setQuery] = useState('')
  const [debouncedQuery] = useDebouncedValue(query, 150)
  const [sourceFilter, setSourceFilter] = useState<'all' | 'path' | 'url'>('all')
  const [kindFilter, setKindFilter] = useState<
    'all' | 'image' | 'video' | 'audio' | 'no_thumb'
  >('all')
  const [selectionFilter, setSelectionFilter] = useState<'all' | 'selected'>('all')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set(props.selectedIds))
  const selectedIdsKey = useMemo(() => props.selectedIds.join('\u0001'), [props.selectedIds])

  useEffect(() => {
    if (!props.opened) return
    setSelectedSet(new Set(props.selectedIds))
  }, [props.opened, selectedIdsKey])

  useEffect(() => {
    if (!props.opened) return
    setVisibleCount(PAGE_SIZE)
  }, [props.opened, debouncedQuery, sourceFilter, kindFilter, selectionFilter])

  const toggleSelection = (mediaId: string) => {
    setSelectedSet((prev) => {
      const next = new Set(prev)
      if (next.has(mediaId)) next.delete(mediaId)
      else next.add(mediaId)
      return next
    })
  }

  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase()
    const ordered = [...props.media].reverse()
    return ordered.filter((row) => {
      if (selectionFilter === 'selected' && !selectedSet.has(row.id)) return false
      if (sourceFilter !== 'all' && row.sourceType !== sourceFilter) return false
      if (kindFilter === 'video' && !isLikelyVideoSource(row.sourceValue)) return false
      if (kindFilter === 'audio' && !isLikelyAudioSource(row.sourceValue)) return false
      if (kindFilter === 'image' && !isLikelyImageSource(row.sourceValue)) return false
      if (kindFilter === 'no_thumb' && row.thumbnailUrl) return false
      if (!q) return true
      return searchText(row).includes(q)
    })
  }, [debouncedQuery, kindFilter, props.media, selectedSet, selectionFilter, sourceFilter])

  const visibleRows = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount])

  const selectedOrdered = useMemo(
    () => props.media.filter((row) => selectedSet.has(row.id)).map((row) => row.id),
    [props.media, selectedSet]
  )

  return (
    <Modal
      opened={props.opened}
      onClose={props.onClose}
      fullScreen
      title="Pick Media"
    >
      <Stack>
        <TextInput
          leftSection={<IconSearch size={16} />}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Search by id, title, artist, description, source path/url"
        />
        <Group grow>
          <SegmentedControl
            value={sourceFilter}
            onChange={(value) => setSourceFilter((value as 'all' | 'path' | 'url') || 'all')}
            data={[
              { value: 'all', label: 'All Sources' },
              { value: 'path', label: 'Path' },
              { value: 'url', label: 'URL' },
            ]}
          />
          <SegmentedControl
            value={kindFilter}
            onChange={(value) =>
              setKindFilter(
                (value as 'all' | 'image' | 'video' | 'audio' | 'no_thumb') || 'all'
              )
            }
            data={[
              { value: 'all', label: 'All Types' },
              { value: 'video', label: 'Video' },
              { value: 'image', label: 'Image' },
              { value: 'audio', label: 'Audio' },
              { value: 'no_thumb', label: 'No Thumb' },
            ]}
          />
          <SegmentedControl
            value={selectionFilter}
            onChange={(value) =>
              setSelectionFilter((value as 'all' | 'selected') || 'all')
            }
            data={[
              { value: 'all', label: 'All' },
              { value: 'selected', label: 'Selected' },
            ]}
          />
        </Group>
        <Text size="xs" c="dimmed">
          Showing {Math.min(visibleRows.length, filtered.length)} of {filtered.length} result(s),{' '}
          {selectedSet.size} selected
        </Text>
        <ScrollArea h="62vh">
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3, xl: 4 }} spacing="sm">
            {visibleRows.map((row) => {
              const selected = selectedSet.has(row.id)
              return (
                <Card
                  key={row.id}
                  withBorder
                  p="sm"
                  radius="md"
                  style={{ cursor: 'pointer' }}
                  className="ops-media-card"
                  onClick={() => toggleSelection(row.id)}
                >
                  <Stack gap="sm">
                    <Group justify="space-between" align="center" wrap="nowrap">
                      {isLikelyVideoSource(row.sourceValue) ? (
                        <Badge variant="light" color="cyan">
                          video
                        </Badge>
                      ) : (
                        <span />
                      )}
                      <Checkbox
                        checked={selected}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => toggleSelection(row.id)}
                      />
                    </Group>
                    {row.thumbnailUrl ? (
                      <Image
                        src={row.thumbnailUrl}
                        alt={row.title || row.id}
                        h={180}
                        radius="sm"
                        fit="cover"
                        fallbackSrc=""
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <Paper withBorder h={180} radius="sm" p="sm">
                        <Group justify="center" align="center" h="100%">
                          <Text size="sm" c="dimmed">
                            No thumbnail
                          </Text>
                        </Group>
                      </Paper>
                    )}
                    <Stack gap={2}>
                      <Text fw={700} lineClamp={1}>
                        {row.title || row.id}
                      </Text>
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {row.artist || 'unknown artist'}
                      </Text>
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {row.id}
                      </Text>
                    </Stack>
                  </Stack>
                </Card>
              )
            })}
          </SimpleGrid>
          {filtered.length === 0 ? (
            <Paper withBorder p="lg" mt="sm">
              <Text c="dimmed" size="sm">
                No media matches the current search/filter set.
              </Text>
            </Paper>
          ) : null}
          {visibleRows.length < filtered.length ? (
            <Group justify="center" mt="md">
              <Button
                variant="light"
                onClick={() =>
                  setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, filtered.length))
                }
              >
                Load More ({filtered.length - visibleRows.length} remaining)
              </Button>
            </Group>
          ) : null}
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
                Add To Playlist ({selectedOrdered.length})
              </Button>
            </Group>
          </Group>
        </Paper>
      </Stack>
    </Modal>
  )
}
