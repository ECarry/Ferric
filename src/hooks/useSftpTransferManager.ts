import { useCallback, useRef, useState } from 'react'
import {
  createTransferId,
  onDownloadProgress,
  onUploadProgress,
  sftpCancel,
  type TransferProgress,
} from '@/lib/sftp'

export type TransferKind = 'upload' | 'download'
export type TransferStatus = 'queued' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed'

export interface TransferTask {
  id: string
  kind: TransferKind
  label: string
  status: TransferStatus
  transferred: number
  total: number
  error?: string
  startedAt: number
  finishedAt?: number
}

export interface StartTransferOptions {
  kind: TransferKind
  label: string
  total?: number
  run: (transferId: string) => Promise<void>
}

export function useSftpTransferManager(sessionId: string) {
  const [tasks, setTasks] = useState<TransferTask[]>([])
  const [paused, setPaused] = useState(false)
  const resumeWaiters = useRef<Array<() => void>>([])
  const runners = useRef(new Map<string, StartTransferOptions>())
  const cancelledIds = useRef(new Set<string>())

  const updateTask = useCallback((id: string, update: Partial<TransferTask>) => {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, ...update } : task))
  }, [])

  const start = useCallback(async ({ kind, label, total = 0, run }: StartTransferOptions) => {
    const id = createTransferId()
    runners.current.set(id, { kind, label, total, run })
    setTasks((current) => [...current, {
      id,
      kind,
      label,
      status: paused ? 'queued' : 'running',
      transferred: 0,
      total,
      startedAt: Date.now(),
    }])

    if (paused) {
      await new Promise<void>((resolve) => resumeWaiters.current.push(resolve))
      updateTask(id, { status: 'running' })
    }

    const onProgress = (progress: TransferProgress) => {
      if (progress.transferId === id && progress.sessionId === sessionId) {
        updateTask(id, {
          transferred: progress.transferred,
          total: progress.total,
        })
      }
    }
    const [unlistenUpload, unlistenDownload] = await Promise.all([
      onUploadProgress(onProgress),
      onDownloadProgress(onProgress),
    ])

    try {
      await run(id)
      updateTask(id, {
        status: cancelledIds.current.has(id) ? 'cancelled' : 'completed',
        finishedAt: Date.now(),
      })
      cancelledIds.current.delete(id)
    } catch (error) {
      updateTask(id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        finishedAt: Date.now(),
      })
      throw error
    } finally {
      unlistenUpload()
      unlistenDownload()
    }

    return id
  }, [paused, sessionId, updateTask])

  const retry = useCallback(async (id: string) => {
    const runner = runners.current.get(id)
    if (!runner) return
    return start(runner)
  }, [start])

  const cancel = useCallback(async (id: string) => {
    cancelledIds.current.add(id)
    updateTask(id, { status: 'cancelling' })
    try {
      await sftpCancel(id)
    } catch (error) {
      cancelledIds.current.delete(id)
      updateTask(id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        finishedAt: Date.now(),
      })
      throw error
    }
  }, [updateTask])

  const history = tasks.filter((task) =>
    task.status === 'completed' || task.status === 'cancelled' || task.status === 'failed',
  )
  const pause = useCallback(() => setPaused(true), [])
  const resume = useCallback(() => {
    setPaused(false)
    const waiters = resumeWaiters.current.splice(0)
    waiters.forEach((resolve) => resolve())
  }, [])

  return { tasks, history, paused, start, cancel, retry, pause, resume }
}
