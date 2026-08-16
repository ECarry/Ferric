import { useCallback, useEffect, useRef, useState } from 'react'
import { useSftpDirectory, useSftpHome, useSftpMutations } from '@/hooks/useSftp'
import { useSftpTransferManager } from '@/hooks/useSftpTransferManager'
import {
  ArrowUp,
  ChevronRight,
  Clipboard,
  Copy,
  Download,
  FolderClosed,
  FolderInput,
  FolderPlus,
  Home,
  Info,
  Pencil,
  Play,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
  FolderUp,
  Send,
  X,
} from 'lucide-react'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { cn } from '@/lib/utils'
import type { RemoteFile } from '@/types'
import { formatAppError } from '@/lib/error'
import { baseName, formatSize, joinPath, parentPath } from '@/lib/file-utils'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ConfirmDialog'
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
import { FileBrowserTable } from './FileBrowserTable'
import {
  sftpDownload,
  sftpDownloadDir,
  sftpUpload,
  sftpUploadDir,
} from '@/lib/sftp'

interface FileBrowserProps {
  sessionId: string
  onSendToTerminal?: (path: string) => void
}

export function FileBrowser({ sessionId, onSendToTerminal }: FileBrowserProps) {
  const { t } = useI18n()
  const homeQuery = useSftpHome(sessionId)
  const [requestedPath, setRequestedPath] = useState<string | null>(null)
  const path = requestedPath ?? homeQuery.data ?? '/'
  const [selected, setSelected] = useState<string | null>(null)
  const directoryQuery = useSftpDirectory(sessionId, path)
  const { mkdir, rename, remove, invalidateDirectory } = useSftpMutations(sessionId, path)
  const transferManager = useSftpTransferManager(sessionId)
  const { tasks, history, start, retry: retryTransfer, cancel: cancelTransfer, paused, pause, resume } = transferManager
  const files = directoryQuery.data ?? []
  const loading = directoryQuery.isLoading || directoryQuery.isFetching
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
  const [propertiesFile, setPropertiesFile] = useState<typeof selectedFile>(null)
  const [deleteTarget, setDeleteTarget] = useState<RemoteFile | null>(null)
  const dragPathsRef = useRef<string[]>([])

  const onCancelTask = async (id: string) => {
    try {
      await cancelTransfer(id)
    } catch (e) {
      setError(formatAppError(e, t))
    }
  }

  const onRetryTask = async (id: string) => {
    try {
      await retryTransfer(id)
    } catch (e) {
      setError(formatAppError(e, t))
    }
  }

  const navigate = useCallback((target: string) => {
    setRequestedPath(target)
    setSelected(null)
    setError(null)
  }, [])

  const selectedFile = files.find((f) => f.name === selected) ?? null
  const selectedRemotePath = selectedFile ? joinPath(path, selectedFile.name) : path
  const queryError = directoryQuery.error ? formatAppError(directoryQuery.error, t) : null
  const visibleError = error ?? queryError

  const onUpload = async () => {
    const picked = await openDialog({ multiple: false, directory: false })
    if (typeof picked !== 'string') return
    setError(null)
    try {
      await start({
        kind: 'upload',
        label: baseName(picked),
        run: (transferId) => sftpUpload(sessionId, transferId, picked, joinPath(path, baseName(picked))),
      })
      await invalidateDirectory()
    } catch (e) {
      setError(formatAppError(e, t))
    }
  }

  const onUploadFolder = async () => {
    const picked = await openDialog({ multiple: false, directory: true })
    if (typeof picked !== 'string') return
    setError(null)
    try {
      await start({
        kind: 'upload',
        label: baseName(picked),
        run: (transferId) => sftpUploadDir(sessionId, transferId, picked, path),
      })
      await invalidateDirectory()
    } catch (e) {
      setError(formatAppError(e, t))
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

    setError(null)
    try {
      await start({
        kind: 'download',
        label: selectedFile.name,
        total: isDir ? 0 : selectedFile.size,
        run: (transferId) => isDir
          ? sftpDownloadDir(sessionId, transferId, remotePath, dest)
          : sftpDownload(sessionId, transferId, remotePath, dest),
      })
    } catch (e) {
      setError(formatAppError(e, t))
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
        await mkdir.mutateAsync(joinPath(path, name))
        navigate(path)
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
        await rename.mutateAsync({
          from: joinPath(path, selectedFile.name),
          to: joinPath(path, newName),
        })
        navigate(path)
      },
    })
  }

  const onOpen = () => {
    if (selectedFile?.type === 'dir') void navigate(selectedRemotePath)
  }

  const onMoveTo = () => {
    if (!selectedFile) return
    setPromptValue(path)
    setPromptDialog({
      title: t('moveTo'),
      label: t('moveToPrompt'),
      initialValue: path,
      showInput: true,
      onConfirm: async (destination) => {
        await rename.mutateAsync({
          from: selectedRemotePath,
          to: joinPath(destination.replace(/\/$/, '') || '/', selectedFile.name),
        })
        navigate(path)
      },
    })
  }

  const onCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
    } catch (e) {
      setError(formatAppError(e, t))
    }
  }

  const sendSelectedPath = () => {
    onSendToTerminal?.(selectedRemotePath)
  }

  const onRemove = () => {
    if (selectedFile) setDeleteTarget(selectedFile)
  }

  const onConfirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await remove.mutateAsync({
        targetPath: joinPath(path, deleteTarget.name),
        isDir: deleteTarget.type === 'dir',
      })
      setSelected(null)
      setDeleteTarget(null)
      navigate(path)
    } catch (e) {
      setError(formatAppError(e, t))
    }
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
  const isDraggingOver = useCallback((pos: { x: number; y: number }) => {
    const el = tableAreaRef.current
    if (!el) return false
    const rect = el.getBoundingClientRect()
    return pos.x >= rect.left && pos.x <= rect.right && pos.y >= rect.top && pos.y <= rect.bottom
  }, [])

  const onDropUpload = useCallback(async (paths: string[]) => {
    setError(null)
    try {
      await start({
        kind: 'upload',
        label: t('droppedItems', { count: paths.length }),
        run: async (transferId) => {
          for (const localPath of paths) {
            try {
              await sftpUploadDir(sessionId, transferId, localPath, path)
            } catch {
              await sftpUpload(sessionId, transferId, localPath, joinPath(path, baseName(localPath)))
            }
          }
        },
      })
      await invalidateDirectory()
    } catch (e) {
      setError(formatAppError(e, t))
    }
  }, [invalidateDirectory, path, sessionId, start, t])

  useEffect(() => {
    let disposed = false
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
      if (disposed) fn()
      else unlisten = fn
    })
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [isDraggingOver, onDropUpload, path, sessionId, t])

  const segments = path.split('/').filter(Boolean)

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5">
        <Button
          variant="ghost"
          size="icon-sm"
          title={t('parentDirectory')}
          disabled={path === '/'}
          onClick={() => void navigate(parentPath(path))}
        >
          <ArrowUp className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title={t('homeDirectory')}
          onClick={() => navigate(homeQuery.data || '/')}
        >
          <Home className="h-4 w-4" />
        </Button>
        <div className="flex flex-1 items-center gap-1 overflow-x-auto rounded-lg bg-muted px-3 py-1.5 text-sm">
          <button
            className="text-muted-foreground hover:text-foreground"
            onClick={() => void navigate('/')}
          >
            /
          </button>
          {segments.map((seg, i) => {
            const target = '/' + segments.slice(0, i + 1).join('/')
            return (
              <span key={target} className="flex items-center gap-1">
                <button
                  className="whitespace-nowrap hover:text-foreground"
                  onClick={() => void navigate(target)}
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
          onClick={() => void navigate(path)}
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </Button>
        {onSendToTerminal && (
          <Button
            variant="outline"
            size="sm"
            title={t('sendPathToTerminal')}
            onClick={sendSelectedPath}
          >
            <Send className="h-4 w-4" />
            {t('sendToTerminal')}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={onUpload}>
          <Upload className="h-4 w-4" />
          {t('upload')}
        </Button>
        <Button
          variant="outline"
          size="sm"
         
          onClick={onUploadFolder}
        >
          <FolderUp className="h-4 w-4" />
          {t('uploadFolder')}
        </Button>
        <Button
          variant="outline"
          size="sm"
         
          onClick={onMkdir}
        >
          <FolderPlus className="h-4 w-4" />
          {t('newFolder')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!selectedFile}
          onClick={onDownload}
        >
          <Download className="h-4 w-4" />
          {t('download')}
        </Button>
      </div>

      {/* File table */}
      <ContextMenu>
        <ContextMenuTrigger render={<div ref={tableAreaRef} className="relative flex-1 overflow-auto" />}>
          <FileBrowserTable
            files={files}
            selected={selected}
            loading={loading}
            dragActive={dragActive}
            visibleError={visibleError}
            onSelect={setSelected}
            onOpenFile={(file) => {
              if (file.type === 'dir') void navigate(joinPath(path, file.name))
            }}
          />
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-52">
          <ContextMenuItem onClick={onOpen} disabled={!selectedFile || selectedFile.type !== 'dir'}>
            <FolderClosed className="h-4 w-4" />
            {t('open')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => void invalidateDirectory()}>
            <RefreshCw className="h-4 w-4" />
            {t('refresh')}
          </ContextMenuItem>
          <ContextMenuItem onClick={onUpload}>
            <Upload className="h-4 w-4" />
            {t('uploadHere')}
            <ChevronRight className="ml-auto h-4 w-4" />
          </ContextMenuItem>
          <ContextMenuItem onClick={onDownload} disabled={!selectedFile}>
            <Download className="h-4 w-4" />
            {t('download')}
            <ChevronRight className="ml-auto h-4 w-4" />
          </ContextMenuItem>
          {selectedFile && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={onRename}>
                <Pencil className="h-4 w-4" />
                {t('rename')}
                <span className="ml-auto">...</span>
              </ContextMenuItem>
              <ContextMenuItem onClick={onMoveTo}>
                <FolderInput className="h-4 w-4" />
                {t('moveTo')}
                <span className="ml-auto">...</span>
              </ContextMenuItem>
              <ContextMenuItem variant="destructive" onClick={onRemove}>
                <Trash2 className="h-4 w-4" />
                {t('remove')}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => void onCopy(selectedRemotePath)}>
                <Copy className="h-4 w-4" />
                {t('copyPath')}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => void onCopy(selectedFile.name)}>
                <Clipboard className="h-4 w-4" />
                {t('copyName')}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => void onCopy(path)}>
                <FolderClosed className="h-4 w-4" />
                {t('copyDirPath')}
              </ContextMenuItem>
              {onSendToTerminal && (
                <ContextMenuItem onClick={sendSelectedPath}>
                  <Send className="h-4 w-4" />
                  {t('sendPathToTerminal')}
                </ContextMenuItem>
              )}
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => setPropertiesFile(selectedFile)}>
                <Info className="h-4 w-4" />
                {t('properties')}
                <span className="ml-auto">...</span>
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={!!propertiesFile} onOpenChange={(open) => !open && setPropertiesFile(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('properties')}</DialogTitle>
          </DialogHeader>
          {propertiesFile && (
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <span className="text-muted-foreground">{t('name')}</span>
              <span className="min-w-0 break-all font-medium">{propertiesFile.name}</span>
              <span className="text-muted-foreground">{t('path')}</span>
              <span className="min-w-0 break-all font-mono text-xs">{joinPath(path, propertiesFile.name)}</span>
              <span className="text-muted-foreground">{t('type')}</span>
              <span>{propertiesFile.type === 'dir' ? t('folder') : t('file')}</span>
              <span className="text-muted-foreground">{t('size')}</span>
              <span>{propertiesFile.type === 'dir' ? '-' : formatSize(propertiesFile.size)}</span>
              <span className="text-muted-foreground">{t('modified')}</span>
              <span>{propertiesFile.modified || '-'}</span>
              <span className="text-muted-foreground">{t('permissions')}</span>
              <span className="font-mono text-xs">{propertiesFile.permissions || '-'}</span>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPropertiesFile(null)}>{t('close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {tasks.length > 0 && (
        <div className="max-h-40 space-y-1 overflow-auto border-t border-border px-4 py-2 text-xs">
          <div className="flex items-center justify-between pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>{history.length > 0 ? t('transferHistory', { count: history.length }) : t('transfers')}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              title={paused ? t('resumeTransfers') : t('pauseTransfers')}
              onClick={paused ? resume : pause}
            >
              {paused ? <Play className="h-3.5 w-3.5" /> : <span className="text-[10px]">II</span>}
            </Button>
          </div>
          {tasks.map((task) => {
            const running = task.status === 'running' || task.status === 'cancelling'
            const percent = task.total > 0 ? Math.min(100, Math.floor((task.transferred / task.total) * 100)) : 0
            return (
              <div key={task.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{task.label}</span>
                <span className="text-muted-foreground">{task.status}</span>
                {task.total > 0 && <span className="tabular-nums">{percent}%</span>}
                {running && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    title={t('cancelTransfer')}
                    onClick={() => void onCancelTask(task.id)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
                {task.status === 'failed' && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    title={t('retry')}
                    onClick={() => void onRetryTask(task.id)}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Status bar */}
      <div className="flex items-center gap-2 border-t border-border px-4 py-2 text-xs text-muted-foreground">
        {selected ? (
          <span>
            {t('selected')} <span className="text-foreground">{selected}</span>
          </span>
        ) : (
          <span>{t('fileHint')}</span>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('remove')}
        description={deleteTarget ? t('confirmDelete', { name: deleteTarget.name }) : null}
        destructive
        confirmText={t('delete')}
        onConfirm={() => void onConfirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* Prompt dialog for mkdir / rename */}
      <Dialog open={!!promptDialog} onOpenChange={(open) => { if (!open) setPromptDialog(null) }}>
        <DialogContent className="min-w-0 sm:max-w-sm">
          <DialogHeader className="min-w-0">
            <DialogTitle className="min-w-0 break-words [overflow-wrap:anywhere]">{promptDialog?.title}</DialogTitle>
          </DialogHeader>
          <div className="min-w-0 flex flex-col gap-2">
            <label className="min-w-0 break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">{promptDialog?.label}</label>
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
