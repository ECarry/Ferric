import { useCallback, useEffect, useState } from 'react'
import {
  ArrowUp,
  ChevronRight,
  Download,
  File as FileIcon,
  FolderClosed,
  Home,
  Loader2,
  RefreshCw,
  Upload,
} from 'lucide-react'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import type { RemoteFile } from '@/types'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import {
  onDownloadProgress,
  onUploadProgress,
  sftpDownload,
  sftpDownloadDir,
  sftpHome,
  sftpList,
  sftpUpload,
} from '@/lib/sftp'

interface FileBrowserProps {
  sessionId: string
}

function joinPath(base: string, name: string) {
  return base === '/' ? `/${name}` : `${base}/${name}`
}

function parentPath(path: string) {
  const parent = path.replace(/\/[^/]+\/?$/, '')
  return parent === '' ? '/' : parent
}

function baseName(path: string) {
  return path.split('/').filter(Boolean).pop() ?? path
}

function formatSize(bytes: number) {
  if (bytes === 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function FileBrowser({ sessionId }: FileBrowserProps) {
  const { t } = useI18n()
  const [path, setPath] = useState('/')
  const [files, setFiles] = useState<RemoteFile[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<{
    transferred: number
    total: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadDir = useCallback(
    async (target: string) => {
      setLoading(true)
      setError(null)
      try {
        const list = await sftpList(sessionId, target)
        setFiles(list)
        setPath(target)
        setSelected(null)
      } catch (e) {
        setError(String(e))
      } finally {
        setLoading(false)
      }
    },
    [sessionId],
  )

  // On session change, jump to the remote home directory.
  useEffect(() => {
    let cancelled = false
    sftpHome(sessionId)
      .then((home) => {
        if (!cancelled) void loadDir(home || '/')
      })
      .catch(() => {
        if (!cancelled) void loadDir('/')
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, loadDir])

  const selectedFile = files.find((f) => f.name === selected) ?? null

  const onUpload = async () => {
    const picked = await openDialog({ multiple: false, directory: false })
    if (typeof picked !== 'string') return
    setBusy(t('uploading'))
    setError(null)
    setProgress({ transferred: 0, total: 0 })
    const unlisten = await onUploadProgress((p) => {
      if (p.id === sessionId)
        setProgress({ transferred: p.transferred, total: p.total })
    })
    try {
      await sftpUpload(sessionId, picked, joinPath(path, baseName(picked)))
      await loadDir(path)
    } catch (e) {
      setError(String(e))
    } finally {
      unlisten()
      setBusy(null)
      setProgress(null)
    }
  }

  const onDownload = async () => {
    if (!selectedFile) return
    const remotePath = joinPath(path, selectedFile.name)
    const isDir = selectedFile.type === 'dir'

    // Files pick a save target; folders pick a destination parent directory.
    const dest = isDir
      ? await openDialog({ directory: true, multiple: false })
      : await saveDialog({ defaultPath: selectedFile.name })
    if (typeof dest !== 'string') return

    setBusy(isDir ? t('downloadingFolder') : t('downloading'))
    setError(null)
    setProgress({ transferred: 0, total: isDir ? 0 : selectedFile.size })
    const unlisten = await onDownloadProgress((p) => {
      if (p.id === sessionId)
        setProgress({ transferred: p.transferred, total: p.total })
    })
    try {
      if (isDir) {
        await sftpDownloadDir(sessionId, remotePath, dest)
      } else {
        await sftpDownload(sessionId, remotePath, dest)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      unlisten()
      setBusy(null)
      setProgress(null)
    }
  }

  const segments = path.split('/').filter(Boolean)

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Button
          variant="ghost"
          size="icon-sm"
          title={t('parentDirectory')}
          disabled={path === '/'}
          onClick={() => void loadDir(parentPath(path))}
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title={t('homeDirectory')}
          onClick={() => sftpHome(sessionId).then((h) => loadDir(h || '/'))}
        >
          <Home className="h-4 w-4" />
        </Button>
        <div className="flex flex-1 items-center gap-1 overflow-x-auto rounded-lg bg-muted px-3 py-1.5 text-sm">
          <button
            className="text-muted-foreground hover:text-foreground"
            onClick={() => void loadDir('/')}
          >
            /
          </button>
          {segments.map((seg, i) => {
            const target = '/' + segments.slice(0, i + 1).join('/')
            return (
              <span key={target} className="flex items-center gap-1">
                <button
                  className="whitespace-nowrap hover:text-foreground"
                  onClick={() => void loadDir(target)}
                >
                  {seg}
                </button>
                {i < segments.length - 1 && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                )}
              </span>
            )
          })}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          title={t('refresh')}
          onClick={() => void loadDir(path)}
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </Button>
        <Button variant="outline" size="sm" disabled={!!busy} onClick={onUpload}>
          <Upload className="h-4 w-4" />
          {t('upload')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!selectedFile || !!busy}
          onClick={onDownload}
        >
          <Download className="h-4 w-4" />
          {t('download')}
        </Button>
      </div>

      {/* File table */}
      <div className="flex-1 overflow-auto">
        {error ? (
          <div className="px-4 py-3 font-mono text-xs text-destructive">{error}</div>
        ) : null}
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-background text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-4 py-2 text-left font-medium">{t('fileName')}</th>
              <th className="px-4 py-2 text-right font-medium">{t('size')}</th>
              <th className="px-4 py-2 text-left font-medium">{t('modified')}</th>
              <th className="px-4 py-2 text-left font-medium">{t('permissions')}</th>
            </tr>
          </thead>
          <tbody>
            {files.map((file) => (
              <tr
                key={file.name}
                onClick={() => setSelected(file.name)}
                onDoubleClick={() => {
                  if (file.type === 'dir') {
                    void loadDir(joinPath(path, file.name))
                  }
                }}
                className={cn(
                  'cursor-default border-b border-border/50 transition-colors',
                  selected === file.name ? 'bg-accent' : 'hover:bg-muted',
                )}
              >
                <td className="flex items-center gap-2 px-4 py-2">
                  {file.type === 'dir' ? (
                    <FolderClosed className="h-4 w-4 text-primary" />
                  ) : (
                    <FileIcon className="h-4 w-4 text-muted-foreground" />
                  )}
                  <span>{file.name}</span>
                </td>
                <td className="px-4 py-2 text-right text-muted-foreground">
                  {file.type === 'dir' ? '-' : formatSize(file.size)}
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {file.modified || '-'}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-muted-foreground">
                  {file.permissions}
                </td>
              </tr>
            ))}
            {!loading && files.length === 0 && !error ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                >
                  {t('emptyDirectory')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground">
        {busy ? (
          <div className="flex flex-1 items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            <span className="shrink-0">{busy}</span>
            {progress && progress.total > 0 ? (
              <>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-150"
                    style={{
                      width: `${Math.min(100, Math.floor((progress.transferred / progress.total) * 100))}%`,
                    }}
                  />
                </div>
                <span className="shrink-0 tabular-nums">
                  {formatSize(progress.transferred)} / {formatSize(progress.total)} (
                  {Math.min(100, Math.floor((progress.transferred / progress.total) * 100))}%)
                </span>
              </>
            ) : progress ? (
              <span className="shrink-0 tabular-nums">
                {formatSize(progress.transferred)}
              </span>
            ) : null}
          </div>
        ) : selected ? (
          <span>
            {t('selected')} <span className="text-foreground">{selected}</span>
          </span>
        ) : (
          <span>{t('fileHint')}</span>
        )}
      </div>
    </div>
  )
}
