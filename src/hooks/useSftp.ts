import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  sftpHome,
  sftpList,
  sftpMkdir,
  sftpRemove,
  sftpRename,
} from '@/lib/sftp'

export const sftpQueryKeys = {
  all: ['sftp'] as const,
  home: (sessionId: string) => [...sftpQueryKeys.all, 'home', sessionId] as const,
  directory: (sessionId: string, path: string) =>
    [...sftpQueryKeys.all, 'directory', sessionId, path] as const,
}

export function useSftpHome(sessionId: string) {
  return useQuery({
    queryKey: sftpQueryKeys.home(sessionId),
    queryFn: () => sftpHome(sessionId),
    enabled: Boolean(sessionId),
    staleTime: Infinity,
    retry: 1,
  })
}

export function useSftpDirectory(sessionId: string, path: string) {
  return useQuery({
    queryKey: sftpQueryKeys.directory(sessionId, path),
    queryFn: () => sftpList(sessionId, path),
    enabled: Boolean(sessionId && path),
    staleTime: 5_000,
    retry: 1,
  })
}

export function useSftpMutations(sessionId: string, path: string) {
  const queryClient = useQueryClient()
  const invalidateDirectory = () =>
    queryClient.invalidateQueries({
      queryKey: sftpQueryKeys.directory(sessionId, path),
    })

  const mkdir = useMutation({
    mutationFn: (targetPath: string) => sftpMkdir(sessionId, targetPath),
    onSuccess: invalidateDirectory,
  })

  const rename = useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) =>
      sftpRename(sessionId, from, to),
    onSuccess: invalidateDirectory,
  })

  const remove = useMutation({
    mutationFn: ({ targetPath, isDir }: { targetPath: string; isDir: boolean }) =>
      sftpRemove(sessionId, targetPath, isDir),
    onSuccess: invalidateDirectory,
  })

  return { mkdir, rename, remove }
}
