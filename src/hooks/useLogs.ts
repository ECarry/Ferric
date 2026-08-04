import { useQuery } from '@tanstack/react-query'
import { listRemoteLogs, readRemoteLog } from '@/lib/logs'
import type { SshConnectConfig } from '@/lib/ssh'

export const logsQueryKeys = {
  all: ['logs'] as const,
  list: (config: SshConnectConfig) =>
    [...logsQueryKeys.all, 'list', config.host, config.port, config.username] as const,
  content: (config: SshConnectConfig, logId: string, lines: number) =>
    [...logsQueryKeys.all, 'content', config.host, config.port, config.username, logId, lines] as const,
}

export function useRemoteLogs(config: SshConnectConfig) {
  return useQuery({
    queryKey: logsQueryKeys.list(config),
    queryFn: () => listRemoteLogs(config),
    staleTime: 30_000,
    retry: 1,
  })
}

export function useRemoteLog(config: SshConnectConfig, logId: string | null, lines: number) {
  return useQuery({
    queryKey: logsQueryKeys.content(config, logId ?? '', lines),
    queryFn: () => readRemoteLog(config, logId!, lines),
    enabled: Boolean(logId),
    staleTime: 5_000,
    retry: 1,
  })
}
