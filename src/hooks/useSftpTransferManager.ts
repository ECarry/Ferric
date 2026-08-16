import { useCallback, useEffect, useRef, useState } from 'react'
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

const MAX_TRANSFER_HISTORY = 100

function trimTasks(tasks: TransferTask[]): TransferTask[] {
  const historyIds = new Set(
    tasks
      .filter((task) => task.status === 'completed' || task.status === 'cancelled' || task.status === 'failed')
      .slice(-MAX_TRANSFER_HISTORY)
      .map((task) => task.id),
  )
  return tasks.filter((task) =>
    task.status === 'queued' || task.status === 'running' || task.status === 'cancelling' || historyIds.has(task.id),
  )
}

export function useSftpTransferManager(sessionId: string) {
  const [tasks, setTasks] = useState<TransferTask[]>([])
  const [paused, setPaused] = useState(false)
  const resumeWaiters = useRef(new Map<string, () => void>())
  const queuedIds = useRef(new Set<string>())
  const runners = useRef(new Map<string, StartTransferOptions>())
  const cancelledIds = useRef(new Set<string>())
  const activeTransferIds = useRef(new Set<string>())
  const disposed = useRef(false)

  useEffect(() => {
    const waitersRef = resumeWaiters.current
    const queuedIdsRef = queuedIds.current
    const runnersRef = runners.current
    const cancelledIdsRef = cancelledIds.current
    const activeTransferIdsRef = activeTransferIds.current
    return () => {
      disposed.current = true
      const waiters = [...waitersRef.values()]
      const activeTransferIds = [...activeTransferIdsRef]
      waitersRef.clear()
      queuedIdsRef.clear()
      runnersRef.clear()
      cancelledIdsRef.clear()
      activeTransferIdsRef.clear()
      waiters.forEach((resolve) => resolve())
      activeTransferIds.forEach((id) => {
        void sftpCancel(id).catch(() => undefined)
      })
    }
  }, [])

  const updateTask = useCallback((id: string, update: Partial<TransferTask>) => {
    setTasks((current) => trimTasks(current.map((task) => task.id === id ? { ...task, ...update } : task)))
  }, [])

  const start = useCallback(async ({ kind, label, total = 0, run }: StartTransferOptions) => {
    const id = createTransferId()
    runners.current.set(id, { kind, label, total, run })
    const queued = paused
    if (queued) queuedIds.current.add(id)
    setTasks((current) => trimTasks([...current, {
      id,
      kind,
      label,
      status: queued ? 'queued' : 'running',
      transferred: 0,
      total,
      startedAt: Date.now(),
    }]))

    if (queued) {
      await new Promise<void>((resolve) => resumeWaiters.current.set(id, resolve))
      queuedIds.current.delete(id)
      if (disposed.current) {
        runners.current.delete(id)
        return id
      }
      if (cancelledIds.current.has(id)) {
        updateTask(id, { status: 'cancelled', finishedAt: Date.now() })
        cancelledIds.current.delete(id)
        runners.current.delete(id)
        return id
      }
      updateTask(id, { status: 'running' })
    }

    activeTransferIds.current.add(id)
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
      runners.current.delete(id)
    } catch (error) {
      updateTask(id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        finishedAt: Date.now(),
      })
      throw error
    } finally {
      activeTransferIds.current.delete(id)
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
    if (queuedIds.current.has(id)) {
      cancelledIds.current.add(id)
      updateTask(id, { status: 'cancelled', finishedAt: Date.now() })
      queuedIds.current.delete(id)
      const resolve = resumeWaiters.current.get(id)
      resumeWaiters.current.delete(id)
      resolve?.()
      return
    }

    if (cancelledIds.current.has(id)) return
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
    const waiters = [...resumeWaiters.current.values()]
    resumeWaiters.current.clear()
    waiters.forEach((resolve) => resolve())
  }, [])

  return { tasks, history, paused, start, cancel, retry, pause, resume }
}
