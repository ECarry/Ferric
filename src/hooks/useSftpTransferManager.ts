import { useCallback, useRef, useState } from 'react'
import {
  createTransferId,
  onDownloadProgress,
  onUploadProgress,
  sftpCancel,
  type TransferProgress,
} from '@/lib/sftp'

export type TransferKind = 'upload' | 'download'
export type TransferStatus = 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed'

export interface TransferTask {
  id: string
  kind: TransferKind
  label: string
  status: TransferStatus
  transferred: number
  total: number
  error?: string
}

interface StartTransferOptions {
  kind: TransferKind
  label: string
  total?: number
  run: (transferId: string) => Promise<void>
}

export function useSftpTransferManager(sessionId: string) {
  const [tasks, setTasks] = useState<TransferTask[]>([])
  const cancelledIds = useRef(new Set<string>())

  const updateTask = useCallback((id: string, update: Partial<TransferTask>) => {
    setTasks((current) => current.map((task) => task.id === id ? { ...task, ...update } : task))
  }, [])

  const start = useCallback(async ({ kind, label, total = 0, run }: StartTransferOptions) => {
    const id = createTransferId()
    setTasks((current) => [...current, {
      id,
      kind,
      label,
      status: 'running',
      transferred: 0,
      total,
    }])

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
      })
      cancelledIds.current.delete(id)
    } catch (error) {
      updateTask(id, {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    } finally {
      unlistenUpload()
      unlistenDownload()
    }

    return id
  }, [sessionId, updateTask])

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
      })
      throw error
    }
  }, [updateTask])

  return { tasks, start, cancel }
}
