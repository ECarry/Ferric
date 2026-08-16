import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor, act } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useAppConfig } from './useAppConfig'

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}))

vi.mock('@/lib/store', () => ({
  loadConfig: mocks.loadConfig,
  saveConfig: mocks.saveConfig,
}))

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

describe('useAppConfig', () => {
  beforeEach(() => {
    mocks.loadConfig.mockResolvedValue({ servers: [], groups: [] })
    mocks.saveConfig.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('retains a failed save for manual retry', async () => {
    mocks.saveConfig
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)

    const { result } = renderHook(() => useAppConfig(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.config).toEqual({ servers: [], groups: [] }))

    act(() => {
      result.current.updateConfig((config) => ({
        ...config,
        groups: [{ id: 'g-1', name: 'Test' }],
      }))
    })
    await waitFor(() => expect(mocks.saveConfig).toHaveBeenCalledTimes(1))

    expect(mocks.saveConfig).toHaveBeenCalledTimes(1)
    expect(result.current.saveError).toBeTruthy()

    act(() => result.current.retrySave())
    await act(async () => undefined)

    await waitFor(() => expect(mocks.saveConfig).toHaveBeenCalledTimes(2))
    expect(result.current.saveError).toBeNull()
  })
})
