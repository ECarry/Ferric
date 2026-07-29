import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUp,
  ChevronRight,
  Download,
  File as FileIcon,
  FolderClosed,
  FolderPlus,
  Home,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
  FolderUp,
  X,
} from 'lucide-react'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import type { UnlistenFn } from '@tauri-apps/api/event'
import type { RemoteFile } from '@/types'
import { cn } from '@/lib/utils'
import { formatAppError } from '@/lib/error'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  onDownloadProgress,
  onUploadProgress,
  sftpCancel,
  sftpDownload,
  sftpDownloadDir,
  sftpHome,
  sftpList,
  sftpMkdir,
  sftpRemove,
  sftpRename,
  sftpUpload,
  sftpUploadDir,
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
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [promptDialog, setPromptDialog] = useState<{
    title: string
    label: string
    initialValue: string
    showInput: boolean
    onConfirm: (value: string) => Promise<void>
  } | null>(null)
  const [promptValue, setPromptValue] = useState('')
  const [promptBusy, setPromptBusy] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const dragPathsRef = useRef<string[]>([])

  const onCancel = async () => {
    setCancelling(true)
    try {
      await sftpCancel(sessionId)
    } catch (e) {
      console.error('取消传输失败', e)
    }
  }

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
        setError(formatAppError(e, t))
      } finally {
        setLoading(false)
      }
    },
    [sessionId, t],
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
    setCancelling(false)
    setProgress({ transferred: 0, total: 0 })
    const unlisten = await onUploadProgress((p) => {
      if (p.id === sessionId)
        setProgress({ transferred: p.transferred, total: p.total })
    })
    try {
      await sftpUpload(sessionId, picked, joinPath(path, baseName(picked)))
      await loadDir(path)
    } catch (e) {
      setError(formatAppError(e, t))
    } finally {
      unlisten()
      setBusy(null)
      setProgress(null)
      setCancelling(false)
    }
  }

  const onUploadFolder = async () => {
    const picked = await openDialog({ multiple: false, directory: true })
    if (typeof picked !== 'string') return
    setBusy(t('uploadingFolder'))
    setError(null)
    setCancelling(false)
    setProgress({ transferred: 0, total: 0 })
    const unlisten = await onUploadProgress((p) => {
      if (p.id === sessionId)
        setProgress({ transferred: p.transferred, total: p.total })
    })
    try {
      await sftpUploadDir(sessionId, picked, path)
      await loadDir(path)
    } catch (e) {
      setError(formatAppError(e, t))
    } finally {
      unlisten()
      setBusy(null)
      setProgress(null)
      setCancelling(false)
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
    setCancelling(false)
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
      setError(formatAppError(e, t))
    } finally {
      unlisten()
      setBusy(null)
      setProgress(null)
      setCancelling(false)
    }
  }

  const onMkdir = () => {
    setPromptValue('')
    setPromptDialog({
      title: t('newFolder'),
      label: t('newFolderPrompt'),
      initialValue: '',
      showInput: true,
      onConfirm: async (name) => {
        await sftpMkdir(sessionId, joinPath(path, name))
        await loadDir(path)
      },
    })
  }

  const onRename = () => {
    if (!selectedFile) return
    setPromptValue(selectedFile.name)
    setPromptDialog({
      title: t('rename'),
      label: t('renamePrompt'),
      initialValue: selectedFile.name,
      showInput: true,
      onConfirm: async (newName) => {
        await sftpRename(
          sessionId,
          joinPath(path, selectedFile.name),
          joinPath(path, newName),
        )
        await loadDir(path)
      },
    })
  }

  const onRemove = () => {
    if (!selectedFile) return
    setPromptDialog({
      title: t('remove'),
      label: t('confirmDelete', { name: selectedFile.name }),
      initialValue: '',
      showInput: false,
      onConfirm: async () => {
        await sftpRemove(
          sessionId,
          joinPath(path, selectedFile.name),
          selectedFile.type === 'dir',
        )
        setSelected(null)
        await loadDir(path)
      },
    })
  }

  const onPromptConfirm = async () => {
    if (!promptDialog) return
    const value = promptValue.trim()
    if (!value) return
    setPromptBusy(true)
    setError(null)
    try {
      await promptDialog.onConfirm(value)
      setPromptDialog(null)
    } catch (e) {
      setError(formatAppError(e, t))
    } finally {
      setPromptBusy(false)
    }
  }

  // Track whether the drag overlay should be shown. Because Tauri fires
  // `enter`/`over` on the whole webview, we use a ref on the file table
  // container to test if the cursor is within our bounds.
  const tableAreaRef = useRef<HTMLDivElement>(null)
  const isDraggingOver = (pos: { x: number; y: number }) => {
    const el = tableAreaRef.current
    if (!el) return false
    const rect = el.getBoundingClientRect()
    return pos.x >= rect.left && pos.x <= rect.right && pos.y >= rect.top && pos.y <= rect.bottom
  }

  useEffect(() => {
    let unlisten: UnlistenFn | undefined
    getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === 'enter' || event.payload.type === 'over') {
        const pos = event.payload.position
        if (isDraggingOver({ x: pos.x, y: pos.y })) {
          setDragActive(true)
          if (event.payload.type === 'enter') {
            dragPathsRef.current = event.payload.paths
          }
        } else {
          setDragActive(false)
        }
      } else if (event.payload.type === 'drop') {
        const pos = event.payload.position
        if (isDraggingOver({ x: pos.x, y: pos.y })) {
          const paths = event.payload.paths
          if (paths.length > 0) {
            void onDropUpload(paths)
          }
        }
        setDragActive(false)
        dragPathsRef.current = []
      } else if (event.payload.type === 'leave') {
        setDragActive(false)
        dragPathsRef.current = []
      }
    }).then((fn) => {
      unlisten = fn
    })
    return () => {
      unlisten?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, busy])

  const onDropUpload = async (paths: string[]) => {
    if (busy) return
    setBusy(t('uploading'))
    setError(null)
    setCancelling(false)
    setProgress({ transferred: 0, total: 0 })
    const unlisten = await onUploadProgress((p) => {
      if (p.id === sessionId)
        setProgress({ transferred: p.transferred, total: p.total })
    })
    try {
      for (const localPath of paths) {
        // Heuristic: trailing slash or known directory check isn't available
        // from the path alone. We attempt sftpUploadDir first; if it fails
        // because the path is a file, fall back to sftpUpload.
        try {
          await sftpUploadDir(sessionId, localPath, path)
        } catch {
          await sftpUpload(sessionId, localPath, joinPath(path, baseName(localPath)))
        }
      }
      await loadDir(path)
    } catch (e) {
      setError(formatAppError(e, t))
    } finally {
      unlisten()
      setBusy(null)
      setProgress(null)
      setCancelling(false)
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
          disabled={!!busy}
          onClick={onUploadFolder}
        >
          <FolderUp className="h-4 w-4" />
          {t('uploadFolder')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!!busy}
          onClick={onMkdir}
        >
          <FolderPlus className="h-4 w-4" />
          {t('newFolder')}
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
      <ContextMenu>
        <ContextMenuTrigger render={<div ref={tableAreaRef} className="relative flex-1 overflow-auto" />}>
          {dragActive && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-primary/10 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-primary/50 bg-background/80 px-8 py-6">
                <Upload className="h-8 w-8 text-primary" />
                <p className="text-sm font-medium text-primary">{t('dragDropHint')}</p>
              </div>
            </div>
          )}
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
                  onContextMenu={() => setSelected(file.name)}
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
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={onMkdir} disabled={!!busy}>
            <FolderPlus className="h-4 w-4" />
            {t('newFolder')}
          </ContextMenuItem>
          {selectedFile && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={onRename} disabled={!!busy}>
                <Pencil className="h-4 w-4" />
                {t('rename')}
              </ContextMenuItem>
              <ContextMenuItem onClick={onDownload} disabled={!!busy}>
                <Download className="h-4 w-4" />
                {t('download')}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive" onClick={onRemove} disabled={!!busy}>
                <Trash2 className="h-4 w-4" />
                {t('remove')}
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      {/* Status bar */}
      <div className="flex items-center gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground">
        {busy ? (
          <div className="flex flex-1 items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            <span className="shrink-0">{cancelling ? t('cancelling') : busy}</span>
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
            <Button
              variant="ghost"
              size="icon-xs"
              className="ml-auto shrink-0"
              title={t('cancelTransfer')}
              disabled={cancelling}
              onClick={onCancel}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : selected ? (
          <span>
            {t('selected')} <span className="text-foreground">{selected}</span>
          </span>
        ) : (
          <span>{t('fileHint')}</span>
        )}
      </div>

      {/* Prompt dialog for mkdir / rename / remove */}
      <Dialog open={!!promptDialog} onOpenChange={(open) => { if (!open) setPromptDialog(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{promptDialog?.title}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <label className="text-sm text-muted-foreground">{promptDialog?.label}</label>
            {promptDialog?.showInput && (
              <Input
                autoFocus
                value={promptValue}
                onChange={(e) => setPromptValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void onPromptConfirm()
                }}
                placeholder={promptDialog?.initialValue}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPromptDialog(null)}>
              {t('cancel')}
            </Button>
            <Button
              onClick={() => void onPromptConfirm()}
              disabled={promptBusy || (promptDialog?.showInput && !promptValue.trim())}
            >
              {t('confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
