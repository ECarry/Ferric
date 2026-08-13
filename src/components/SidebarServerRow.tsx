import type { DragEvent } from 'react'
import {
  Cable,
  Circle,
  Pencil,
  Plug,
  Server as ServerIcon,
  Trash2,
} from 'lucide-react'
import type { Server } from '@/types'
import { cn } from '@/lib/utils'
import { useI18n } from '@/i18n'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

interface SidebarServerRowProps {
  server: Server
  active: boolean
  connected: boolean
  dragging: boolean
  onClick: () => void
  onDoubleClick: () => void
  onEdit: () => void
  onDelete: () => void
  onDragStart: () => void
  onDragEnd: () => void
}

export function SidebarServerRow({
  server,
  active,
  connected,
  dragging,
  onClick,
  onDoubleClick,
  onEdit,
  onDelete,
  onDragStart,
  onDragEnd,
}: SidebarServerRowProps) {
  const { t } = useI18n()
  const ProtocolIcon = server.protocol === 'serial'
    ? Cable
    : server.protocol === 'telnet'
      ? Plug
      : ServerIcon

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <button
            draggable
            onDragStart={(e: DragEvent) => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', server.id)
              onDragStart()
            }}
            onDragEnd={onDragEnd}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            title={t('serverHint')}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 pl-7 text-left transition-all',
              dragging && 'opacity-50',
              active
                ? 'bg-primary/10 text-foreground shadow-sm'
                : 'hover:bg-muted/60 text-sidebar-foreground/80',
            )}
          />
        }
      >
        <ProtocolIcon
          className="h-4 w-4 shrink-0"
          style={{ color: server.color }}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{server.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {server.protocol === 'serial' ? server.host : `${server.username}@${server.host}`}
          </div>
        </div>
        {connected && (
          <Circle className="h-2 w-2 shrink-0 fill-green-500 text-green-500" />
        )}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onEdit}>
          <Pencil className="h-4 w-4" />
          {t('edit')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
          {t('delete')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
