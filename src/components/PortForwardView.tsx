import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Square, Trash2, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { formatAppError } from '@/lib/error'
import { useI18n } from '@/i18n'
import {
  onForwardEvent,
  sshForwardStart,
  sshForwardStop,
  type ForwardEvent,
  type SshConnectConfig,
} from '@/lib/ssh'

interface PortForwardViewProps {
  sshConfig: SshConnectConfig
}

interface Tunnel {
  id: string
  localPort: number
  remoteHost: string
  remotePort: number
  status: 'starting' | 'active' | 'error' | 'stopped'
  message?: string
}

export function PortForwardView({ sshConfig }: PortForwardViewProps) {
  const { t } = useI18n()
  const [tunnels, setTunnels] = useState<Tunnel[]>([])
  const [form, setForm] = useState({
    localPort: '',
    remoteHost: '127.0.0.1',
    remotePort: '',
  })
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addTunnel = useCallback((t: Tunnel) => {
    setTunnels((prev) => [...prev, t])
  }, [])

  const updateTunnel = useCallback((id: string, patch: Partial<Tunnel>) => {
    setTunnels((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  const removeTunnel = useCallback((id: string) => {
    setTunnels((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const handleStart = async () => {
    const localPort = Number(form.localPort)
    const remotePort = Number(form.remotePort)
    if (!localPort || !remotePort || !form.remoteHost.trim()) {
      setError(t('forwardInvalid'))
      return
    }
    setStarting(true)
    setError(null)
    try {
      const id = await sshForwardStart({
        config: sshConfig,
        localPort,
        remoteHost: form.remoteHost.trim(),
        remotePort,
      })
      addTunnel({
        id,
        localPort,
        remoteHost: form.remoteHost.trim(),
        remotePort,
        status: 'active',
      })
      setForm({ localPort: '', remoteHost: '127.0.0.1', remotePort: '' })
    } catch (e) {
      setError(formatAppError(e, t))
    } finally {
      setStarting(false)
    }
  }

  const handleStop = async (id: string) => {
    try {
      await sshForwardStop(id)
      updateTunnel(id, { status: 'stopped' })
    } catch (e) {
      setError(formatAppError(e, t))
    }
  }

  // Listen for forward events on all active tunnels.
  useEffect(() => {
    const unlistenPromises = tunnels.map((t) =>
      onForwardEvent(t.id, (event: ForwardEvent) => {
        switch (event.event) {
          case 'started':
            updateTunnel(t.id, { status: 'active', message: event.message })
            break
          case 'stopped':
            updateTunnel(t.id, { status: 'stopped', message: event.message })
            break
          case 'error':
            updateTunnel(t.id, { status: 'error', message: event.message })
            break
          default:
            break
        }
      }),
    )
    let disposed = false
    let unlistenFns: (() => void)[] = []
    Promise.all(unlistenPromises).then((fns) => {
      if (disposed) {
        fns.forEach((fn) => fn())
      } else {
        unlistenFns = fns
      }
    })
    return () => {
      disposed = true
      unlistenFns.forEach((fn) => fn())
    }
  }, [tunnels, updateTunnel])

  return (
    <div className="flex h-full flex-col">
      {/* Form */}
      <div className="border-b border-border p-4">
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{t('localPort')}</label>
            <Input
              type="number"
              min={1}
              max={65535}
              value={form.localPort}
              onChange={(e) => setForm((f) => ({ ...f, localPort: e.target.value }))}
              placeholder="8080"
              className="h-9 w-24"
            />
          </div>
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-xs text-muted-foreground">{t('remoteHost')}</label>
            <Input
              value={form.remoteHost}
              onChange={(e) => setForm((f) => ({ ...f, remoteHost: e.target.value }))}
              placeholder="127.0.0.1"
              className="h-9"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{t('remotePort')}</label>
            <Input
              type="number"
              min={1}
              max={65535}
              value={form.remotePort}
              onChange={(e) => setForm((f) => ({ ...f, remotePort: e.target.value }))}
              placeholder="80"
              className="h-9 w-24"
            />
          </div>
          <Button onClick={handleStart} disabled={starting}>
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t('addForward')}
          </Button>
        </div>
        {error && <p className="mt-2 font-mono text-xs text-destructive">{error}</p>}
      </div>

      {/* Tunnel list */}
      <div className="flex-1 overflow-auto">
        {tunnels.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
              <Zap className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">{t('noTunnels')}</p>
            <p className="max-w-sm text-xs text-muted-foreground/70">{t('forwardHint')}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-4 py-2 text-left font-medium">{t('localAddr')}</th>
                <th className="px-4 py-2 text-left font-medium">{t('remoteAddr')}</th>
                <th className="px-4 py-2 text-left font-medium">{t('status')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('actions')}</th>
              </tr>
            </thead>
            <tbody>
              {tunnels.map((tunnel) => (
                <tr key={tunnel.id} className="border-b border-border/50">
                  <td className="px-4 py-3 font-mono text-xs">
                    127.0.0.1:{tunnel.localPort}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {tunnel.remoteHost}:{tunnel.remotePort}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
                        tunnel.status === 'active' && 'bg-green-500/10 text-green-600',
                        tunnel.status === 'starting' && 'bg-yellow-500/10 text-yellow-600',
                        tunnel.status === 'error' && 'bg-destructive/10 text-destructive',
                        tunnel.status === 'stopped' && 'bg-muted text-muted-foreground',
                      )}
                    >
                      <span
                        className={cn(
                          'h-1.5 w-1.5 rounded-full',
                          tunnel.status === 'active' && 'bg-green-500',
                          tunnel.status === 'starting' && 'bg-yellow-500 animate-pulse',
                          tunnel.status === 'error' && 'bg-destructive',
                          tunnel.status === 'stopped' && 'bg-muted-foreground',
                        )}
                      />
                      {t(`forwardStatus_${tunnel.status}`)}
                    </span>
                    {tunnel.message && (
                      <p className="mt-1 font-mono text-xs text-muted-foreground">
                        {tunnel.message}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {tunnel.status === 'active' || tunnel.status === 'starting' ? (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          title={t('stop')}
                          onClick={() => void handleStop(tunnel.id)}
                        >
                          <Square className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title={t('remove')}
                        onClick={() => removeTunnel(tunnel.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
