import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { KeyRound, Lock } from 'lucide-react'
import type { Server, ServerGroup } from '@/types'
import { cn } from '@/lib/utils'
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
  const [form, setForm] = useState<Server>(emptyForm(groups[0]?.id ?? ''))

  useEffect(() => {
    if (open) {
      setForm(initial ? { ...initial } : emptyForm(groups[0]?.id ?? ''))
    }
  }, [open, initial, groups])

  const set = <K extends keyof Server>(key: K, value: Server[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    onSave({ ...form, id: form.id || `s-${Date.now()}` })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? '编辑服务器' : '添加服务器'}</DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="名称">
              <Input
                required
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                placeholder="web-01"
              />
            </Field>
            <Field label="分组">
              <Select
                value={form.groupId}
                onValueChange={(v) => set('groupId', v as string)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择分组" />
                </SelectTrigger>
                <SelectContent>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <Field label="主机 / IP">
                <Input
                  required
                  value={form.host}
                  onChange={(e) => set('host', e.target.value)}
                  placeholder="10.0.1.11"
                />
              </Field>
            </div>
            <Field label="端口">
              <Input
                type="number"
                value={form.port}
                onChange={(e) => set('port', Number(e.target.value))}
              />
            </Field>
          </div>

          <Field label="用户名">
            <Input
              required
              value={form.username}
              onChange={(e) => set('username', e.target.value)}
              placeholder="root"
            />
          </Field>

          <Field label="认证方式">
            <div className="flex gap-2">
              <AuthTab
                active={form.authType === 'password'}
                onClick={() => set('authType', 'password')}
                icon={<Lock className="h-4 w-4" />}
                label="密码"
              />
              <AuthTab
                active={form.authType === 'key'}
                onClick={() => set('authType', 'key')}
                icon={<KeyRound className="h-4 w-4" />}
                label="密钥"
              />
            </div>
          </Field>

          {form.authType === 'password' ? (
            <Field label="密码">
              <Input
                type="password"
                value={form.password ?? ''}
                onChange={(e) => set('password', e.target.value)}
                placeholder="••••••••"
              />
            </Field>
          ) : (
            <div className="space-y-4">
              <Field label="私钥路径">
                <Input
                  value={form.keyPath ?? ''}
                  onChange={(e) => set('keyPath', e.target.value)}
                  placeholder="~/.ssh/id_ed25519"
                />
              </Field>
              <Field label="私钥口令（可选）">
                <Input
                  type="password"
                  value={form.keyPassphrase ?? ''}
                  onChange={(e) => set('keyPassphrase', e.target.value)}
                  placeholder="若私钥未加密可留空"
                />
              </Field>
            </div>
          )}

          <DialogFooter className="mt-2">
            <Button type="button" variant="outline" onClick={onClose}>
              取消
            </Button>
            <Button type="submit">保存</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors',
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
