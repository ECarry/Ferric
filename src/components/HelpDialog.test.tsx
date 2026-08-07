import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { HelpDialog } from './HelpDialog'

const longReleaseNotes = [
  '# Release notes',
  '',
  'This is a deliberately long release note with a URL-like value that must wrap instead of expanding the update dialog: ',
  'https://example.com/releases/0.1.13/notes/this-is-a-very-long-path-without-spaces-that-must-remain-readable',
  '',
  'Fixes and improvements '.repeat(80),
].join('\n')


const { checkUpdate } = vi.hoisted(() => ({
  checkUpdate: vi.fn(async () => ({
    available: true,
    version: '0.1.13',
    body: longReleaseNotes,
    downloadAndInstall: vi.fn(),
  })),
}))

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn(async () => '0.1.9'),
}))

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: vi.fn(),
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: checkUpdate,
}))

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: (key: string, values?: { version?: string }) => {
      const messages: Record<string, string> = {
        help: 'Help',
        currentVersion: `Current version: ${values?.version ?? ''}`,
        updateAvailable: `New version available: ${values?.version ?? ''}`,
        updateNotAvailable: 'You are on the latest version',
        checkForUpdates: 'Check for updates',
        checkingForUpdates: 'Checking...',
        updateError: 'Failed to check for updates',
        downloadAndInstall: 'Download & Install',
        downloadUpdate: 'Downloading update...',
        downloadComplete: 'Download complete',
        restartError: 'Failed to restart',
        restartAppLater: 'Restart later',
        restartApp: 'Restart app',
      }
      return messages[key] ?? key
    },
  }),
}))

describe('HelpDialog', () => {
  it('keeps long release notes inside the update dialog', async () => {
    render(<HelpDialog />)

    await waitFor(() => expect(checkUpdate).toHaveBeenCalled())
    const helpButton = await screen.findByRole('button', { name: 'Help' })
    helpButton.click()

    await waitFor(() => expect(document.querySelector('pre')?.textContent).toBe(longReleaseNotes))

    const releaseNotes = document.querySelector('pre')
    if (!releaseNotes) throw new Error('Release notes were not rendered')
    expect(releaseNotes).toHaveClass('min-w-0', 'overflow-auto', 'whitespace-pre-wrap', 'break-words')
    expect(releaseNotes.closest('[data-slot="dialog-content"]')).toHaveClass('min-w-0', 'overflow-hidden')
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
})
