import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActionIcon,
  AppShell,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Code,
  Divider,
  Drawer,
  Group,
  JsonInput,
  Loader,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core'
import { notifications } from '@mantine/notifications'
import {
  IconAdjustments,
  IconArrowsShuffle,
  IconBroadcast,
  IconChecklist,
  IconDatabase,
  IconDeviceDesktopAnalytics,
  IconDownload,
  IconRefresh,
  IconSearch,
  IconServerCog,
} from '@tabler/icons-react'
import {
  applyTarget,
  fetchCatalog,
  fetchProfiles,
  openFleetStream,
  openGuide,
} from './lib/api'
import {
  fetchC3Snapshot,
  importC3Resources,
  type C3ResourcePayload,
} from './lib/cable3api'
import type {
  FleetPiHealth,
  OpsApplyResponse,
  OpsApplyTarget,
  OpsCatalogResponse,
  OpsProfile,
} from './types'

type OptionBool = 'inherit' | 'on' | 'off'
type OptionMode = 'inherit' | 'guide' | 'gallery'
type OptionHud = 'inherit' | 'always' | 'start' | 'never'
type OptionRotate = 'inherit' | '0' | '90' | '180' | '270'

type CatalogOption = { value: string; label: string }

type DraftMedia = {
  id: string
  title: string
  artist: string
  sourceType: 'path' | 'url'
  sourceValue: string
  cache: boolean
}

type DraftPlaylist = {
  id: string
  title: string
  artist: string
  mediaIds: string[]
}

type DraftBlock = {
  id: string
  title: string
  playlistIds: string[]
}

type DraftChannel = {
  id: string
  title: string
  blockIds: string[]
}

type DraftProfile = {
  id: string
  title: string
  defaultTargetKind: 'media' | 'playlist' | 'block' | 'channel'
  defaultTargetId: string
}

type DraftStore = {
  media: DraftMedia[]
  playlists: DraftPlaylist[]
  blocks: DraftBlock[]
  channels: DraftChannel[]
  profiles: DraftProfile[]
}

const EMPTY_DRAFTS: DraftStore = {
  media: [],
  playlists: [],
  blocks: [],
  channels: [],
  profiles: [],
}

const DRAFT_STORAGE_KEY = 'chiba-controller-drafts-v1'

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toOptionBool(value: OptionBool): boolean | undefined {
  if (value === 'inherit') return undefined
  return value === 'on'
}

function statusBadge(ok: boolean, labelOk: string, labelFail: string) {
  return ok ? (
    <Badge color="teal" variant="light">
      {labelOk}
    </Badge>
  ) : (
    <Badge color="red" variant="light">
      {labelFail}
    </Badge>
  )
}

function parseCatalogOptions(rows: unknown, fallbackLabel: string): CatalogOption[] {
  if (!Array.isArray(rows)) return []
  return rows
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const rec = row as Record<string, unknown>
      const id = readString(rec.id)
      if (!id) return null
      const number = readString(rec.number)
      const name = readString(rec.name || rec.title)
      const label = [number, name, id].filter(Boolean).join(' • ')
      return { value: id, label: label || `${fallbackLabel} • ${id}` }
    })
    .filter((row): row is CatalogOption => row !== null)
}

function parseTargetFromKioskUrl(rawUrl: string | null | undefined): string {
  if (!rawUrl) return '—'
  try {
    const url = new URL(rawUrl)
    const targetKind =
      url.searchParams.get('targetKind') || url.searchParams.get('target_kind') || ''
    const targetId =
      url.searchParams.get('targetId') || url.searchParams.get('target_id') || ''
    const channel = url.searchParams.get('channel') || ''
    if (targetKind && targetId) return `${targetKind}:${targetId}`
    if (channel) return `channel:${channel}`
    return 'guide/default'
  } catch {
    return 'invalid-url'
  }
}

function summarizeApplyResult(result: OpsApplyResponse): string {
  const total = result.results.length
  const ok = result.results.filter((r) => r.ok).length
  if (ok === total) return `Applied to ${ok}/${total}`
  const firstError = result.results.find((r) => !r.ok)?.error || 'unknown_error'
  return `Applied to ${ok}/${total}. Failures: ${total - ok}. First error: ${firstError}`
}

function loadDraftStore(): DraftStore {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY)
    if (!raw) return EMPTY_DRAFTS
    const parsed = JSON.parse(raw) as Partial<DraftStore>
    return {
      media: Array.isArray(parsed.media) ? parsed.media : [],
      playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
      blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
      channels: Array.isArray(parsed.channels) ? parsed.channels : [],
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
    }
  } catch {
    return EMPTY_DRAFTS
  }
}

function toC3Payload(store: DraftStore): C3ResourcePayload {
  return {
    media: store.media.map((m) => ({
      id: m.id.trim(),
      title: m.title.trim() || undefined,
      artist: m.artist.trim() || undefined,
      sourceType: m.sourceType,
      sourceValue: m.sourceValue.trim(),
      cache: m.cache,
    })),
    playlists: store.playlists.map((p) => ({
      id: p.id.trim(),
      title: p.title.trim() || undefined,
      artist: p.artist.trim() || undefined,
      items: p.mediaIds.map((mediaId, index) => ({
        index,
        mediaId: mediaId.trim(),
      })),
    })),
    blocks: store.blocks.map((b) => ({
      id: b.id.trim(),
      title: b.title.trim() || undefined,
      mode: 'loop',
      items: b.playlistIds.map((playlistId, index) => ({
        index,
        playlistId: playlistId.trim(),
      })),
    })),
    channels: store.channels.map((c) => ({
      id: c.id.trim(),
      name: c.title.trim() || undefined,
      blockIds: c.blockIds.map((blockId) => blockId.trim()),
    })),
    profiles: store.profiles.map((p) => ({
      id: p.id.trim(),
      title: p.title.trim() || undefined,
      defaults: {},
      defaultTarget:
        p.defaultTargetKind && p.defaultTargetId.trim()
          ? {
              kind: p.defaultTargetKind,
              id: p.defaultTargetId.trim(),
            }
          : undefined,
      nodes: [],
    })),
  }
}

function fromC3Payload(payload: C3ResourcePayload): DraftStore {
  return {
    media: payload.media.map((m) => ({
      id: m.id,
      title: m.title || '',
      artist: m.artist || '',
      sourceType: m.sourceType,
      sourceValue: m.sourceValue,
      cache: m.cache,
    })),
    playlists: payload.playlists.map((p) => ({
      id: p.id,
      title: p.title || '',
      artist: p.artist || '',
      mediaIds: p.items
        .map((item) => item.mediaId || '')
        .filter((id) => id.length > 0),
    })),
    blocks: payload.blocks.map((b) => ({
      id: b.id,
      title: b.title || '',
      playlistIds: b.items
        .map((item) => item.playlistId || '')
        .filter((id) => id.length > 0),
    })),
    channels: payload.channels.map((c) => ({
      id: c.id,
      title: c.name || '',
      blockIds: c.blockIds,
    })),
    profiles: payload.profiles.map((p) => ({
      id: p.id,
      title: p.title || '',
      defaultTargetKind:
        p.defaultTarget?.kind === 'media' ||
        p.defaultTarget?.kind === 'playlist' ||
        p.defaultTarget?.kind === 'block' ||
        p.defaultTarget?.kind === 'channel'
          ? p.defaultTarget.kind
          : 'channel',
      defaultTargetId: p.defaultTarget?.id || '',
    })),
  }
}

export default function App() {
  const [catalog, setCatalog] = useState<OpsCatalogResponse | null>(null)
  const [profiles, setProfiles] = useState<OpsProfile[]>([])
  const [fleetMap, setFleetMap] = useState<Record<string, FleetPiHealth>>({})
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const [loadingFleet, setLoadingFleet] = useState(false)
  const [search, setSearch] = useState('')
  const [lastTick, setLastTick] = useState<number | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [controlOpen, setControlOpen] = useState(true)
  const [applyOpen, setApplyOpen] = useState(false)
  const [catalogReloadToken, setCatalogReloadToken] = useState(0)
  const [applyResult, setApplyResult] = useState<OpsApplyResponse | null>(null)
  const [draftStore, setDraftStore] = useState<DraftStore>(() => loadDraftStore())
  const [builderBusy, setBuilderBusy] = useState(false)

  const [applyKind, setApplyKind] = useState<OpsApplyTarget>('profile')
  const [applyId, setApplyId] = useState('')
  const [optMode, setOptMode] = useState<OptionMode>('inherit')
  const [optLock, setOptLock] = useState<OptionBool>('inherit')
  const [optQr, setOptQr] = useState<OptionBool>('inherit')
  const [optPlaylist, setOptPlaylist] = useState<OptionBool>('inherit')
  const [optNosplash, setOptNosplash] = useState<OptionBool>('inherit')
  const [optHud, setOptHud] = useState<OptionHud>('inherit')
  const [optHudSec, setOptHudSec] = useState<number | ''>('')
  const [optTheme, setOptTheme] = useState('')
  const [optRotate, setOptRotate] = useState<OptionRotate>('inherit')

  const [mediaDraft, setMediaDraft] = useState<DraftMedia>({
    id: '',
    title: '',
    artist: '',
    sourceType: 'path',
    sourceValue: '',
    cache: true,
  })
  const [playlistDraft, setPlaylistDraft] = useState<DraftPlaylist>({
    id: '',
    title: '',
    artist: '',
    mediaIds: [],
  })
  const [blockDraft, setBlockDraft] = useState<DraftBlock>({
    id: '',
    title: '',
    playlistIds: [],
  })
  const [channelDraft, setChannelDraft] = useState<DraftChannel>({
    id: '',
    title: '',
    blockIds: [],
  })
  const [profileDraft, setProfileDraft] = useState<DraftProfile>({
    id: '',
    title: '',
    defaultTargetKind: 'channel',
    defaultTargetId: '',
  })

  useEffect(() => {
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draftStore))
  }, [draftStore])

  const refreshCatalogAndProfiles = useCallback(async () => {
    try {
      const [catalogRes, profilesRes] = await Promise.all([
        fetchCatalog(),
        fetchProfiles(),
      ])
      setCatalog(catalogRes)
      setProfiles(profilesRes.profiles ?? [])
    } catch (error) {
      notifications.show({
        color: 'red',
        title: 'Catalog refresh failed',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }, [])

  const refreshFleet = useCallback(() => {
    setLoadingFleet(true)
    const stream = openFleetStream({
      onMeta: () => {
        // no-op right now, metadata can be shown later
      },
      onPi: (pi) => {
        setFleetMap((prev) => ({ ...prev, [pi.id]: pi }))
      },
      onDone: () => {
        setLoadingFleet(false)
        setLastTick(Date.now())
      },
      onError: (msg) => {
        setLoadingFleet(false)
        notifications.show({
          color: 'orange',
          title: 'Fleet stream warning',
          message: msg,
        })
      },
    })
    return () => stream.close()
  }, [])

  useEffect(() => {
    refreshCatalogAndProfiles()
  }, [refreshCatalogAndProfiles, catalogReloadToken])

  useEffect(() => {
    const close = refreshFleet()
    return close
  }, [refreshFleet])

  useEffect(() => {
    if (!autoRefresh) return
    const id = window.setInterval(() => refreshFleet(), 8000)
    return () => window.clearInterval(id)
  }, [autoRefresh, refreshFleet])

  const fleetRows = useMemo(() => {
    return Object.values(fleetMap).sort((a, b) => a.id.localeCompare(b.id))
  }, [fleetMap])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return fleetRows
    return fleetRows.filter((row) => {
      const haystack = [row.id, row.nodeName, row.host, row.ip]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [fleetRows, search])

  useEffect(() => {
    setSelectedNodeIds((prev) => prev.filter((id) => fleetMap[id]))
  }, [fleetMap])

  const selectedNode = useMemo(
    () => (activeNodeId ? fleetMap[activeNodeId] ?? null : null),
    [activeNodeId, fleetMap]
  )

  const metrics = useMemo(() => {
    const total = fleetRows.length
    const online = fleetRows.filter((r) => r.ping.ok && r.http.nodeStatus.ok).length
    const degraded = fleetRows.filter((r) => !r.http.nodeStatus.ok || !r.http.cableVersion.ok).length
    const updating = fleetRows.filter((r) => r.needsUpdate === true).length
    return { total, online, degraded, updating }
  }, [fleetRows])

  const profileOptions = useMemo<CatalogOption[]>(
    () =>
      profiles.map((p) => ({
        value: p.id,
        label: `${p.id} • ${p.file}`,
      })),
    [profiles]
  )

  const channelOptions = useMemo(
    () => parseCatalogOptions(catalog?.channels, 'channel'),
    [catalog]
  )
  const blockOptions = useMemo(
    () => parseCatalogOptions(catalog?.blocks, 'block'),
    [catalog]
  )
  const playlistOptions = useMemo(
    () => parseCatalogOptions(catalog?.playlists, 'playlist'),
    [catalog]
  )
  const mediaOptions = useMemo(
    () => parseCatalogOptions(catalog?.media, 'media'),
    [catalog]
  )

  const currentApplyOptions = useMemo<CatalogOption[]>(() => {
    if (applyKind === 'profile') return profileOptions
    if (applyKind === 'channel') return channelOptions
    if (applyKind === 'block') return blockOptions
    if (applyKind === 'playlist') return playlistOptions
    return mediaOptions
  }, [applyKind, profileOptions, channelOptions, blockOptions, playlistOptions, mediaOptions])

  const toggleNodeSelection = useCallback((id: string, checked: boolean) => {
    setSelectedNodeIds((prev) => {
      if (checked) return Array.from(new Set([...prev, id]))
      return prev.filter((x) => x !== id)
    })
  }, [])

  const selectVisible = useCallback(() => {
    setSelectedNodeIds(Array.from(new Set([...selectedNodeIds, ...filteredRows.map((r) => r.id)])))
  }, [selectedNodeIds, filteredRows])

  const clearSelection = useCallback(() => setSelectedNodeIds([]), [])

  const runApply = useCallback(async () => {
    if (!applyId.trim()) {
      notifications.show({
        color: 'red',
        title: 'Target required',
        message: 'Choose a profile/channel/block/playlist/media target first.',
      })
      return
    }
    if (selectedNodeIds.length === 0) {
      notifications.show({
        color: 'red',
        title: 'No nodes selected',
        message: 'Select at least one node.',
      })
      return
    }

    try {
      const result = await applyTarget({
        target: applyKind,
        id: applyId.trim(),
        piIds: selectedNodeIds,
        mode: optMode === 'inherit' ? undefined : optMode,
        lock: toOptionBool(optLock),
        showQr: toOptionBool(optQr),
        playlist: toOptionBool(optPlaylist),
        nosplash: toOptionBool(optNosplash),
        hudMode: optHud === 'inherit' ? undefined : optHud,
        hudShowSec: typeof optHudSec === 'number' && Number.isFinite(optHudSec) ? optHudSec : undefined,
        theme: optTheme.trim() || undefined,
        displayRotate:
          optRotate === 'inherit'
            ? undefined
            : (Number(optRotate) as 0 | 90 | 180 | 270),
      })
      setApplyResult(result)
      notifications.show({
        color: result.ok ? 'teal' : 'orange',
        title: 'Apply completed',
        message: summarizeApplyResult(result),
      })
      refreshFleet()
    } catch (error) {
      notifications.show({
        color: 'red',
        title: 'Apply failed',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }, [
    applyId,
    applyKind,
    optHud,
    optHudSec,
    optLock,
    optMode,
    optNosplash,
    optPlaylist,
    optQr,
    optRotate,
    optTheme,
    refreshFleet,
    selectedNodeIds,
  ])

  const returnToGuide = useCallback(async () => {
    if (selectedNodeIds.length === 0) {
      notifications.show({
        color: 'red',
        title: 'No nodes selected',
        message: 'Select at least one node.',
      })
      return
    }
    try {
      const result = await openGuide({ piIds: selectedNodeIds, nosplash: true })
      notifications.show({
        color: result.ok ? 'teal' : 'orange',
        title: 'Return to guide',
        message: summarizeApplyResult(result),
      })
      refreshFleet()
    } catch (error) {
      notifications.show({
        color: 'red',
        title: 'Guide command failed',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }, [refreshFleet, selectedNodeIds])

  const exportDrafts = useCallback(() => {
    const blob = new Blob([JSON.stringify(draftStore, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `chiba-controller-drafts-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [draftStore])

  const pushDraftsToControlDb = useCallback(async () => {
    try {
      setBuilderBusy(true)
      const payload = toC3Payload(draftStore)
      const result = await importC3Resources(payload)
      notifications.show({
        color: 'teal',
        title: 'Drafts synced to control DB',
        message: `media:${result.counts.media} playlists:${result.counts.playlists} blocks:${result.counts.blocks} channels:${result.counts.channels} profiles:${result.counts.profiles}`,
      })
    } catch (error) {
      notifications.show({
        color: 'red',
        title: 'Sync to control DB failed',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBuilderBusy(false)
    }
  }, [draftStore])

  const loadDraftsFromControlDb = useCallback(async () => {
    try {
      setBuilderBusy(true)
      const result = await fetchC3Snapshot()
      setDraftStore(fromC3Payload(result.snapshot))
      notifications.show({
        color: 'teal',
        title: 'Drafts loaded from control DB',
        message: 'Builder is now showing persisted MPBCP resources.',
      })
    } catch (error) {
      notifications.show({
        color: 'red',
        title: 'Load from control DB failed',
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBuilderBusy(false)
    }
  }, [])

  return (
    <AppShell
      padding="md"
      header={{ height: 72 }}
      navbar={{ width: 280, breakpoint: 'sm', collapsed: { mobile: !controlOpen } }}
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <ActionIcon variant="subtle" onClick={() => setControlOpen((v) => !v)} aria-label="Toggle navigation">
              <IconAdjustments size={18} />
            </ActionIcon>
            <Title order={3}>Chiba Controller</Title>
            <Badge variant="light" color="violet">
              cable3
            </Badge>
          </Group>
          <Group gap="xs">
            <Checkbox
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.currentTarget.checked)}
              label="Auto refresh"
            />
            <Tooltip label="Refresh fleet + catalog">
              <ActionIcon
                size="lg"
                variant="filled"
                color="blue"
                onClick={() => {
                  refreshFleet()
                  setCatalogReloadToken((v) => v + 1)
                }}
              >
                {loadingFleet ? <Loader size={16} color="white" /> : <IconRefresh size={16} />}
              </ActionIcon>
            </Tooltip>
            <Button
              leftSection={<IconArrowsShuffle size={16} />}
              onClick={() => setApplyOpen(true)}
              disabled={selectedNodeIds.length === 0}
            >
              Apply
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <Stack gap="sm">
          <Card withBorder radius="md" p="sm">
            <Text size="xs" c="dimmed">
              Selected nodes
            </Text>
            <Title order={2}>{selectedNodeIds.length}</Title>
            <Text size="xs" c="dimmed">
              of {filteredRows.length} visible
            </Text>
          </Card>
          <SimpleGrid cols={2} spacing="xs">
            <Card withBorder p="xs">
              <Text size="xs" c="dimmed">
                Online
              </Text>
              <Text fw={700}>{metrics.online}</Text>
            </Card>
            <Card withBorder p="xs">
              <Text size="xs" c="dimmed">
                Degraded
              </Text>
              <Text fw={700}>{metrics.degraded}</Text>
            </Card>
            <Card withBorder p="xs">
              <Text size="xs" c="dimmed">
                Updating
              </Text>
              <Text fw={700}>{metrics.updating}</Text>
            </Card>
            <Card withBorder p="xs">
              <Text size="xs" c="dimmed">
                Total
              </Text>
              <Text fw={700}>{metrics.total}</Text>
            </Card>
          </SimpleGrid>
          <Divider />
          <TextInput
            leftSection={<IconSearch size={16} />}
            placeholder="Filter nodes by id/host/ip"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          <Group grow>
            <Button variant="light" onClick={selectVisible}>
              Select visible
            </Button>
            <Button variant="light" color="gray" onClick={clearSelection}>
              Clear
            </Button>
          </Group>
          <Button
            leftSection={<IconChecklist size={16} />}
            color="orange"
            variant="light"
            onClick={returnToGuide}
            disabled={selectedNodeIds.length === 0}
          >
            Return to guide
          </Button>
          <Text size="xs" c="dimmed">
            Last tick: {lastTick ? `${Math.round((Date.now() - lastTick) / 1000)}s ago` : '—'}
          </Text>
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>
        <Tabs defaultValue="fleet" keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="fleet" leftSection={<IconDeviceDesktopAnalytics size={16} />}>
              Fleet Observability
            </Tabs.Tab>
            <Tabs.Tab value="builder" leftSection={<IconServerCog size={16} />}>
              MPBCP Builder
            </Tabs.Tab>
            <Tabs.Tab value="catalog" leftSection={<IconDatabase size={16} />}>
              Catalog Snapshot
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="fleet" pt="md">
            <Paper withBorder radius="md" p="md">
              <Group justify="space-between" mb="sm">
                <Title order={4}>Connected Nodes</Title>
                <Text size="sm" c="dimmed">
                  Live status, runtime target, connectivity, and versions.
                </Text>
              </Group>
              <ScrollArea>
                <Table striped highlightOnHover withTableBorder withColumnBorders>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={42}>
                        <Checkbox
                          checked={
                            filteredRows.length > 0 &&
                            filteredRows.every((row) => selectedNodeIds.includes(row.id))
                          }
                          onChange={(e) => {
                            if (e.currentTarget.checked) {
                              setSelectedNodeIds(
                                Array.from(
                                  new Set([...selectedNodeIds, ...filteredRows.map((row) => row.id)])
                                )
                              )
                            } else {
                              setSelectedNodeIds((prev) =>
                                prev.filter((id) => !filteredRows.some((row) => row.id === id))
                              )
                            }
                          }}
                        />
                      </Table.Th>
                      <Table.Th>Node</Table.Th>
                      <Table.Th>Host/IP</Table.Th>
                      <Table.Th>Connectivity</Table.Th>
                      <Table.Th>Runtime</Table.Th>
                      <Table.Th>Versions</Table.Th>
                      <Table.Th>Last</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {filteredRows.map((row) => (
                      <Table.Tr key={row.id}>
                        <Table.Td>
                          <Checkbox
                            checked={selectedNodeIds.includes(row.id)}
                            onChange={(e) => toggleNodeSelection(row.id, e.currentTarget.checked)}
                          />
                        </Table.Td>
                        <Table.Td>
                          <Stack gap={2}>
                            <Group gap={8}>
                              <Text fw={700}>{row.id}</Text>
                              {statusBadge(row.ping.ok, 'OK', 'OFFLINE')}
                            </Group>
                            <Text size="xs" c="dimmed">
                              {row.nodeName}
                            </Text>
                          </Stack>
                        </Table.Td>
                        <Table.Td>
                          <Stack gap={2}>
                            <Text ff="monospace">{row.host}</Text>
                            <Text ff="monospace" c="dimmed">
                              {row.ip || '—'}
                            </Text>
                          </Stack>
                        </Table.Td>
                        <Table.Td>
                          <Group gap={6}>
                            {statusBadge(row.dnsOk, 'DNS', 'DNS')}
                            {statusBadge(row.tcp.ssh22.ok, 'SSH', 'SSH')}
                            {statusBadge(row.http.nodeStatus.ok, 'Node', 'Node')}
                            {statusBadge(row.http.cableVersion.ok, 'Cable', 'Cable')}
                          </Group>
                        </Table.Td>
                        <Table.Td>
                          <Stack gap={2}>
                            <Text size="sm" ff="monospace">
                              {parseTargetFromKioskUrl(row.chibaNode.kioskUrl ?? null)}
                            </Text>
                            <Button
                              variant="subtle"
                              size="compact-xs"
                              onClick={() => setActiveNodeId(row.id)}
                              leftSection={<IconBroadcast size={12} />}
                            >
                              Inspect
                            </Button>
                          </Stack>
                        </Table.Td>
                        <Table.Td>
                          <Stack gap={2}>
                            <Text size="xs">node: {row.chibaNode.version ?? '?'}</Text>
                            <Text size="xs">cable: {row.cableServer?.version ?? '?'}</Text>
                            <Text size="xs" c="dimmed">
                              sha: {row.cableServer?.gitSha ?? '—'}
                            </Text>
                          </Stack>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" c="dimmed">
                            {Math.max(0, Math.round((Date.now() - row.lastCheckedAt) / 1000))}s ago
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea>
            </Paper>
          </Tabs.Panel>

          <Tabs.Panel value="builder" pt="md">
            <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
              <Paper withBorder radius="md" p="md">
                <Group justify="space-between" mb="sm">
                  <Title order={4}>Resource Builder</Title>
                  <Badge color="orange" variant="light">
                    Alpha
                  </Badge>
                </Group>
                <Text size="sm" c="dimmed" mb="md">
                  Compose Media, Playlists, Blocks, Channels, and Profiles with hierarchical structure.
                  Drafts can be synced to the `cable3` control DB or exported as JSON for agent/CLI workflows.
                </Text>
                <Tabs defaultValue="media">
                  <Tabs.List>
                    <Tabs.Tab value="media">Media</Tabs.Tab>
                    <Tabs.Tab value="playlist">Playlist</Tabs.Tab>
                    <Tabs.Tab value="block">Block</Tabs.Tab>
                    <Tabs.Tab value="channel">Channel</Tabs.Tab>
                    <Tabs.Tab value="profile">Profile</Tabs.Tab>
                  </Tabs.List>

                  <Tabs.Panel value="media" pt="sm">
                    <Stack>
                      <TextInput label="Media ID" value={mediaDraft.id} onChange={(e) => setMediaDraft((d) => ({ ...d, id: e.currentTarget.value }))} />
                      <TextInput label="Title" value={mediaDraft.title} onChange={(e) => setMediaDraft((d) => ({ ...d, title: e.currentTarget.value }))} />
                      <TextInput label="Artist" value={mediaDraft.artist} onChange={(e) => setMediaDraft((d) => ({ ...d, artist: e.currentTarget.value }))} />
                      <SegmentedControl
                        value={mediaDraft.sourceType}
                        onChange={(v) => setMediaDraft((d) => ({ ...d, sourceType: v as 'path' | 'url' }))}
                        data={[
                          { label: 'Path', value: 'path' },
                          { label: 'URL', value: 'url' },
                        ]}
                      />
                      <TextInput
                        label={mediaDraft.sourceType === 'path' ? 'Filesystem path' : 'Remote URL'}
                        value={mediaDraft.sourceValue}
                        onChange={(e) => setMediaDraft((d) => ({ ...d, sourceValue: e.currentTarget.value }))}
                      />
                      <Checkbox
                        label="Cache on nodes"
                        checked={mediaDraft.cache}
                        onChange={(e) => setMediaDraft((d) => ({ ...d, cache: e.currentTarget.checked }))}
                      />
                      <Button
                        onClick={() => {
                          if (!mediaDraft.id.trim() || !mediaDraft.sourceValue.trim()) return
                          setDraftStore((store) => ({
                            ...store,
                            media: [...store.media.filter((m) => m.id !== mediaDraft.id.trim()), { ...mediaDraft, id: mediaDraft.id.trim() }],
                          }))
                          notifications.show({ color: 'teal', title: 'Draft saved', message: `media:${mediaDraft.id.trim()}` })
                        }}
                      >
                        Save Media Draft
                      </Button>
                    </Stack>
                  </Tabs.Panel>

                  <Tabs.Panel value="playlist" pt="sm">
                    <Stack>
                      <TextInput label="Playlist ID" value={playlistDraft.id} onChange={(e) => setPlaylistDraft((d) => ({ ...d, id: e.currentTarget.value }))} />
                      <TextInput label="Title" value={playlistDraft.title} onChange={(e) => setPlaylistDraft((d) => ({ ...d, title: e.currentTarget.value }))} />
                      <TextInput label="Artist" value={playlistDraft.artist} onChange={(e) => setPlaylistDraft((d) => ({ ...d, artist: e.currentTarget.value }))} />
                      <Select
                        label="Add media item"
                        searchable
                        data={draftStore.media.map((m) => ({ value: m.id, label: `${m.id} • ${m.title || 'untitled'}` }))}
                        onChange={(value) => {
                          if (!value) return
                          setPlaylistDraft((d) => ({ ...d, mediaIds: Array.from(new Set([...d.mediaIds, value])) }))
                        }}
                      />
                      <Group gap={6}>
                        {playlistDraft.mediaIds.map((id) => (
                          <Badge
                            key={id}
                            variant="light"
                            rightSection={
                              <ActionIcon
                                color="gray"
                                variant="transparent"
                                size="xs"
                                onClick={() => setPlaylistDraft((d) => ({ ...d, mediaIds: d.mediaIds.filter((x) => x !== id) }))}
                              >
                                ×
                              </ActionIcon>
                            }
                          >
                            {id}
                          </Badge>
                        ))}
                      </Group>
                      <Button
                        onClick={() => {
                          if (!playlistDraft.id.trim()) return
                          setDraftStore((store) => ({
                            ...store,
                            playlists: [
                              ...store.playlists.filter((p) => p.id !== playlistDraft.id.trim()),
                              { ...playlistDraft, id: playlistDraft.id.trim() },
                            ],
                          }))
                          notifications.show({ color: 'teal', title: 'Draft saved', message: `playlist:${playlistDraft.id.trim()}` })
                        }}
                      >
                        Save Playlist Draft
                      </Button>
                    </Stack>
                  </Tabs.Panel>

                  <Tabs.Panel value="block" pt="sm">
                    <Stack>
                      <TextInput label="Block ID" value={blockDraft.id} onChange={(e) => setBlockDraft((d) => ({ ...d, id: e.currentTarget.value }))} />
                      <TextInput label="Title" value={blockDraft.title} onChange={(e) => setBlockDraft((d) => ({ ...d, title: e.currentTarget.value }))} />
                      <Select
                        label="Add playlist"
                        searchable
                        data={draftStore.playlists.map((p) => ({ value: p.id, label: `${p.id} • ${p.title || 'untitled'}` }))}
                        onChange={(value) => {
                          if (!value) return
                          setBlockDraft((d) => ({ ...d, playlistIds: Array.from(new Set([...d.playlistIds, value])) }))
                        }}
                      />
                      <Group gap={6}>
                        {blockDraft.playlistIds.map((id) => (
                          <Badge
                            key={id}
                            variant="light"
                            rightSection={
                              <ActionIcon
                                color="gray"
                                variant="transparent"
                                size="xs"
                                onClick={() => setBlockDraft((d) => ({ ...d, playlistIds: d.playlistIds.filter((x) => x !== id) }))}
                              >
                                ×
                              </ActionIcon>
                            }
                          >
                            {id}
                          </Badge>
                        ))}
                      </Group>
                      <Button
                        onClick={() => {
                          if (!blockDraft.id.trim()) return
                          setDraftStore((store) => ({
                            ...store,
                            blocks: [...store.blocks.filter((b) => b.id !== blockDraft.id.trim()), { ...blockDraft, id: blockDraft.id.trim() }],
                          }))
                          notifications.show({ color: 'teal', title: 'Draft saved', message: `block:${blockDraft.id.trim()}` })
                        }}
                      >
                        Save Block Draft
                      </Button>
                    </Stack>
                  </Tabs.Panel>

                  <Tabs.Panel value="channel" pt="sm">
                    <Stack>
                      <TextInput label="Channel ID" value={channelDraft.id} onChange={(e) => setChannelDraft((d) => ({ ...d, id: e.currentTarget.value }))} />
                      <TextInput label="Title" value={channelDraft.title} onChange={(e) => setChannelDraft((d) => ({ ...d, title: e.currentTarget.value }))} />
                      <Select
                        label="Add block"
                        searchable
                        data={draftStore.blocks.map((b) => ({ value: b.id, label: `${b.id} • ${b.title || 'untitled'}` }))}
                        onChange={(value) => {
                          if (!value) return
                          setChannelDraft((d) => ({ ...d, blockIds: Array.from(new Set([...d.blockIds, value])) }))
                        }}
                      />
                      <Group gap={6}>
                        {channelDraft.blockIds.map((id) => (
                          <Badge
                            key={id}
                            variant="light"
                            rightSection={
                              <ActionIcon
                                color="gray"
                                variant="transparent"
                                size="xs"
                                onClick={() => setChannelDraft((d) => ({ ...d, blockIds: d.blockIds.filter((x) => x !== id) }))}
                              >
                                ×
                              </ActionIcon>
                            }
                          >
                            {id}
                          </Badge>
                        ))}
                      </Group>
                      <Button
                        onClick={() => {
                          if (!channelDraft.id.trim()) return
                          setDraftStore((store) => ({
                            ...store,
                            channels: [
                              ...store.channels.filter((c) => c.id !== channelDraft.id.trim()),
                              { ...channelDraft, id: channelDraft.id.trim() },
                            ],
                          }))
                          notifications.show({ color: 'teal', title: 'Draft saved', message: `channel:${channelDraft.id.trim()}` })
                        }}
                      >
                        Save Channel Draft
                      </Button>
                    </Stack>
                  </Tabs.Panel>

                  <Tabs.Panel value="profile" pt="sm">
                    <Stack>
                      <TextInput label="Profile ID" value={profileDraft.id} onChange={(e) => setProfileDraft((d) => ({ ...d, id: e.currentTarget.value }))} />
                      <TextInput label="Title" value={profileDraft.title} onChange={(e) => setProfileDraft((d) => ({ ...d, title: e.currentTarget.value }))} />
                      <Select
                        label="Default target kind"
                        data={[
                          { value: 'media', label: 'media' },
                          { value: 'playlist', label: 'playlist' },
                          { value: 'block', label: 'block' },
                          { value: 'channel', label: 'channel' },
                        ]}
                        value={profileDraft.defaultTargetKind}
                        onChange={(value) =>
                          setProfileDraft((d) => ({
                            ...d,
                            defaultTargetKind:
                              (value as 'media' | 'playlist' | 'block' | 'channel') || d.defaultTargetKind,
                          }))
                        }
                      />
                      <TextInput
                        label="Default target id"
                        value={profileDraft.defaultTargetId}
                        onChange={(e) => setProfileDraft((d) => ({ ...d, defaultTargetId: e.currentTarget.value }))}
                      />
                      <Button
                        onClick={() => {
                          if (!profileDraft.id.trim()) return
                          setDraftStore((store) => ({
                            ...store,
                            profiles: [
                              ...store.profiles.filter((p) => p.id !== profileDraft.id.trim()),
                              { ...profileDraft, id: profileDraft.id.trim() },
                            ],
                          }))
                          notifications.show({ color: 'teal', title: 'Draft saved', message: `profile:${profileDraft.id.trim()}` })
                        }}
                      >
                        Save Profile Draft
                      </Button>
                    </Stack>
                  </Tabs.Panel>
                </Tabs>
              </Paper>

              <Paper withBorder radius="md" p="md">
                <Group justify="space-between" mb="sm">
                  <Title order={4}>Draft Hierarchy</Title>
                  <Group gap="xs">
                    <Button
                      variant="light"
                      color="blue"
                      loading={builderBusy}
                      onClick={loadDraftsFromControlDb}
                    >
                      Load from DB
                    </Button>
                    <Button
                      variant="light"
                      color="teal"
                      loading={builderBusy}
                      onClick={pushDraftsToControlDb}
                    >
                      Push to DB
                    </Button>
                    <Button
                      variant="light"
                      color="gray"
                      disabled={builderBusy}
                      onClick={() => setDraftStore(EMPTY_DRAFTS)}
                    >
                      Clear
                    </Button>
                    <Button
                      leftSection={<IconDownload size={16} />}
                      disabled={builderBusy}
                      onClick={exportDrafts}
                    >
                      Export JSON
                    </Button>
                  </Group>
                </Group>
                <JsonInput
                  value={JSON.stringify(draftStore, null, 2)}
                  autosize
                  minRows={24}
                  formatOnBlur
                  styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
                />
              </Paper>
            </SimpleGrid>
          </Tabs.Panel>

          <Tabs.Panel value="catalog" pt="md">
            <Paper withBorder radius="md" p="md">
              <Group justify="space-between" mb="sm">
                <Title order={4}>Catalog & Profile Snapshot</Title>
                <Button
                  variant="light"
                  leftSection={<IconRefresh size={16} />}
                  onClick={() => setCatalogReloadToken((v) => v + 1)}
                >
                  Reload
                </Button>
              </Group>
              <SimpleGrid cols={{ base: 1, lg: 2 }}>
                <Card withBorder>
                  <Text fw={700} mb="xs">
                    Catalog Counts
                  </Text>
                  <Code block>
                    {JSON.stringify(catalog?.counts ?? {}, null, 2)}
                  </Code>
                </Card>
                <Card withBorder>
                  <Text fw={700} mb="xs">
                    Profiles ({profiles.length})
                  </Text>
                  <Code block style={{ maxHeight: 260, overflow: 'auto' }}>
                    {JSON.stringify(
                      profiles.map((p) => ({ id: p.id, file: p.file, overrides: p.overridePis.length })),
                      null,
                      2
                    )}
                  </Code>
                </Card>
              </SimpleGrid>
            </Paper>
          </Tabs.Panel>
        </Tabs>
      </AppShell.Main>

      <Drawer
        opened={applyOpen}
        onClose={() => setApplyOpen(false)}
        position="right"
        size={460}
        title="Apply Target to Selected Nodes"
      >
        <Stack>
          <Text size="sm" c="dimmed">
            Selected: {selectedNodeIds.length} node(s)
          </Text>
          <Select
            label="Target kind"
            data={[
              { value: 'profile', label: 'profile' },
              { value: 'channel', label: 'channel' },
              { value: 'block', label: 'block' },
              { value: 'playlist', label: 'playlist' },
              { value: 'media', label: 'media' },
            ]}
            value={applyKind}
            onChange={(value) => {
              const next = (value as OpsApplyTarget) || 'profile'
              setApplyKind(next)
              setApplyId('')
            }}
          />
          <Select
            label="Target id"
            placeholder="Search target id"
            searchable
            data={currentApplyOptions}
            value={applyId}
            onChange={(value) => setApplyId(value || '')}
          />
          <Divider label="Options" labelPosition="left" />
          <Select
            label="mode"
            data={[
              { value: 'inherit', label: 'inherit' },
              { value: 'guide', label: 'guide' },
              { value: 'gallery', label: 'gallery' },
            ]}
            value={optMode}
            onChange={(v) => setOptMode((v as OptionMode) || 'inherit')}
          />
          <SimpleGrid cols={2}>
            <Select
              label="lock"
              data={[
                { value: 'inherit', label: 'inherit' },
                { value: 'on', label: 'on' },
                { value: 'off', label: 'off' },
              ]}
              value={optLock}
              onChange={(v) => setOptLock((v as OptionBool) || 'inherit')}
            />
            <Select
              label="qr"
              data={[
                { value: 'inherit', label: 'inherit' },
                { value: 'on', label: 'on' },
                { value: 'off', label: 'off' },
              ]}
              value={optQr}
              onChange={(v) => setOptQr((v as OptionBool) || 'inherit')}
            />
            <Select
              label="playlist flag"
              data={[
                { value: 'inherit', label: 'inherit' },
                { value: 'on', label: 'on' },
                { value: 'off', label: 'off' },
              ]}
              value={optPlaylist}
              onChange={(v) => setOptPlaylist((v as OptionBool) || 'inherit')}
            />
            <Select
              label="nosplash"
              data={[
                { value: 'inherit', label: 'inherit' },
                { value: 'on', label: 'on' },
                { value: 'off', label: 'off' },
              ]}
              value={optNosplash}
              onChange={(v) => setOptNosplash((v as OptionBool) || 'inherit')}
            />
          </SimpleGrid>
          <SimpleGrid cols={2}>
            <Select
              label="hud"
              data={[
                { value: 'inherit', label: 'inherit' },
                { value: 'always', label: 'always' },
                { value: 'start', label: 'start' },
                { value: 'never', label: 'never' },
              ]}
              value={optHud}
              onChange={(v) => setOptHud((v as OptionHud) || 'inherit')}
            />
            <NumberInput
              label="hud sec"
              value={optHudSec}
              onChange={(value) =>
                setOptHudSec(
                  typeof value === 'number' && Number.isFinite(value) ? value : ''
                )
              }
              min={1}
              max={120}
              placeholder="inherit"
            />
            <Select
              label="display rotate"
              data={[
                { value: 'inherit', label: 'inherit' },
                { value: '0', label: '0' },
                { value: '90', label: '90' },
                { value: '180', label: '180' },
                { value: '270', label: '270' },
              ]}
              value={optRotate}
              onChange={(v) => setOptRotate((v as OptionRotate) || 'inherit')}
            />
            <TextInput label="theme" value={optTheme} onChange={(e) => setOptTheme(e.currentTarget.value)} />
          </SimpleGrid>
          <Group justify="space-between">
            <Button variant="light" onClick={() => setApplyOpen(false)}>
              Close
            </Button>
            <Button leftSection={<IconAdjustments size={16} />} onClick={runApply}>
              Apply to selected
            </Button>
          </Group>
          {applyResult ? (
            <Paper withBorder p="sm">
              <Text fw={600} mb={4}>
                Last apply
              </Text>
              <Text size="sm" c={applyResult.ok ? 'teal' : 'orange'}>
                {summarizeApplyResult(applyResult)}
              </Text>
            </Paper>
          ) : null}
        </Stack>
      </Drawer>

      <Modal
        opened={Boolean(selectedNode)}
        onClose={() => setActiveNodeId(null)}
        title={selectedNode ? `Node Inspector • ${selectedNode.id}` : 'Node Inspector'}
        size="xl"
      >
        {selectedNode ? (
          <Stack>
            <SimpleGrid cols={2}>
              <Card withBorder>
                <Text size="sm" c="dimmed">
                  Runtime target
                </Text>
                <Text fw={700}>{parseTargetFromKioskUrl(selectedNode.chibaNode.kioskUrl ?? null)}</Text>
                <Text size="xs" c="dimmed" ff="monospace">
                  {selectedNode.chibaNode.kioskUrl || '—'}
                </Text>
              </Card>
              <Card withBorder>
                <Text size="sm" c="dimmed">
                  Connectivity
                </Text>
                <Group gap={6} mt={6}>
                  {statusBadge(selectedNode.dnsOk, 'DNS', 'DNS')}
                  {statusBadge(selectedNode.ping.ok, 'Ping', 'Ping')}
                  {statusBadge(selectedNode.tcp.ssh22.ok, 'SSH', 'SSH')}
                  {statusBadge(selectedNode.http.nodeStatus.ok, 'Node API', 'Node API')}
                </Group>
              </Card>
            </SimpleGrid>
            <JsonInput
              label="Raw node state"
              value={JSON.stringify(selectedNode, null, 2)}
              autosize
              minRows={18}
              formatOnBlur
            />
          </Stack>
        ) : null}
      </Modal>
    </AppShell>
  )
}
