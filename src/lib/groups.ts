import type { ServerGroup } from '@/types'

/**
 * Built-in default groups seeded by the backend (`store.rs`). Their persisted
 * names are Chinese, so we localize them for display until the user renames
 * them. Keyed by the stable group id; `seededNames` lists the original names
 * across supported languages so a renamed group keeps its custom label.
 */
const DEFAULT_GROUPS: Record<string, { key: string; seededNames: string[] }> = {
  'g-prod': { key: 'groupProd', seededNames: ['生产环境', 'Production'] },
  'g-staging': { key: 'groupStaging', seededNames: ['测试环境', 'Staging'] },
  'g-personal': { key: 'groupPersonal', seededNames: ['个人服务器', 'Personal'] },
}

/**
 * Resolve the display name for a group, localizing the built-in default groups
 * while preserving any custom name the user has set.
 */
export function groupDisplayName(
  group: ServerGroup,
  t: (key: string) => string,
): string {
  const entry = DEFAULT_GROUPS[group.id]
  if (entry && entry.seededNames.includes(group.name)) return t(entry.key)
  return group.name
}
