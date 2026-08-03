import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { KeyRound, Lock } from 'lucide-react'
import type { Server, ServerGroup } from '@/types'
import { cn } from '@/lib/utils'
import { groupDisplayName } from '@/lib/groups'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface ServerFormModalProps {
  open: boolean
  groups: ServerGroup[]
  initial?: Server | null
  onClose: () => void
  onSave: (server: Server) => void
}

const emptyForm = (groupId: string): Server => ({
  id: '',
  name: '',
  host: '',
  port: 22,
  username: 'root',
  authType: 'password',
  groupId,
  color: '#6366f1',
})

export function ServerFormModal({
  open,
  groups,
  initial,
  onClose,
  onSave,
}: ServerFormModalProps) {
  const { t } = useI18n()

  // The key is derived from the server id (or 'new') so the inner form
  // remounts with fresh state when switching between add/edit targets.
  const formKey = initial?.id ?? 'new'

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? t('editServer') : t('addServerTitle')}</DialogTitle>
        </DialogHeader>

        {open && (
          <ServerFormInner
            key={formKey}
            groups={groups}
            initial={initial}
            onSave={onSave}
            onCancel={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ServerFormInner({
  groups,
  initial,
  onSave,
  onCancel,
}: {
  groups: ServerGroup[]
  initial?: Server | null
  onSave: (server: Server) => void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const [form, setForm] = useState<Server>(
    initial ? { ...initial } : emptyForm(groups[0]?.id ?? ''),
  )

  // Validate host: IPv4, IPv6, or domain name (with optional port already separate).
  const validateHost = (value: string): boolean => {
    const host = value.trim()
    if (!host) return false
    // IPv4: four numeric octets, each 0-255, no leading zeros (except "0" itself)
    const parts = host.split('.')
    const looksLikeIpv4 = parts.length === 4 && parts.every(p => /^\d+$/.test(p))
    if (looksLikeIpv4) {
      if (parts.every(p => {
        if (p.length > 1 && p.startsWith('0')) return false
        const n = Number(p)
        return n >= 0 && n <= 255
      })) return true
      // Looks like an IP but has invalid octets — reject, don't fall through to domain.
      return false
    }
    // IPv6: full or compressed form
    const ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/
    if (ipv6.test(host)) return true
    // Domain name: labels separated by dots, each 1-63 chars, alphanumeric + hyphen
    const domain = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/
    if (domain.test(host)) return true
    // localhost
    if (host === 'localhost') return true
    return false
  }

  const isHostValid = useMemo(() => validateHost(form.host), [form.host])

  const set = <K extends keyof Server>(key: K, value: Server[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const trimmedHost = form.host.trim()
    if (!validateHost(trimmedHost)) {
      return
    }
    onSave({
      ...form,
      id: form.id || `s-${Date.now()}`,
      host: trimmedHost,
      username: form.username.trim(),
    })
  }

  return (

        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t('name')}>
              <Input
                required
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="web-01"
              />
            </Field>
            <Field label={t('group')}>
              <Select
                value={form.groupId}
                onValueChange={(v) => set('groupId', v as string)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('selectGroup')}>
                    {(value) => {
                      const group = groups.find((g) => g.id === value)
                      return group
                        ? groupDisplayName(group, t)
                        : t('selectGroup')
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {groupDisplayName(g, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Field label={t('host')}>
                <Input
                  required
                  value={form.host}
                  aria-invalid={!isHostValid && form.host.length > 0}
                  onChange={(e) => set('host', e.target.value)}
                  placeholder="10.0.1.11"
                />
                {form.host.length > 0 && !isHostValid && (
                  <p className="mt-1 text-xs text-destructive">{t('errInvalidHost')}</p>
                )}
              </Field>
            </div>
            <Field label={t('port')}>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={65535}
                required
                value={form.port}
                onChange={(e) => set('port', Math.min(65535, Math.max(1, Number(e.target.value) || 22)))}
              />
            </Field>
          </div>

          <Field label={t('username')}>
            <Input
              required
              value={form.username}
              onChange={(e) => set('username', e.target.value)}
              placeholder="root"
            />
          </Field>

          <Field label={t('authentication')}>
            <div className="flex gap-2">
              <AuthTab
                active={form.authType === 'password'}
                onClick={() => set('authType', 'password')}
                icon={<Lock className="h-4 w-4" />}
                label={t('password')}
              />
              <AuthTab
                active={form.authType === 'key'}
                onClick={() => set('authType', 'key')}
                icon={<KeyRound className="h-4 w-4" />}
                label={t('key')}
              />
            </div>
          </Field>

          {form.authType === 'password' ? (
            <Field label={t('password')}>
              <Input
                type="password"
                value={form.password ?? ''}
                onChange={(e) => set('password', e.target.value)}
                placeholder="••••••••"
              />
            </Field>
          ) : (
            <div className="space-y-4">
              <Field label={t('privateKeyPath')}>
                <Input
                  value={form.keyPath ?? ''}
                  onChange={(e) => set('keyPath', e.target.value)}
                  placeholder="~/.ssh/id_ed25519"
                />
              </Field>
              <Field label={t('privateKeyPassphrase')}>
                <Input
                  type="password"
                  value={form.keyPassphrase ?? ''}
                  onChange={(e) => set('keyPassphrase', e.target.value)}
                  placeholder={t('privateKeyPassphrasePlaceholder')}
                />
              </Field>
            </div>
          )}

          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={!isHostValid}>{t('save')}</Button>
          </DialogFooter>
        </form>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  )
}

function AuthTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
        active
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-border text-muted-foreground hover:bg-muted',
      )}
    >
      {icon}
      {label}
    </button>
  )
}
