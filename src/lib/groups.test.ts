import { describe, expect, it } from 'vitest'
import { groupDisplayName } from './groups'

describe('groupDisplayName', () => {
  it('localizes seeded groups without changing custom names', () => {
    const translate = (key: string) => `translated:${key}`

    expect(groupDisplayName({ id: 'g-prod', name: 'Production' }, translate)).toBe('translated:groupProd')
    expect(groupDisplayName({ id: 'g-staging', name: '自定义' }, translate)).toBe('自定义')
    expect(groupDisplayName({ id: 'custom', name: 'Production' }, translate)).toBe('Production')
  })
})
