import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Cpu, HardDrive, MemoryStick, Network, RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'

type ResourceId = 'cpu' | 'memory' | 'disk' | 'network'

const CORES = 24
const HISTORY = 40

function formatUptime(ms: number) {
  const sec = Math.floor(ms / 1000)
  const s = sec % 60
  const m = Math.floor((sec / 60) % 60)
  const h = Math.floor((sec / 3600) % 24)
  const d = Math.floor(sec / 86400)
  return `${d}:${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function randomLoad(max = 60) {
  return Math.max(0, Math.min(100, Math.random() * max + 5 + Math.random() * 20))
}

function Sparkline({ data, className }: { data: number[]; className?: string }) {
  const max = Math.max(1, ...data)
  const width = 100
  const height = 40
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
      <div className="h-8 w-16 shrink-0">
        <Sparkline data={data} className={cn(active ? 'text-white/70' : colorClass)} />
      </div>
    </button>
  )
}

function MiniGraph({ label, data, colorClass }: { label: string; data: number[]; colorClass: string }) {
  return (
    <div className="flex flex-col gap-1 rounded border border-border bg-card/50 p-2">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <div className="h-10 w-full">
        <Sparkline data={data} className={colorClass} />
      </div>
    </div>
  )
}

export function PerformanceView() {
  const { t } = useI18n()
  const [selected, setSelected] = useState<ResourceId>('cpu')
  const [cpuData, setCpuData] = useState<number[][]>(() =>
    Array.from({ length: CORES }, () => Array.from({ length: HISTORY }, () => randomLoad(30))),
  )
  const [cpuUtil, setCpuUtil] = useState(15.8)
  const [processes, setProcesses] = useState(734)
  const [memory, setMemory] = useState(44.9)
  const [disk, setDisk] = useState(6.1)
  const [network, setNetwork] = useState(0)
  const startRef = useRef(0)
  const [uptime, setUptime] = useState(0)
  const [, setTick] = useState(0)

  const refresh = () => {
    setCpuData(Array.from({ length: CORES }, () => Array.from({ length: HISTORY }, () => randomLoad(40))))
    setCpuUtil(Math.random() * 40 + 5)
    setMemory(Math.random() * 50 + 20)
    setDisk(Math.random() * 20)
    setNetwork(Math.random() > 0.7 ? Math.random() * 500 : 0)
    setProcesses(700 + Math.floor(Math.random() * 100))
  }

  useEffect(() => {
    startRef.current = Date.now()
    const interval = setInterval(() => {
      setCpuData((prev) =>
        prev.map((core) => {
          const next = randomLoad(40)
          return [...core.slice(1), next]
        }),
      )
      setCpuUtil((prev) => Math.max(0, Math.min(100, prev + (Math.random() - 0.5) * 8)))
      setUptime(Date.now() - startRef.current)
      setTick((n) => n + 1)
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  const resources: ResourceItemProps[] = useMemo(
    () => [
      {
        id: 'cpu',
        name: t('cpu'),
        icon: <Cpu className="h-5 w-5" />,
        value: `${cpuUtil.toFixed(1)}%`,
        active: selected === 'cpu',
        onClick: () => setSelected('cpu'),
        data: cpuData[0],
        colorClass: 'text-cyan-400',
      },
      {
        id: 'memory',
        name: t('memory'),
        icon: <MemoryStick className="h-5 w-5" />,
        value: `${memory.toFixed(1)}%`,
        active: selected === 'memory',
        onClick: () => setSelected('memory'),
        data: [memory, memory - 2, memory + 3, memory - 1, memory + 1],
        colorClass: 'text-violet-400',
      },
      {
        id: 'disk',
        name: t('disk'),
        icon: <HardDrive className="h-5 w-5" />,
        value: `${disk.toFixed(1)}%`,
        active: selected === 'disk',
        onClick: () => setSelected('disk'),
        data: [disk, disk + 1, disk - 0.5, disk, disk + 0.2],
        colorClass: 'text-green-400',
      },
      {
        id: 'network',
        name: t('network'),
        icon: <Network className="h-5 w-5" />,
        value: network === 0 ? 'Zero KB/s' : `${network.toFixed(0)} KB/s`,
        active: selected === 'network',
        onClick: () => setSelected('network'),
        data: [network, network, network, network, network],
        colorClass: 'text-rose-400',
      },
    ],
    [selected, cpuUtil, memory, disk, network, cpuData, t],
  )

  const renderMain = () => {
    if (selected === 'cpu') {
      return (
        <>
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h3 className="text-3xl font-semibold">{t('cpu')}</h3>
              <p className="text-sm text-muted-foreground">{t('logicalProcessors', { count: CORES })}</p>
            </div>
            <div className="text-4xl font-semibold text-cyan-400">{cpuUtil.toFixed(1)}%</div>
          </div>

          <div className="grid flex-1 grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
            {cpuData.map((data, i) => (
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
              <div className="font-semibold">{CORES}</div>
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

    const selectedResource = resources.find((r) => r.id === selected)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <Activity className="h-8 w-8 text-muted-foreground" />
        <h3 className="text-xl font-semibold">{selectedResource?.name}</h3>
        <p className="text-sm text-muted-foreground">
          {selectedResource?.value} — {t('notConnected')}
        </p>
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
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
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
