import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { onSshData, sshResize, sshSendInput } from '@/lib/ssh'
import type { UnlistenFn } from '@tauri-apps/api/event'

interface TerminalViewProps {
  sessionId: string
}

const decoder = new TextDecoder()

export function TerminalView({ sessionId }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      fontFamily:
        "ui-monospace, 'SFMono-Regular', 'Cascadia Code', Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: '#0b0d11',
        foreground: '#e6e9f0',
        cursor: '#e6e9f0',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(container)
    fit.fit()

    // Remote shell output -> terminal
    let unlisten: UnlistenFn | undefined
    onSshData(sessionId, (bytes) => term.write(decoder.decode(bytes))).then(
      (fn) => {
        unlisten = fn
      },
    )

    // Terminal input -> remote shell
    const dataSub = term.onData((data) => {
      void sshSendInput(sessionId, data)
    })

    // Keep the PTY size in sync with the visible terminal.
    // Skip while hidden (display:none => 0 size); otherwise fit() would
    // compute a degenerate column count and force the shell to redraw its
    // prompt, which shows up as an extra line each time you switch tabs.
    const syncSize = () => {
      if (!container.clientWidth || !container.clientHeight) return
      fit.fit()
      void sshResize(sessionId, term.cols, term.rows)
    }
    const resizeObserver = new ResizeObserver(syncSize)
    resizeObserver.observe(container)
    syncSize()

    term.focus()

    return () => {
      resizeObserver.disconnect()
      dataSub.dispose()
      unlisten?.()
      term.dispose()
    }
  }, [sessionId])

  return <div ref={containerRef} className="h-full w-full bg-[#0b0d11] p-2" />
}
