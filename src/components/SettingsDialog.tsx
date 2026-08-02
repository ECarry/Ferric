import { useState } from 'react'
import { Minus, Plus, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { useI18n } from '@/i18n'
import {
  TERMINAL_THEMES,
  TERMINAL_FONT_FAMILIES,
  loadTerminalSettings,
  saveTerminalSettings,
  getTerminalTheme,
  type TerminalSettings,
} from '@/lib/terminal-settings'
import { cn } from '@/lib/utils'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { t } = useI18n()
  const [settings, setSettings] = useState<TerminalSettings>(() =>
    loadTerminalSettings(),
  )


  const update = (patch: Partial<TerminalSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveTerminalSettings(next)
  }

  const reset = () => {
    const defaults: TerminalSettings = {
      fontSize: 13,
      fontFamily: TERMINAL_FONT_FAMILIES[0],
      themeId: 'dark-default',
      cursorBlink: true,
    }
    setSettings(defaults)
    saveTerminalSettings(defaults)
  }

  const theme = getTerminalTheme(settings.themeId)

  const fontOptions = TERMINAL_FONT_FAMILIES.map((ff, i) => ({
    value: ff,
    label: ff.split(',')[0].replace(/['"]/g, '').trim() || 'System Mono',
    key: i,
  }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('terminalSettings')}</DialogTitle>
          <DialogDescription>{t('terminalSettingsHint')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Font size */}
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('fontSize')}</label>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => update({ fontSize: Math.max(8, settings.fontSize - 1) })}
                disabled={settings.fontSize <= 8}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="w-12 text-center text-sm tabular-nums">
                {settings.fontSize}px
              </span>
              <Button
                variant="outline"
                size="icon-sm"
                onClick={() => update({ fontSize: Math.min(32, settings.fontSize + 1) })}
                disabled={settings.fontSize >= 32}
              >
                <Plus className="h-4 w-4" />
              </Button>
              <Slider
                min={8}
                max={32}
                step={1}
                value={settings.fontSize}
                onValueChange={(val) => update({ fontSize: val as number })}
                className="flex-1"
              />
            </div>
          </div>

          {/* Font family */}
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('fontFamily')}</label>
            <Select
              value={settings.fontFamily}
              onValueChange={(val) => update({ fontFamily: val as string })}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value) =>
                    fontOptions.find((o) => o.value === value)?.label ?? 'System Mono'
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {fontOptions.map((opt) => (
                  <SelectItem key={opt.key} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Theme */}
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('colorTheme')}</label>
            <div className="grid grid-cols-3 gap-2">
              {Object.entries(TERMINAL_THEMES).map(([id, th]) => (
                <button
                  key={id}
                  onClick={() => update({ themeId: id })}
                  className={cn(
                    'flex flex-col gap-1.5 rounded-lg border-2 p-2 text-left transition-colors',
                    settings.themeId === id
                      ? 'border-primary'
                      : 'border-border hover:border-muted-foreground/40',
                  )}
                >
                  <div
                    className="flex h-8 items-center justify-center rounded font-mono text-xs"
                    style={{ backgroundColor: th.background, color: th.foreground }}
                  >
                    $ ls
                  </div>
                  <span className="truncate text-xs text-muted-foreground">
                    {th.name}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Cursor blink */}
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">{t('cursorBlink')}</label>
            <Switch
              checked={settings.cursorBlink}
              onCheckedChange={(checked) => update({ cursorBlink: checked })}
            />
          </div>

          {/* Preview */}
          <div className="space-y-2">
            <label className="text-sm font-medium">{t('preview')}</label>
            <div
              className="overflow-hidden rounded-lg p-3 font-mono"
              style={{
                backgroundColor: theme.background,
                color: theme.foreground,
                fontSize: `${settings.fontSize}px`,
                fontFamily: settings.fontFamily,
                lineHeight: 1.4,
              }}
            >
              <div>
                <span style={{ color: theme.green }}>user@host</span>
                <span style={{ color: theme.foreground }}>:</span>
                <span style={{ color: theme.blue }}>~</span>
                <span style={{ color: theme.foreground }}>$ </span>
                <span style={{ color: theme.yellow }}>ls -la</span>
              </div>
              <div style={{ color: theme.cyan }}>drwxr-xr-x  2 user user 4096</div>
              <div style={{ color: theme.white }}>-rw-r--r--  1 user user  123</div>
              <div>
                <span style={{ color: theme.green }}>user@host</span>
                <span style={{ color: theme.foreground }}>:</span>
                <span style={{ color: theme.blue }}>~</span>
                <span style={{ color: theme.foreground }}>$ </span>
                <span style={{ color: theme.cursor, opacity: settings.cursorBlink ? 1 : 0.7 }}>▋</span>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={reset}>
            <RotateCcw className="mr-2 h-4 w-4" />
            {t('resetDefaults')}
          </Button>
          <Button onClick={() => onOpenChange(false)}>
            {t('close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
