import {
  useMemo,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  Pencil,
  Plus,
  Search,
  Terminal,
  Trash2,
  X,
  Settings,
} from 'lucide-react'
import type { Server, ServerGroup } from '@/types'
import { cn } from '@/lib/utils'
import { groupDisplayName } from '@/lib/groups'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { HelpDialog } from '@/components/HelpDialog'
import { SettingsDialog } from '@/components/SettingsDialog'
import { SidebarServerRow } from '@/components/SidebarServerRow'

interface SidebarProps {
  mobileOpen?: boolean
  onCloseMobile?: () => void
  groups: ServerGroup[]
  servers: Server[]
  activeServerId?: string
  connectedIds: Set<string>
  onSelect: (server: Server) => void
  onAddServer: () => void
  onEditServer: (server: Server) => void
  onAddGroup: (name: string) => void
  onRenameGroup: (id: string, name: string) => void
  onDeleteGroup: (id: string) => void
  onReorderGroup: (draggingId: string, targetId: string, before: boolean) => void
  onMoveServer: (serverId: string, groupId: string) => void
  onReorderServer: (draggingId: string, targetId: string, before: boolean) => void
  onDeleteServer: (serverId: string) => void
}

export function Sidebar({
  mobileOpen = false,
  onCloseMobile,
  groups,
  servers,
  activeServerId,
  connectedIds,
  onSelect,
  onAddServer,
  onEditServer,
  onAddGroup,
  onRenameGroup,
  onDeleteGroup,
  onReorderGroup,
  onMoveServer,
  onReorderServer,
  onDeleteServer,
}: SidebarProps) {
  const { language, setLanguage, t } = useI18n()
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropGroupId, setDropGroupId] = useState<string | null>(null)
  const [dropRow, setDropRow] = useState<{ id: string; before: boolean } | null>(
    null,
  )
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null)
  const [dropGroupRow, setDropGroupRow] = useState<{
    id: string
    before: boolean
  } | null>(null)
  const [confirm, setConfirm] = useState<
    { kind: 'server' | 'group'; id: string; name: string } | null
  >(null)
  const [settingsOpen, setSettingsOpen] = useState(false)

  const doConfirmDelete = () => {
    if (!confirm) return
    if (confirm.kind === 'server') onDeleteServer(confirm.id)
    else onDeleteGroup(confirm.id)
    setConfirm(null)
  }

  const startEdit = (group: ServerGroup) => {
    setEditingId(group.id)
    setEditValue(groupDisplayName(group, t))
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

  const handleDrop = (groupId: string) => {
    if (draggingId) {
      const server = servers.find((s) => s.id === draggingId)
      if (server && server.groupId !== groupId) onMoveServer(draggingId, groupId)
    }
    setDraggingId(null)
    setDropGroupId(null)
    setDropRow(null)
  }

  const rowDropSide = (e: DragEvent) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return e.clientY < rect.top + rect.height / 2
  }

  const handleRowDragOver = (e: DragEvent, serverId: string) => {
    if (!draggingId || draggingId === serverId) return
    e.preventDefault()
    e.stopPropagation()
    setDropRow({ id: serverId, before: rowDropSide(e) })
    setDropGroupId(null)
  }

  const handleRowDrop = (e: DragEvent, serverId: string) => {
    if (!draggingId) return
    e.preventDefault()
    e.stopPropagation()
    onReorderServer(draggingId, serverId, rowDropSide(e))
    setDraggingId(null)
    setDropRow(null)
    setDropGroupId(null)
  }

  const handleGroupDragOver = (e: DragEvent, groupId: string) => {
    if (draggingGroupId && draggingGroupId !== groupId) {
      e.preventDefault()
      setDropGroupRow({ id: groupId, before: rowDropSide(e) })
    } else if (draggingId) {
      e.preventDefault()
      setDropGroupId(groupId)
      setDropRow(null)
    }
  }

  const handleGroupDrop = (e: DragEvent, groupId: string) => {
    e.preventDefault()
    if (draggingGroupId) {
      if (draggingGroupId !== groupId)
        onReorderGroup(draggingGroupId, groupId, rowDropSide(e))
    } else {
      handleDrop(groupId)
    }
    setDraggingGroupId(null)
    setDropGroupRow(null)
  }

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex h-full w-72 shrink-0 -translate-x-full flex-col border-r border-sidebar-border/60 bg-gradient-to-b from-sidebar to-background text-sidebar-foreground shadow-xl transition-transform duration-200 md:static md:z-auto md:w-64 md:translate-x-0 md:shadow-none lg:w-72',
        mobileOpen && 'translate-x-0',
      )}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 border-b border-sidebar-border/60 px-4 py-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <Terminal className="h-5 w-5" />
        </div>
        <div className="text-base font-semibold tracking-tight">Ferric</div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('closeSidebar')}
          onClick={onCloseMobile}
          className="ml-auto md:hidden"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Search */}
      <div className="px-3 pb-3 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('searchServers')}
            aria-label={t('searchServers')}
            className="h-9 rounded-full border-0 bg-muted pr-9 pl-9 text-sm shadow-inner ring-1 ring-transparent transition focus:bg-background focus:ring-2 focus:ring-primary/20"
          />
          {query && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t('clearSearch')}
              onClick={() => setQuery('')}
              className="absolute top-1/2 right-1 h-7 w-7 -translate-y-1/2 rounded-full"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Add button */}
      <div className="p-3">
        <Button onClick={onAddServer} className="w-full rounded-full shadow-sm">
          <Plus className="h-4 w-4" />
          {t('addServer')}
        </Button>
      </div>

      {/* Groups header */}
      <div className="flex items-center justify-between px-3 pb-2 pt-1">
        <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
          {t('groups')}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          title={t('newGroup')}
          onClick={() => setAdding(true)}
          className="h-6 w-6 rounded-md hover:bg-muted/60"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Groups + servers */}
      <div className="flex-1 overflow-y-auto px-2">
        {query.trim() && (
          <div className="px-2 pb-2 text-xs text-muted-foreground" role="status">
            {t('searchResults', { count: filtered.length })}
          </div>
        )}
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
              placeholder={t('groupName')}
              className="h-7 flex-1 text-sm"
            />
            <Button variant="ghost" size="icon-xs" title={t('confirm')} onClick={commitAdd}>
              <Check className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon-xs" title={t('cancel')} onClick={cancelAdd}>
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
          const isDropTarget = dropGroupId === group.id
          const showGroupBefore =
            dropGroupRow?.id === group.id && dropGroupRow.before
          const showGroupAfter =
            dropGroupRow?.id === group.id && !dropGroupRow.before
          return (
            <div
              key={group.id}
              className={cn(
                'group/header relative mb-1.5 rounded-lg',
                isDropTarget && 'ring-2 ring-primary/60 ring-inset',
              )}
              onDragOver={(e: DragEvent) => handleGroupDragOver(e, group.id)}
              onDragLeave={(e: DragEvent) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return
                setDropGroupId((cur) => (cur === group.id ? null : cur))
                setDropGroupRow((cur) => (cur?.id === group.id ? null : cur))
              }}
              onDrop={(e: DragEvent) => handleGroupDrop(e, group.id)}
            >
              {showGroupBefore && (
                <div className="pointer-events-none absolute inset-x-1 -top-0.5 z-10 h-0.5 rounded bg-primary" />
              )}
              <div
                draggable={!isEditing}
                onDragStart={(e: DragEvent) => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', group.id)
                  setDraggingGroupId(group.id)
                }}
                onDragEnd={() => {
                  setDraggingGroupId(null)
                  setDropGroupRow(null)
                }}
                className={cn(
                  'flex w-full items-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium text-muted-foreground/80 transition-colors hover:bg-primary/10 hover:text-foreground',
                  !isEditing && 'cursor-grab active:cursor-grabbing',
                  draggingGroupId === group.id && 'opacity-50',
                )}
              >
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
                      type="button"
                      onClick={() => toggle(group.id)}
                      aria-expanded={!isCollapsed}
                      className="flex min-w-0 flex-1 items-center gap-1.5"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <Folder className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate uppercase tracking-wider">
                        {groupDisplayName(group, t)}
                      </span>
                    </button>
                    <div className="ml-auto flex items-center gap-0.5">
                      <button
                        title={t('rename')}
                        onClick={() => startEdit(group)}
                        className="hidden rounded p-0.5 hover:text-foreground group-hover/header:block"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      {groups.length > 1 && (
                        <button
                          title={t('deleteGroup')}
                          onClick={() =>
                            setConfirm({
                              kind: 'group',
                              id: group.id,
                              name: groupDisplayName(group, t),
                            })
                          }
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
                  {groupServers.map((server) => {
                    const showBefore =
                      dropRow?.id === server.id && dropRow.before
                    const showAfter =
                      dropRow?.id === server.id && !dropRow.before
                    return (
                      <div
                        key={server.id}
                        className="relative"
                        onDragOver={(e: DragEvent) =>
                          handleRowDragOver(e, server.id)
                        }
                        onDrop={(e: DragEvent) => handleRowDrop(e, server.id)}
                      >
                        {showBefore && (
                          <div className="pointer-events-none absolute inset-x-2 -top-px z-10 h-0.5 rounded bg-primary" />
                        )}
                        <SidebarServerRow
                          server={server}
                          active={server.id === activeServerId}
                          connected={connectedIds.has(server.id)}
                          dragging={server.id === draggingId}
                          onClick={() => onSelect(server)}
                          onDoubleClick={() => onEditServer(server)}
                          onEdit={() => onEditServer(server)}
                          onDelete={() =>
                            setConfirm({
                              kind: 'server',
                              id: server.id,
                              name: server.name,
                            })
                          }
                          onDragStart={() => setDraggingId(server.id)}
                          onDragEnd={() => {
                            setDraggingId(null)
                            setDropGroupId(null)
                            setDropRow(null)
                          }}
                        />
                        {showAfter && (
                          <div className="pointer-events-none absolute inset-x-2 -bottom-px z-10 h-0.5 rounded bg-primary" />
                        )}
                      </div>
                    )
                  })}
                  {groupServers.length === 0 && (
                    <div className="px-2 py-1.5 pl-7 text-xs text-muted-foreground/60">
                      {t('noServers')}
                    </div>
                  )}
                </div>
              )}
              {showGroupAfter && (
                <div className="pointer-events-none absolute inset-x-1 -bottom-0.5 z-10 h-0.5 rounded bg-primary" />
              )}
            </div>
          )
        })}
        {query.trim() && filtered.length === 0 && (
          <div className="px-2 py-8 text-center text-sm text-muted-foreground">
            <p>{t('noSearchResults')}</p>
            <Button type="button" variant="link" size="sm" onClick={() => setQuery('')}>
              {t('clearSearch')}
            </Button>
          </div>
        )}
      </div>

      {/* Bottom toolbar */}
      <div className="border-t border-sidebar-border/60 p-3">
        <div className="flex items-center justify-between">
          <Select value={language} onValueChange={(value) => setLanguage(value as 'en' | 'zh-CN')}>
            <SelectTrigger size="sm" className="h-8 w-24 border-0 bg-transparent text-xs" aria-label={t('language')}>
              <SelectValue>{(value) => (value === 'zh-CN' ? '中文' : 'EN')}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="en" className='text-xs'>EN</SelectItem>
              <SelectItem value="zh-CN" className='text-xs'>中文</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-0.5">
            <HelpDialog />
            <Button
              variant="ghost"
              size="icon"
              className="relative h-8 w-8"
              aria-label={t('terminalSettings')}
              onClick={() => setSettingsOpen(true)}
            >
              <Settings className="h-5 w-5" />
            </Button>
            <SettingsDialog key={settingsOpen ? 'open' : 'closed'} open={settingsOpen} onOpenChange={setSettingsOpen} />
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirm}
        destructive
        title={confirm?.kind === 'group' ? t('deleteGroup') : t('deleteServerTitle')}
        confirmText={t('delete')}
        description={
          confirm
            ? t(
                confirm.kind === 'group'
                  ? 'deleteGroupConfirm'
                  : 'deleteServerConfirm',
                { name: confirm.name },
              )
            : null
        }
        onConfirm={doConfirmDelete}
        onCancel={() => setConfirm(null)}
      />
    </aside>
  )
}
