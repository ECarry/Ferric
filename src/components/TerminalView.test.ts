import { describe, expect, it } from 'vitest'
import { decodeTerminalChunk } from '@/lib/terminal-output'

describe('decodeTerminalChunk', () => {
  it('preserves UTF-8 characters split across output chunks', () => {
    const decoder = new TextDecoder()
    const bytes = new TextEncoder().encode('你好')

    expect(decodeTerminalChunk(decoder, bytes.slice(0, 1))).toBe('')
    expect(decodeTerminalChunk(decoder, bytes.slice(1, 4))).toBe('你')
    expect(decodeTerminalChunk(decoder, bytes.slice(4))).toBe('好')
  })
})
