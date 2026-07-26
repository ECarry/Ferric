import { useState, type FormEvent, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { CreateDockerContainerInput, DockerContainer } from '@/lib/docker'
import { useI18n } from '@/i18n'

interface ContainerFormModalProps {
  initial?: DockerContainer | null
  onClose: () => void
  onSave: (input: CreateDockerContainerInput) => Promise<void>
}

export function ContainerFormModal({
  initial,
  onClose,
  onSave,
}: ContainerFormModalProps) {
  const { t } = useI18n()
  const editing = Boolean(initial)
  const [form, setForm] = useState<CreateDockerContainerInput>(() => ({
    name: initial?.names ?? '',
    image: initial?.image ?? '',
    command: initial?.command ?? '',
  }))
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await onSave(form)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? t('editContainerTitle') : t('createContainerTitle')}</DialogTitle>
          <DialogDescription>
            {editing
              ? t('editContainerHint')
              : t('createContainerHint')}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <Field label={t('containerName')} hint={editing ? undefined : t('optional')}>
            <Input
              required={editing}
              value={form.name ?? ''}
              onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}
              placeholder="my-app"
              autoFocus
            />
          </Field>

          <Field label={t('image')}>
            <Input
              required
              disabled={editing}
              value={form.image}
              onChange={(event) => setForm((value) => ({ ...value, image: event.target.value }))}
              placeholder="nginx:latest"
            />
          </Field>

          <Field label={t('startupCommand')} hint={editing ? undefined : t('shellCommandHint')}>
            <Input
              disabled={editing}
              value={form.command ?? ''}
              onChange={(event) => setForm((value) => ({ ...value, command: event.target.value }))}
              placeholder="npm run start"
            />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? t('saveChanges') : t('createContainer')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted-foreground">
        {label}
        {hint && <span className="font-normal">{hint}</span>}
      </span>
      {children}
    </label>
  )
}
