import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Cpu, HardDrive, Loader2, MemoryStick, Network, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { formatAppError } from '@/lib/error'
import { getPerformanceSnapshot } from '@/lib/performance'
import type { SshConnectConfig } from '@/lib/ssh'

type ResourceId = string

const HISTORY = 60

function formatUptime(sec: number) {
  const s = Math.floor(sec % 60)
  const m = Math.floor((sec / 60) % 60)
  const h = Math.floor((sec / 3600) % 24)
  const d = Math.floor(sec / 86400)
  return `${d}:${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function formatKb(kb: number) {
  if (kb > 1048576) return `${(kb / 1048576).toFixed(1)} GB`
  if (kb > 1024) return `${(kb / 1024).toFixed(1)} MB`
  return `${kb.toFixed(0)} KB`
}

function Sparkline({ data, className }: { data: number[]; className?: string }) {
  const max = Math.max(1, ...data)
  const width = 100
  const height = 100
  const points = useMemo(() => {
    return data
      .map((v, i) => {
        const x = data.length === 1 ? 0 : (i / (data.length - 1)) * width
        const y = height - (v / max) * height
        return `${x},${y}`
      })
      .join(' ')
  }, [data, max])

  return (
    <svg className={cn('h-full w-full', className)} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        points={points}
      />
    </svg>
  )
}

interface ResourceItemProps {
  id: ResourceId
  name: string
  icon: React.ReactNode
  value: string
  active: boolean
  onClick: () => void
  data: number[]
  colorClass: string
}

function ResourceItem({ name, icon, value, active, onClick, data, colorClass }: ResourceItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border border-transparent p-3 text-left transition-colors',
        active ? 'bg-cyan-600 text-white' : 'hover:bg-muted',
      )}
    >
      <span className="shrink-0">{icon}</span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{name}</span>
        <span className="text-xs opacity-80">{value}</span>
      </div>
      <div className="h-8 w-8 shrink-0">
        <Sparkline data={data} className={cn(active ? 'text-white/70' : colorClass)} />
      </div>
    </button>
  )
}

function MiniGraph({ label, data, colorClass }: { label: string; data: number[]; colorClass: string }) {
  return (
    <div className="flex w-full flex-col gap-1 rounded border border-border bg-card/50 p-2 pb-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <div className="min-h-0 flex-1 w-full">
        <Sparkline data={data} className={colorClass} />
      </div>
    </div>
  )
}

interface PerformanceViewProps {
  sshConfig: SshConnectConfig
}

export function PerformanceView({ sshConfig }: PerformanceViewProps) {
  const { t } = useI18n()
  const [selected, setSelected] = useState<ResourceId>('cpu')
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof getPerformanceSnapshot>> | null>(null)
  const [history, setHistory] = useState<Record<ResourceId, number[]>>({
    cpu: [],
    memory: [],
    disk: [],
    network: [],
  })
  const [cpuCores, setCpuCores] = useState<number[][]>([])
  const [loading, setLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [diskHistory, setDiskHistory] = useState<Record<string, number[]>>({})
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getPerformanceSnapshot(sshConfig)
      setSnapshot(data)
      setHistory((prev) => ({
        cpu: [...prev.cpu.slice(-HISTORY + 1), data.cpu.utilization],
        memory: [...prev.memory.slice(-HISTORY + 1), data.memory.percent],
        disk: [...prev.disk.slice(-HISTORY + 1), data.disk[0]?.percent ?? 0],
        network: [...prev.network.slice(-HISTORY + 1), data.network.reduce((a, n) => a + n.rxKb + n.txKb, 0)],
      }))
      setCpuCores((prev) =>
        data.cpu.cores.map((v, i) => {
          const last = prev[i] ?? []
          return [...last.slice(-HISTORY + 1), v]
        }),
      )
      setDiskHistory((prev) => {
        const next = { ...prev }
        data.disk.forEach((d) => {
          const arr = next[d.name] ?? []
          next[d.name] = [...arr.slice(-HISTORY + 1), d.percent]
        })
        return next
      })
    } catch (e) {
      setError(formatAppError(e, t))
    } finally {
      setLoading(false)
    }
  }, [sshConfig, t])

  useEffect(() => {
    let active = true
    let timeout: ReturnType<typeof setTimeout> | null = null
    const run = async () => {
      if (!active) return
      await load()
      if (active) timeout = setTimeout(run, 1000)
    }
    run()
    return () => {
      active = false
      if (timeout) clearTimeout(timeout)
    }
  }, [load])

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await load()
    } finally {
      setIsRefreshing(false)
    }
  }, [load])

  const cpuUtil = snapshot?.cpu.utilization ?? 0
  const processes = snapshot?.cpu.processes ?? 0
  const logical = snapshot?.cpu.logicalProcessors ?? 0
  const memory = snapshot?.memory.percent ?? 0
  const network = (snapshot?.network ?? []).reduce((a, n) => a + n.rxKb + n.txKb, 0)
  const uptime = snapshot?.uptime ?? 0

  const selectedDisk = useMemo(() => snapshot?.disk?.find((d) => d.name === selected), [snapshot, selected])

  const resources: ResourceItemProps[] = useMemo(
    () => [
      {
        id: 'cpu',
        name: t('cpu'),
        icon: <Cpu className="h-5 w-5" />,
        value: `${cpuUtil.toFixed(1)}%`,
        active: selected === 'cpu',
        onClick: () => setSelected('cpu'),
        data: history.cpu,
        colorClass: 'text-cyan-400',
      },
      {
        id: 'memory',
        name: t('memory'),
        icon: <MemoryStick className="h-5 w-5" />,
        value: `${memory.toFixed(1)}%`,
        active: selected === 'memory',
        onClick: () => setSelected('memory'),
        data: history.memory,
        colorClass: 'text-violet-400',
      },
      ...(snapshot?.disk ?? []).map((d) => ({
        id: d.name,
        name: d.name,
        icon: <HardDrive className="h-5 w-5" />,
        value: `${d.percent.toFixed(1)}%`,
        active: selected === d.name,
        onClick: () => setSelected(d.name),
        data: diskHistory[d.name] ?? [],
        colorClass: 'text-green-400',
      })),
      {
        id: 'network',
        name: t('network'),
        icon: <Network className="h-5 w-5" />,
        value: network === 0 ? 'Zero KB/s' : `${network.toFixed(1)} KB/s`,
        active: selected === 'network',
        onClick: () => setSelected('network'),
        data: history.network,
        colorClass: 'text-rose-400',
      },
    ],
    [selected, t, cpuUtil, memory, network, history, snapshot, diskHistory],
  )

  const renderMain = () => {
    if (loading && !snapshot) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <span className="text-sm">{t('loadingContainers')}</span>
        </div>
      )
    }

    if (error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <p className="max-w-md text-sm text-destructive">{error}</p>
        </div>
      )
    }

    if (selected === 'cpu') {
      return (
        <>
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h3 className="text-3xl font-semibold">{t('cpu')}</h3>
              <p className="text-sm text-muted-foreground">{logical} {t('logicalProcessors')}</p>
            </div>
            <div className="text-4xl font-semibold text-cyan-400">{cpuUtil.toFixed(1)}%</div>
          </div>

          <div className="grid grid-cols-8 gap-2">
            {cpuCores.map((data, i) => (
              <MiniGraph key={i} label={`CPU ${i}`} data={data} colorClass="text-cyan-400" />
            ))}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 md:grid-cols-5">
            <div>
              <div className="text-xs text-muted-foreground">{t('utilization')}</div>
              <div className="font-semibold">{cpuUtil.toFixed(1)}%</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t('processes')}</div>
              <div className="font-semibold">{processes.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t('logicalProcessors')}</div>
              <div className="font-semibold">{logical}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t('uptime')}</div>
              <div className="font-semibold">{formatUptime(uptime)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t('duration')}</div>
              <div className="font-semibold">{t('seconds60')}</div>
            </div>
          </div>
        </>
      )
    }

    if (selected === 'memory' && snapshot) {
      return (
        <div className="space-y-4">
          <div className="flex items-end justify-between">
            <h3 className="text-3xl font-semibold">{t('memory')}</h3>
            <div className="text-4xl font-semibold text-violet-400">{memory.toFixed(1)}%</div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded border border-border p-4">
              <div className="text-xs text-muted-foreground">Total</div>
              <div className="text-lg font-semibold">{formatKb(snapshot.memory.totalKb)}</div>
            </div>
            <div className="rounded border border-border p-4">
              <div className="text-xs text-muted-foreground">Used</div>
              <div className="text-lg font-semibold">{formatKb(snapshot.memory.usedKb)}</div>
            </div>
            <div className="rounded border border-border p-4">
              <div className="text-xs text-muted-foreground">Free</div>
              <div className="text-lg font-semibold">{formatKb(snapshot.memory.freeKb)}</div>
            </div>
          </div>
        </div>
      )
    }

    if (selectedDisk) {
      const data = diskHistory[selectedDisk.name] ?? []
      return (
        <div className="space-y-4">
          <div className="flex items-end justify-between">
            <h3 className="truncate text-3xl font-semibold">{selectedDisk.name}</h3>
            <div className="text-4xl font-semibold text-green-400">{selectedDisk.percent.toFixed(1)}%</div>
          </div>
          <div className="h-40 w-full rounded border border-border p-3">
            <Sparkline data={data} className="text-green-400" />
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded border border-border p-3">
              <div className="text-xs text-muted-foreground">Capacity</div>
              <div className="font-semibold">{formatKb(selectedDisk.totalKb)}</div>
            </div>
            <div className="rounded border border-border p-3">
              <div className="text-xs text-muted-foreground">Available</div>
              <div className="font-semibold">{formatKb(selectedDisk.availableKb)}</div>
            </div>
          </div>
        </div>
      )
    }

    if (selected === 'network' && snapshot) {
      return (
        <div className="space-y-4">
          <h3 className="text-3xl font-semibold">{t('network')}</h3>
          <div className="flex flex-col gap-2">
            {snapshot.network.map((n) => (
              <div key={n.name} className="flex items-center justify-between rounded border border-border p-3">
                <span className="font-mono text-sm">{n.name}</span>
                <div className="text-sm">
                  <span className="text-green-400">↓ {n.rxKb.toFixed(1)} KB/s</span>
                  <span className="mx-2 text-muted-foreground">/</span>
                  <span className="text-rose-400">↑ {n.txKb.toFixed(1)} KB/s</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )
    }

    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
        <Activity className="h-8 w-8" />
        <span>{t('notConnected')}</span>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h2 className="text-lg font-semibold">{t('performance')}</h2>
        <div className="flex items-center gap-2">
          <div className="relative hidden sm:block">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder={t('searchByNameUserOrPid')}
              className="h-8 w-48 pl-8 md:w-72"
            />
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefreshing}>
            <RefreshCw className={cn('mr-1.5 h-4 w-4', isRefreshing && 'animate-spin')} />
            {t('refresh')}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 overflow-y-auto border-r border-border p-3">
          <div className="flex flex-col gap-2">
            {resources.map((r) => (
              <ResourceItem key={r.id} {...r} />
            ))}
          </div>
        </aside>

        <main className="flex min-h-0 flex-1 flex-col p-5">{renderMain()}</main>
      </div>
    </div>
  )
}
