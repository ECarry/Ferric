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
  const pendingConfig = useRef<AppConfig | undefined>(undefined)
  const saving = useRef(false)
  const flushSaveRef = useRef<() => void>(() => {})
  const flushSave = useCallback(() => {
    if (saving.current || !pendingConfig.current) return
    const config = pendingConfig.current
    pendingConfig.current = undefined
    saving.current = true
    void mutateAsync(config).finally(() => {
      saving.current = false
      if (pendingConfig.current) {
        saveTimer.current = setTimeout(() => flushSaveRef.current(), 500)
      }
    })
  }, [mutateAsync])

  useEffect(() => {
    flushSaveRef.current = flushSave
  }, [flushSave])

  useEffect(() => {
    if (!query.data) return
    if (!initialized.current) {
      initialized.current = true
      return
    }
    pendingConfig.current = query.data
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(flushSave, 500)
    return () => clearTimeout(saveTimer.current)
  }, [flushSave, query.data])

  useEffect(() => {
    return () => {
      clearTimeout(saveTimer.current)
      flushSave()
    }
  }, [flushSave])

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
