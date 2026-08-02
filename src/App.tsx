import { useCallback, useMemo, useState } from 'react'
import { useAppConfig } from '@/hooks/useAppConfig'
import { Sidebar } from '@/components/Sidebar'
import { MainPanel } from '@/components/MainPanel'
import { ServerFormModal } from '@/components/ServerFormModal'
import { deleteServerSecret } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { ConnectionStatus, Server, ServerGroup } from '@/types'

function App() {
  const { config, updateConfig, isLoading: configLoading, error: configError } = useAppConfig()
  const servers = config?.servers ?? []
  const groups = config?.groups ?? []
  const updateServers = useCallback((update: (servers: Server[]) => Server[]) => {
    updateConfig((current) => ({ ...current, servers: update(current.servers) }))
  }, [updateConfig])
  const updateGroups = useCallback((update: (groups: ServerGroup[]) => ServerGroup[]) => {
    updateConfig((current) => ({ ...current, groups: update(current.groups) }))
  }, [updateConfig])
  const [activeId, setActiveId] = useState<string | undefined>(undefined)
  // Servers that have been opened at least once. Each keeps a persistent,
  // independently-connected MainPanel so switching tabs never disconnects.
  const [openIds, setOpenIds] = useState<string[]>([])
  // Live connection status per server, reported by each MainPanel.
  const [statuses, setStatuses] = useState<Record<string, ConnectionStatus>>(
    {},
  )
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Server | null>(null)


  const handleStatusChange = useCallback(
    (id: string, status: ConnectionStatus) => {
      setStatuses((prev) => (prev[id] === status ? prev : { ...prev, [id]: status }))
    },
    [],
  )

  const connectedIds = useMemo(
    () =>
      new Set(
        Object.entries(statuses)
          .filter(([, s]) => s === 'connected')
          .map(([id]) => id),
      ),
    [statuses],
  )

  // Resolve open ids to live server objects, preserving open order.
  const openServers = useMemo(
    () =>
      openIds
        .map((id) => config?.servers.find((s) => s.id === id))
        .filter((s): s is Server => Boolean(s)),
    [config?.servers, openIds],
  )

  const selectServer = (server: Server) => {
    setOpenIds((prev) =>
      prev.includes(server.id) ? prev : [...prev, server.id],
    )
    setActiveId(server.id)
  }

  const openAdd = () => {
    setEditing(null)
    setModalOpen(true)
  }

  const openEdit = (server: Server) => {
    setEditing(server)
    setModalOpen(true)
  }

  const saveServer = (server: Server) => {
    updateServers((prev) => {
      const exists = prev.some((s) => s.id === server.id)
      return exists
        ? prev.map((s) => (s.id === server.id ? server : s))
        : [...prev, server]
    })
    setOpenIds((prev) =>
      prev.includes(server.id) ? prev : [...prev, server.id],
    )
    setActiveId(server.id)
    setModalOpen(false)
  }

  const addGroup = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    updateGroups((prev) => [...prev, { id: `g-${Date.now()}`, name: trimmed }])
  }

  const renameGroup = (id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    updateGroups((prev) =>
      prev.map((g) => (g.id === id ? { ...g, name: trimmed } : g)),
    )
  }

  const deleteGroup = (id: string) => {
    updateGroups((prev) => {
      if (prev.length <= 1) return prev // keep at least one group
      return prev.filter((g) => g.id !== id)
    })
    // Reassign servers from the removed group to the first remaining one.
    updateServers((prev) => {
      const remaining = groups.filter((g) => g.id !== id)
      if (remaining.length === 0) return prev
      const fallback = remaining[0].id
      return prev.map((s) =>
        s.groupId === id ? { ...s, groupId: fallback } : s,
      )
    })
  }

  const reorderGroup = (
    draggingId: string,
    targetId: string,
    before: boolean,
  ) => {
    if (draggingId === targetId) return
    updateGroups((prev) => {
      const dragging = prev.find((g) => g.id === draggingId)
      if (!dragging) return prev
      const without = prev.filter((g) => g.id !== draggingId)
      const targetIndex = without.findIndex((g) => g.id === targetId)
      if (targetIndex === -1) return prev
      const insertIndex = before ? targetIndex : targetIndex + 1
      const next = [...without]
      next.splice(insertIndex, 0, dragging)
      return next
    })
  }

  const moveServer = (serverId: string, groupId: string) => {
    updateServers((prev) =>
      prev.map((s) => (s.id === serverId ? { ...s, groupId } : s)),
    )
  }

  const reorderServer = (
    draggingId: string,
    targetId: string,
    before: boolean,
  ) => {
    if (draggingId === targetId) return
    updateServers((prev) => {
      const dragging = prev.find((s) => s.id === draggingId)
      const target = prev.find((s) => s.id === targetId)
      if (!dragging || !target) return prev
      // Dropping onto a server also adopts that server's group.
      const moved = { ...dragging, groupId: target.groupId }
      const without = prev.filter((s) => s.id !== draggingId)
      const targetIndex = without.findIndex((s) => s.id === targetId)
      const insertIndex = before ? targetIndex : targetIndex + 1
      const next = [...without]
      next.splice(insertIndex, 0, moved)
      return next
    })
  }

  const deleteServer = (serverId: string) => {
    updateServers((prev) => prev.filter((s) => s.id !== serverId))
    setOpenIds((prev) => prev.filter((id) => id !== serverId))
    // If the deleted server was active, fall back to another open tab.
    setActiveId((cur) => {
      if (cur !== serverId) return cur
      const remaining = openIds.filter((id) => id !== serverId)
      return remaining[remaining.length - 1]
    })
    // Clean up any stored password/passphrase from the OS keychain.
    void deleteServerSecret(serverId).catch((e) =>
      console.error('删除凭据失败', e),
    )
  }

  if (configLoading && !config) {
    return <div className="flex h-screen items-center justify-center">Loading...</div>
  }

  if (configError && !config) {
    return <div className="flex h-screen items-center justify-center text-destructive">Failed to load configuration.</div>
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar
        groups={groups}
        servers={servers}
        activeServerId={activeId}
        connectedIds={connectedIds}
        onSelect={selectServer}
        onAddServer={openAdd}
        onEditServer={openEdit}
        onAddGroup={addGroup}
        onRenameGroup={renameGroup}
        onDeleteGroup={deleteGroup}
        onReorderGroup={reorderGroup}
        onMoveServer={moveServer}
        onReorderServer={reorderServer}
        onDeleteServer={deleteServer}
      />

      <main className="relative min-w-0 flex-1">
        {openServers.length === 0 ? (
          <MainPanel server={undefined} onEdit={() => {}} />
        ) : (
          openServers.map((s) => (
            <div
              key={s.id}
              className={cn(
                'absolute inset-0',
                s.id === activeId ? 'block' : 'hidden',
              )}
            >
              <MainPanel
                server={s}
                onEdit={() => openEdit(s)}
                onStatusChange={handleStatusChange}
              />
            </div>
          ))
        )}
      </main>

      <ServerFormModal
        open={modalOpen}
        groups={groups}
        initial={editing}
        onClose={() => setModalOpen(false)}
        onSave={saveServer}
      />
    </div>
  )
}

export default App
