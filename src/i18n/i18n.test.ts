import { describe, expect, it } from 'vitest'
import en from './en.json'
import zhCN from './zh-CN.json'

describe('translation resources', () => {
  it('keep English and Chinese keys in sync', () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort())
  })
})
