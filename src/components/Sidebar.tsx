import { useMemo, useState, type KeyboardEvent } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Folder,
  FolderPlus,
  Pencil,
  Plus,
  Search,
  Server as ServerIcon,
  Terminal,
  Trash2,
  X,
} from 'lucide-react'
import type { Server, ServerGroup } from '@/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

interface SidebarProps {
  groups: ServerGroup[]
  servers: Server[]
  activeServerId?: string
  onSelect: (server: Server) => void
  onAddServer: () => void
  onEditServer: (server: Server) => void
  onAddGroup: (name: string) => void
  onRenameGroup: (id: string, name: string) => void
  onDeleteGroup: (id: string) => void
}

export function Sidebar({
  groups,
  servers,
  activeServerId,
  onSelect,
  onAddServer,
  onEditServer,
  onAddGroup,
  onRenameGroup,
  onDeleteGroup,
}: SidebarProps) {
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  const startEdit = (group: ServerGroup) => {
    setEditingId(group.id)
    setEditValue(group.name)
  }

  const commitEdit = () => {
    if (editingId) onRenameGroup(editingId, editValue)
    setEditingId(null)
    setEditValue('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditValue('')
  }

  const commitAdd = () => {
    onAddGroup(newName)
    setNewName('')
    setAdding(false)
  }

  const cancelAdd = () => {
    setNewName('')
    setAdding(false)
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return servers
    return servers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.host.toLowerCase().includes(q) ||
        s.username.toLowerCase().includes(q),
    )
  }, [servers, query])

  const toggle = (id: string) =>
    setCollapsed((c) => ({ ...c, [id]: !c[id] }))

  return (
    <aside className="flex h-full w-72 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      {/* Brand */}
      <div className="flex items-center gap-2 px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
          <Terminal className="h-4 w-4 text-primary-foreground" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold">Ferric SSH</div>
          <div className="text-xs text-muted-foreground">Rust · Tauri Client</div>
        </div>
      </div>

      {/* Search */}
      <div className="px-3 pb-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索服务器..."
            className="pl-8"
          />
        </div>
      </div>

      {/* Groups header */}
      <div className="flex items-center justify-between px-4 pb-1">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          分组
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          title="新建分组"
          onClick={() => setAdding(true)}
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Groups + servers */}
      <div className="flex-1 overflow-y-auto px-2">
        {adding && (
          <div className="mb-1 flex items-center gap-1 px-1">
            <Folder className="h-3.5 w-3.5 text-muted-foreground" />
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e: KeyboardEvent) => {
                if (e.key === 'Enter') commitAdd()
                if (e.key === 'Escape') cancelAdd()
              }}
              placeholder="分组名称"
              className="h-7 flex-1 text-sm"
            />
            <Button variant="ghost" size="icon-xs" title="确认" onClick={commitAdd}>
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon-xs" title="取消" onClick={cancelAdd}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {groups.map((group) => {
          const groupServers = filtered.filter((s) => s.groupId === group.id)
          // Hide empty groups only while actively searching.
          if (groupServers.length === 0 && query.trim()) return null
          const isCollapsed = collapsed[group.id]
          const isEditing = editingId === group.id
          return (
            <div key={group.id} className="group/header mb-1">
              <div className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground">
                {isEditing ? (
                  <>
                    <Folder className="h-3.5 w-3.5 shrink-0" />
                    <Input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e: KeyboardEvent) => {
                        if (e.key === 'Enter') commitEdit()
                        if (e.key === 'Escape') cancelEdit()
                      }}
                      className="h-6 flex-1 text-xs"
                    />
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => toggle(group.id)}
                      className="flex min-w-0 flex-1 items-center gap-1.5"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <Folder className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate uppercase tracking-wide">
                        {group.name}
                      </span>
                    </button>
                    <div className="ml-auto flex items-center gap-0.5">
                      <button
                        title="重命名"
                        onClick={() => startEdit(group)}
                        className="hidden rounded p-0.5 hover:text-foreground group-hover/header:block"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      {groups.length > 1 && (
                        <button
                          title="删除分组"
                          onClick={() => onDeleteGroup(group.id)}
                          className="hidden rounded p-0.5 hover:text-destructive group-hover/header:block"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                      <Badge variant="secondary">{groupServers.length}</Badge>
                    </div>
                  </>
                )}
              </div>

              {!isCollapsed && !isEditing && (
                <div className="mt-0.5 space-y-0.5">
                  {groupServers.map((server) => (
                    <ServerRow
                      key={server.id}
                      server={server}
                      active={server.id === activeServerId}
                      onClick={() => onSelect(server)}
                      onDoubleClick={() => onEditServer(server)}
                    />
                  ))}
                  {groupServers.length === 0 && (
                    <div className="px-2 py-1.5 pl-7 text-xs text-muted-foreground/60">
                      暂无服务器
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Add button */}
      <div className="border-t border-sidebar-border p-3">
        <Button onClick={onAddServer} className="w-full">
          <Plus className="h-4 w-4" />
          添加服务器
        </Button>
      </div>
    </aside>
  )
}

function ServerRow({
  server,
  active,
  onClick,
  onDoubleClick,
}: {
  server: Server
  active: boolean
  onClick: () => void
  onDoubleClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title="单击选择 · 双击编辑"
      className={cn(
        'group flex w-full items-center gap-2 rounded-md px-2 py-2 pl-7 text-left transition-colors',
        active
          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
          : 'hover:bg-sidebar-accent/60',
      )}
    >
      <ServerIcon
        className="h-4 w-4 shrink-0"
        style={{ color: server.color }}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{server.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {server.username}@{server.host}
        </div>
      </div>
      {server.lastConnected && (
        <Circle className="h-2 w-2 shrink-0 fill-green-500 text-green-500 opacity-0 group-hover:opacity-100" />
      )}
    </button>
  )
}
