import { invoke } from '@tauri-apps/api/core'
import type { SshConnectConfig } from './ssh'

export interface CpuMetrics {
  utilization: number
  logicalProcessors: number
  cores: number[]
  processes: number
}

export interface MemoryMetrics {
  totalKb: number
  usedKb: number
  freeKb: number
  percent: number
}

export interface DiskMetrics {
  name: string
  percent: number
}

export interface NetworkMetrics {
  name: string
  rxKb: number
  txKb: number
}

export interface PerformanceSnapshot {
  cpu: CpuMetrics
  memory: MemoryMetrics
  disk: DiskMetrics[]
  network: NetworkMetrics[]
  uptime: number
}

/** 获取远程服务器当前性能快照（采样约 1 秒） */
export function getPerformanceSnapshot(config: SshConnectConfig): Promise<PerformanceSnapshot> {
  return invoke<PerformanceSnapshot>('get_performance_snapshot', { config })
}
