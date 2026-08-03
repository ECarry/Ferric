import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { controlRemoteService, listRemoteServices } from '@/lib/services'
import type { SshConnectConfig } from '@/lib/ssh'

export const serviceQueryKeys = {
  all: ['services'] as const,
  list: (config: SshConnectConfig) =>
    [...serviceQueryKeys.all, config.host, config.port, config.username] as const,
}

export function useRemoteServices(config: SshConnectConfig) {
  return useQuery({
    queryKey: serviceQueryKeys.list(config),
    queryFn: () => listRemoteServices(config),
    staleTime: 5_000,
    retry: 1,
  })
}

export function useServiceMutations(config: SshConnectConfig) {
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: serviceQueryKeys.list(config) })
  const control = useMutation({
    mutationFn: ({ service, action }: { service: string; action: 'start' | 'stop' | 'restart' }) =>
      controlRemoteService(config, service, action),
    onSuccess: invalidate,
  })
  return { control }
}
