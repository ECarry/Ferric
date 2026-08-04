import type { RemoteFile } from '@/types'
import { File as FileIcon, FolderClosed, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatSize } from '@/lib/file-utils'
import { useI18n } from '@/i18n'

interface FileTableProps {
  files: RemoteFile[]
  selected: string | null
  loading: boolean
  dragActive: boolean
  visibleError: string | null
  onSelect: (name: string) => void
  onOpenFile: (file: RemoteFile) => void
}

export function FileBrowserTable({
  files,
  selected,
  loading,
  dragActive,
  visibleError,
  onSelect,
  onOpenFile,
}: FileTableProps) {
  const { t } = useI18n()

  return (
    <>
      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-primary/10 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-primary/50 bg-background/80 px-8 py-6">
            <Upload className="h-8 w-8 text-primary" />
            <p className="text-sm font-medium text-primary">{t('dragDropHint')}</p>
          </div>
        </div>
      )}
      {visibleError && <div className="px-4 py-3 font-mono text-xs text-destructive">{visibleError}</div>}
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
              onClick={() => onSelect(file.name)}
              onDoubleClick={() => onOpenFile(file)}
              onContextMenu={() => onSelect(file.name)}
              className={cn(
                'cursor-default border-b border-border/50 transition-colors',
                selected === file.name ? 'bg-accent' : 'hover:bg-muted',
              )}
            >
              <td className="flex items-center gap-2 px-4 py-2">
                {file.type === 'dir' ? <FolderClosed className="h-4 w-4 text-primary" /> : <FileIcon className="h-4 w-4 text-muted-foreground" />}
                <span>{file.name}</span>
              </td>
              <td className="px-4 py-2 text-right text-muted-foreground">{file.type === 'dir' ? '-' : formatSize(file.size)}</td>
              <td className="px-4 py-2 text-muted-foreground">{file.modified || '-'}</td>
              <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{file.permissions}</td>
            </tr>
          ))}
          {!loading && files.length === 0 && !visibleError && (
            <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-muted-foreground">{t('emptyDirectory')}</td></tr>
          )}
        </tbody>
      </table>
    </>
  )
}
