import { describe, expect, it } from 'vitest'
import { baseName, formatSize, joinPath, parentPath } from './file-utils'

describe('file utilities', () => {
  it('joins and navigates remote paths safely', () => {
    expect(joinPath('/', 'etc')).toBe('/etc')
    expect(joinPath('/var', 'log')).toBe('/var/log')
    expect(parentPath('/')).toBe('/')
    expect(parentPath('/var/log/')).toBe('/var')
    expect(baseName('/var/log/system.log')).toBe('system.log')
    expect(baseName('/')).toBe('/')
  })

  it('formats byte sizes consistently', () => {
    expect(formatSize(0)).toBe('-')
    expect(formatSize(1024)).toBe('1.0 KB')
    expect(formatSize(1024 * 1024)).toBe('1.0 MB')
  })
})
