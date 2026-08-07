import { useCallback, useEffect, useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { getVersion } from '@tauri-apps/api/app'
import { relaunch } from '@tauri-apps/plugin-process'
import { check as checkUpdate } from '@tauri-apps/plugin-updater'
import { useI18n } from '@/i18n'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function HelpDialog() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [version, setVersion] = useState('')
  const [checking, setChecking] = useState(false)
  const [update, setUpdate] = useState<NonNullable<Awaited<ReturnType<typeof checkUpdate>>> | null>(null)
  const [installed, setInstalled] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [contentLength, setContentLength] = useState(0)
  const [downloaded, setDownloaded] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const handleCheck = useCallback(async () => {
    setChecking(true)
    setError(null)
    setMessage(null)
    setUpdate(null)
    setInstalled(false)
    setDownloaded(0)
    setContentLength(0)
    try {
      const u = await checkUpdate()
      if (u?.available) {
        setUpdate(u)
      }
    } catch (e) {
      console.error(e)
      setError(t('updateError'))
    } finally {
      setChecking(false)
    }
  }, [t])

  const handleInstall = async () => {
    if (!update) return
    setDownloading(true)
    setInstalled(false)
    setError(null)
    setMessage(null)
    setDownloaded(0)
    setContentLength(0)
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          setContentLength(event.data.contentLength ?? 0)
        } else if (event.event === 'Progress') {
          setDownloaded((d) => d + event.data.chunkLength)
        }
      })
      setInstalled(true)
      setMessage(t('downloadComplete'))
    } catch (e) {
      console.error(e)
      setError(t('updateError'))
    } finally {
      setDownloading(false)
    }
  }

  const handleRestart = async () => {
    try {
      await relaunch()
    } catch (e) {
      console.error(e)
      setError(t('restartError'))
    }
  }

  useEffect(() => {
    getVersion()
      .then((v) => setVersion(v))
      .catch(() => setVersion(''))
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => void handleCheck(), 0)
    return () => window.clearTimeout(timer)
  }, [handleCheck])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="icon" className="relative" aria-label={t('help')} onClick={() => setOpen(true)}>
        <HelpCircle className="h-5 w-5" />
        {update && !installed && <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-red-500" />}
      </Button>
      <DialogContent className="min-w-0 max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-lg">
        <DialogHeader className="min-w-0">
          <DialogTitle>{t('help')}</DialogTitle>
          <DialogDescription>{t('currentVersion', { version: version || '—' })}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-2 overflow-y-auto overscroll-contain pr-1">
          {update && (
            <div className="min-w-0 space-y-2">
              <p className="break-words">{t('updateAvailable', { version: update.version })}</p>
              {update.body && (
                <pre className="max-h-[min(45vh,20rem)] min-w-0 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs leading-relaxed">{update.body}</pre>
              )}
            </div>
          )}
          {error && <p className="break-words text-sm text-destructive" role="alert">{error}</p>}
          {message && <p className="break-words text-sm text-green-600" role="status">{message}</p>}
          {!update && !error && !message && (
            <p className="text-sm text-muted-foreground">{t('updateNotAvailable')}</p>
          )}
          {downloading && (
            <div className="space-y-1">
              <div className="text-sm text-muted-foreground">
                {t('downloadUpdate')} {contentLength > 0 ? `${Math.round((downloaded / contentLength) * 100)}%` : ''}
              </div>
              <div className="h-2 w-full overflow-hidden rounded bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{
                    width: contentLength > 0 ? `${Math.min(100, (downloaded / contentLength) * 100)}%` : '0%',
                  }}
                />
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="min-w-0 flex-wrap">
          <Button className="min-w-0" variant="outline" onClick={handleCheck} disabled={checking || downloading}>
            {checking ? t('checkingForUpdates') : t('checkForUpdates')}
          </Button>
          {update && !installed && !downloading && (
            <Button onClick={handleInstall} disabled={checking || downloading}>
              {t('downloadAndInstall')}
            </Button>
          )}
          {installed && (
            <>
              <Button variant="outline" onClick={() => setOpen(false)}>
                {t('restartAppLater')}
              </Button>
              <Button onClick={handleRestart}>{t('restartApp')}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
