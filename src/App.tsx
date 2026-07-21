import { useEffect, useMemo, useRef, useState } from 'react'
import { Sidebar } from '@/components/Sidebar'
import { MainPanel } from '@/components/MainPanel'
import { ServerFormModal } from '@/components/ServerFormModal'
import { loadConfig, saveConfig } from '@/lib/store'
import { cn } from '@/lib/utils'
import type { Server, ServerGroup } from '@/types'

function App() {
  const [servers, setServers] = useState<Server[]>([])
  const [groups, setGroups] = useState<ServerGroup[]>([])
  const [loaded, setLoaded] = useState(false)
  const [activeId, setActiveId] = useState<string | undefined>(undefined)
  // Servers that have been opened at least once. Each keeps a persistent,
  // independently-connected MainPanel so switching tabs never disconnects.
  const [openIds, setOpenIds] = useState<string[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Server | null>(null)

  // Load persisted config on startup.
  useEffect(() => {
    loadConfig()
      .then((cfg) => {
        setServers(cfg.servers)
        setGroups(cfg.groups)
      })
      .catch((err) => console.error('加载配置失败', err))
      .finally(() => setLoaded(true))
  }, [])

  // Persist whenever servers or groups change (after the initial load).
  const skipSave = useRef(true)
  useEffect(() => {
    if (!loaded) return
    if (skipSave.current) {
      skipSave.current = false
      return
    }
    saveConfig({ servers, groups }).catch((err) =>
      console.error('保存配置失败', err),
    )
  }, [servers, groups, loaded])

  // Resolve open ids to live server objects, preserving open order.
  const openServers = useMemo(
    () =>
      openIds
        .map((id) => servers.find((s) => s.id === id))
        .filter((s): s is Server => Boolean(s)),
    [openIds, servers],
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
    setServers((prev) => {
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
    setGroups((prev) => [...prev, { id: `g-${Date.now()}`, name: trimmed }])
  }

  const renameGroup = (id: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setGroups((prev) =>
      prev.map((g) => (g.id === id ? { ...g, name: trimmed } : g)),
    )
  }

  const deleteGroup = (id: string) => {
    setGroups((prev) => {
      if (prev.length <= 1) return prev // keep at least one group
      const remaining = prev.filter((g) => g.id !== id)
      const fallback = remaining[0].id
      // Reassign servers from the removed group to the first remaining one.
      setServers((servers) =>
        servers.map((s) => (s.groupId === id ? { ...s, groupId: fallback } : s)),
      )
      return remaining
    })
  }

  const reorderGroup = (
    draggingId: string,
    targetId: string,
    before: boolean,
  ) => {
    if (draggingId === targetId) return
    setGroups((prev) => {
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
    setServers((prev) =>
      prev.map((s) => (s.id === serverId ? { ...s, groupId } : s)),
    )
  }

  const reorderServer = (
    draggingId: string,
    targetId: string,
    before: boolean,
  ) => {
    if (draggingId === targetId) return
    setServers((prev) => {
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
    setServers((prev) => prev.filter((s) => s.id !== serverId))
    setOpenIds((prev) => {
      const next = prev.filter((id) => id !== serverId)
      // If the deleted server was active, fall back to another open tab.
      setActiveId((cur) => (cur === serverId ? next[next.length - 1] : cur))
      return next
    })
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar
        groups={groups}
        servers={servers}
        activeServerId={activeId}
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
              <MainPanel server={s} onEdit={() => openEdit(s)} />
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
