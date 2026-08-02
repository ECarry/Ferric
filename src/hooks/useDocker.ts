import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  controlRemoteContainer,
  createRemoteContainer,
  getRemoteDockerInfo,
  removeRemoteContainer,
  renameRemoteContainer,
  type CreateDockerContainerInput,
} from '@/lib/docker'
import type { SshConnectConfig } from '@/lib/ssh'

export const dockerQueryKeys = {
  all: ['docker'] as const,
  info: (config: SshConnectConfig, all: boolean) =>
    [...dockerQueryKeys.all, 'info', config.host, config.port, config.username, all] as const,
}

export function useDockerInfo(config: SshConnectConfig, all = true) {
  return useQuery({
    queryKey: dockerQueryKeys.info(config, all),
    queryFn: () => getRemoteDockerInfo(config, all),
    staleTime: 10_000,
    retry: 1,
  })
}

export function useDockerMutations(config: SshConnectConfig, all = true) {
  const queryClient = useQueryClient()
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: dockerQueryKeys.info(config, all) })

  const control = useMutation({
    mutationFn: ({ containerId, action }: {
      containerId: string
      action: 'start' | 'stop' | 'restart'
    }) => controlRemoteContainer(config, containerId, action),
    onSuccess: invalidate,
  })

  const create = useMutation({
    mutationFn: (input: CreateDockerContainerInput) => createRemoteContainer(config, input),
    onSuccess: invalidate,
  })

  const rename = useMutation({
    mutationFn: ({ containerId, name }: { containerId: string; name: string }) =>
      renameRemoteContainer(config, containerId, name),
    onSuccess: invalidate,
  })

  const remove = useMutation({
    mutationFn: ({ containerId, force }: { containerId: string; force: boolean }) =>
      removeRemoteContainer(config, containerId, force),
    onSuccess: invalidate,
  })

  return { control, create, rename, remove }
}
