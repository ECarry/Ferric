export function joinPath(base: string, name: string) {
  return base === '/' ? `/${name}` : `${base}/${name}`
}

export function parentPath(path: string) {
  const parent = path.replace(/\/[^/]+\/?$/, '')
  return parent === '' ? '/' : parent
}

export function baseName(path: string) {
  return path.split('/').filter(Boolean).pop() ?? path
}

export function formatSize(bytes: number) {
  if (bytes === 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}
