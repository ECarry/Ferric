import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { onSshData, sshResize, sshSendInput } from '@/lib/ssh'
import type { UnlistenFn } from '@tauri-apps/api/event'
import {
  loadTerminalSettings,
  subscribeTerminalSettings,
  getTerminalTheme,
  type TerminalSettings,
} from '@/lib/terminal-settings'

interface TerminalViewProps {
  sessionId: string
  active?: boolean
}

const decoder = new TextDecoder()

export function TerminalView({ sessionId, active = true }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const activeRef = useRef(active)

  // Create the terminal once per session.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const settings = loadTerminalSettings()
    const theme = getTerminalTheme(settings.themeId)

    const term = new Terminal({
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize,
      cursorBlink: settings.cursorBlink,
      theme: {
        background: theme.background,
        foreground: theme.foreground,
        cursor: theme.cursor,
        selectionBackground: theme.selectionBackground,
        black: theme.black,
        red: theme.red,
        green: theme.green,
        yellow: theme.yellow,
        blue: theme.blue,
        magenta: theme.magenta,
        cyan: theme.cyan,
        white: theme.white,
        brightBlack: theme.brightBlack,
        brightRed: theme.brightRed,
        brightGreen: theme.brightGreen,
        brightYellow: theme.brightYellow,
        brightBlue: theme.brightBlue,
        brightMagenta: theme.brightMagenta,
        brightCyan: theme.brightCyan,
        brightWhite: theme.brightWhite,
      },
    })
    termRef.current = term

    const fit = new FitAddon()
    fitRef.current = fit
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(container)
    fit.fit()

    // Remote shell output -> terminal. Keep receiving output while hidden so no terminal history is lost.
    let unlisten: UnlistenFn | undefined
    void onSshData(sessionId, (bytes) => term.write(decoder.decode(bytes))).then((fn) => {
      unlisten = fn
    })

    // Terminal input -> remote shell. Hidden terminals do not send input.
    const dataSub = term.onData((data) => {
      if (activeRef.current) void sshSendInput(sessionId, data)
    })

    // Keep the PTY size in sync with the visible terminal.
    const syncSize = () => {
      if (!activeRef.current || !container.clientWidth || !container.clientHeight) return
      fit.fit()
      void sshResize(sessionId, term.cols, term.rows)
    }
    const resizeObserver = new ResizeObserver(syncSize)
    resizeObserver.observe(container)
    syncSize()

    if (activeRef.current) term.focus()

    return () => {
      resizeObserver.disconnect()
      dataSub.dispose()
      unlisten?.()
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [sessionId])

  useEffect(() => {
    activeRef.current = active
    if (!active) return

    requestAnimationFrame(() => {
      const term = termRef.current
      const container = containerRef.current
      const fit = fitRef.current
      if (!term || !container) return
      term.focus()
      if (container.clientWidth && container.clientHeight) {
        fit?.fit()
        void sshResize(sessionId, term.cols, term.rows)
      }
    })
  }, [active, sessionId])

  // Live-apply settings changes without recreating the terminal.
  useEffect(() => {
    const apply = (s: TerminalSettings) => {
      const term = termRef.current
      const fit = fitRef.current
      if (!term) return
      const theme = getTerminalTheme(s.themeId)
      term.options.fontSize = s.fontSize
      term.options.fontFamily = s.fontFamily
      term.options.cursorBlink = s.cursorBlink
      term.options.theme = {
        background: theme.background,
        foreground: theme.foreground,
        cursor: theme.cursor,
        selectionBackground: theme.selectionBackground,
        black: theme.black,
        red: theme.red,
        green: theme.green,
        yellow: theme.yellow,
        blue: theme.blue,
        magenta: theme.magenta,
        cyan: theme.cyan,
        white: theme.white,
        brightBlack: theme.brightBlack,
        brightRed: theme.brightRed,
        brightGreen: theme.brightGreen,
        brightYellow: theme.brightYellow,
        brightBlue: theme.brightBlue,
        brightMagenta: theme.brightMagenta,
        brightCyan: theme.brightCyan,
        brightWhite: theme.brightWhite,
      }
      // Re-fit after font size/family changes.
      requestAnimationFrame(() => {
        const container = containerRef.current
        if (container && container.clientWidth && container.clientHeight) {
          fit?.fit()
          void sshResize(sessionId, term.cols, term.rows)
        }
      })
    }
    return subscribeTerminalSettings(apply)
  }, [sessionId])

  const settings = loadTerminalSettings()
  const theme = getTerminalTheme(settings.themeId)

  return (
    <div
      ref={containerRef}
      className="h-full w-full p-2"
      style={{ backgroundColor: theme.background }}
    />
  )
}
