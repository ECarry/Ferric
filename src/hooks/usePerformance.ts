import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPerformanceSnapshot, type PerformanceSnapshot } from '@/lib/performance'
import type { SshConnectConfig } from '@/lib/ssh'

const HISTORY = 60

export interface PerformanceHistory {
  cpu: number[]
  memory: number[]
  disk: number[]
  network: number[]
  cpuCores: number[][]
  diskAvailable: Record<string, number[]>
}

const emptyHistory = (): PerformanceHistory => ({
  cpu: [],
  memory: [],
  disk: [],
  network: [],
  cpuCores: [],
  diskAvailable: {},
})

function appendSnapshot(previous: PerformanceHistory, snapshot: PerformanceSnapshot): PerformanceHistory {
  const diskAvailable = { ...previous.diskAvailable }
  snapshot.disk.forEach((disk) => {
    diskAvailable[disk.name] = [
      ...(diskAvailable[disk.name] ?? []).slice(-HISTORY + 1),
      disk.availableKb,
    ]
  })

  return {
    cpu: [...previous.cpu.slice(-HISTORY + 1), snapshot.cpu.utilization],
    memory: [...previous.memory.slice(-HISTORY + 1), snapshot.memory.percent],
    disk: [...previous.disk.slice(-HISTORY + 1), snapshot.disk[0]?.percent ?? 0],
    network: [
      ...previous.network.slice(-HISTORY + 1),
      snapshot.network.reduce((total, item) => total + item.rxKb + item.txKb, 0),
    ],
    cpuCores: snapshot.cpu.cores.map((value, index) => [
      ...(previous.cpuCores[index] ?? []).slice(-HISTORY + 1),
      value,
    ]),
    diskAvailable,
  }
}

export function usePerformanceSnapshot(config: SshConnectConfig) {
  const [history, setHistory] = useState<PerformanceHistory>(emptyHistory)

  const query = useQuery({
    queryKey: ['performance', config.host, config.port, config.username],
    queryFn: async () => {
      const snapshot = await getPerformanceSnapshot(config)
      setHistory((previous) => appendSnapshot(previous, snapshot))
      return snapshot
    },
    staleTime: 800,
    refetchInterval: 1_000,
    retry: 0,
  })

  return { ...query, history }
}
