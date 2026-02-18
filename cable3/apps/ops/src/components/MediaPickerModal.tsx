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
import type { Media } from '../lib/controlApi'

type Props = {
  opened: boolean
  onClose: () => void
  media: Media[]
  selectedIds: string[]
  onApply: (mediaIds: string[]) => void
}

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

export function MediaPickerModal(props: Props) {
  const [query, setQuery] = useState('')
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set(props.selectedIds))

  useEffect(() => {
    if (!props.opened) return
    setSelectedSet(new Set(props.selectedIds))
  }, [props.opened, props.selectedIds])

  const toggleSelection = (mediaId: string) => {
    setSelectedSet((prev) => {
      const next = new Set(prev)
      if (next.has(mediaId)) next.delete(mediaId)
      else next.add(mediaId)
      return next
    })
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return props.media
    return props.media.filter((row) => searchText(row).includes(q))
  }, [props.media, query])

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
        <Text size="xs" c="dimmed">
          {filtered.length} result(s), {selectedSet.size} selected
        </Text>
        <ScrollArea h="62vh">
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 3, xl: 4 }} spacing="sm">
            {filtered.map((row) => {
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
