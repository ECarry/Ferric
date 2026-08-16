import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSftpTransferManager } from './useSftpTransferManager'

const mocks = vi.hoisted(() => ({
  nextId: 0,
  sftpCancel: vi.fn(async () => undefined),
}))

vi.mock('@/lib/sftp', () => ({
  createTransferId: () => `transfer-${++mocks.nextId}`,
  onDownloadProgress: vi.fn(async () => () => undefined),
  onUploadProgress: vi.fn(async () => () => undefined),
  sftpCancel: mocks.sftpCancel,
}))

describe('useSftpTransferManager', () => {
  beforeEach(() => {
    mocks.nextId = 0
    mocks.sftpCancel.mockClear()
  })

  it('cancels queued transfers without calling the backend', async () => {
    const { result } = renderHook(() => useSftpTransferManager('session-1'))
    let runCalled = false

    act(() => result.current.pause())
    let startPromise: Promise<string> | undefined
    act(() => {
      startPromise = result.current.start({
        kind: 'upload',
        label: 'queued.txt',
        run: async () => {
          runCalled = true
        },
      })
    })

    const taskId = result.current.tasks[0]?.id
    expect(result.current.tasks[0]?.status).toBe('queued')
    expect(taskId).toBeDefined()

    await act(async () => {
      await result.current.cancel(taskId!)
      await startPromise
    })

    expect(result.current.tasks[0]?.status).toBe('cancelled')
    expect(runCalled).toBe(false)
    expect(mocks.sftpCancel).not.toHaveBeenCalled()
  })

  it('keeps only the latest transfer history entries', async () => {
    const { result } = renderHook(() => useSftpTransferManager('session-1'))

    for (let index = 0; index < 105; index += 1) {
      await act(async () => {
        await result.current.start({
          kind: 'download',
          label: `file-${index}.txt`,
          run: async () => undefined,
        })
      })
    }

    expect(result.current.tasks).toHaveLength(100)
    expect(result.current.history).toHaveLength(100)
    expect(result.current.history[0]?.label).toBe('file-5.txt')
    expect(result.current.history.at(-1)?.label).toBe('file-104.txt')
  })
})
