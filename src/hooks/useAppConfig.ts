import { useCallback, useEffect, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { loadConfig, saveConfig, type AppConfig } from '@/lib/store'

export const appConfigQueryKey = ['app-config'] as const

type ConfigUpdater = (config: AppConfig) => AppConfig

export function useAppConfig() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: appConfigQueryKey,
    queryFn: loadConfig,
    staleTime: Infinity,
    retry: 1,
  })
  const saveMutation = useMutation({
    mutationFn: saveConfig,
  })
  const { mutateAsync } = saveMutation
  const initialized = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (!query.data) return
    if (!initialized.current) {
      initialized.current = true
      return
    }
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void mutateAsync(query.data)
    }, 500)
    return () => clearTimeout(saveTimer.current)
  }, [mutateAsync, query.data])

  const updateConfig = useCallback((update: ConfigUpdater) => {
    queryClient.setQueryData<AppConfig>(appConfigQueryKey, (current) =>
      update(current ?? { servers: [], groups: [] }),
    )
  }, [queryClient])

  return {
    ...query,
    config: query.data,
    updateConfig,
    isSaving: saveMutation.isPending,
    saveError: saveMutation.error,
  }
}
