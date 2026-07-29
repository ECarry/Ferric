export interface TerminalTheme {
  name: string
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export const TERMINAL_THEMES: Record<string, TerminalTheme> = {
  'dark-default': {
    name: 'Dark',
    background: '#0b0d11',
    foreground: '#e6e9f0',
    cursor: '#e6e9f0',
    selectionBackground: '#264f78',
    black: '#000000',
    red: '#ff6b6b',
    green: '#4ec9b0',
    yellow: '#d7ba7d',
    blue: '#569cd6',
    magenta: '#c586c0',
    cyan: '#9cdcfe',
    white: '#d4d4d4',
    brightBlack: '#666666',
    brightRed: '#ff8c8c',
    brightGreen: '#7fcec4',
    brightYellow: '#e2c08d',
    brightBlue: '#6cb6ff',
    brightMagenta: '#d6a8d2',
    brightCyan: '#b3e0ff',
    brightWhite: '#ffffff',
  },
  'dracula': {
    name: 'Dracula',
    background: '#282a36',
    foreground: '#f8f8f2',
    cursor: '#f8f8f2',
    selectionBackground: '#44475a',
    black: '#000000',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    white: '#bfbfbf',
    brightBlack: '#4d4d4d',
    brightRed: '#ff6e67',
    brightGreen: '#5af78e',
    brightYellow: '#f4f99d',
    brightBlue: '#caa9fa',
    brightMagenta: '#ff92d0',
    brightCyan: '#9aedfe',
    brightWhite: '#f6f6ef',
  },
  'solarized-dark': {
    name: 'Solarized Dark',
    background: '#002b36',
    foreground: '#839496',
    cursor: '#839496',
    selectionBackground: '#073642',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#586e75',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  },
  'nord': {
    name: 'Nord',
    background: '#2e3440',
    foreground: '#d8dee9',
    cursor: '#d8dee9',
    selectionBackground: '#3b4252',
    black: '#3b4252',
    red: '#bf616a',
    green: '#a3be8c',
    yellow: '#ebcb8b',
    blue: '#81a1c1',
    magenta: '#b48ead',
    cyan: '#88c0d0',
    white: '#e5e9f0',
    brightBlack: '#4c566a',
    brightRed: '#bf616a',
    brightGreen: '#a3be8c',
    brightYellow: '#ebcb8b',
    brightBlue: '#81a1c1',
    brightMagenta: '#b48ead',
    brightCyan: '#8fbcbb',
    brightWhite: '#eceff4',
  },
  'github-dark': {
    name: 'GitHub Dark',
    background: '#24292e',
    foreground: '#e1e4e8',
    cursor: '#e1e4e8',
    selectionBackground: '#444d56',
    black: '#24292e',
    red: '#f85149',
    green: '#3fb950',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    white: '#b1bac4',
    brightBlack: '#6e7681',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#f0f6fc',
  },
  'monokai': {
    name: 'Monokai',
    background: '#272822',
    foreground: '#f8f8f2',
    cursor: '#f8f8f0',
    selectionBackground: '#49483e',
    black: '#272822',
    red: '#f92672',
    green: '#a6e22e',
    yellow: '#f4bf75',
    blue: '#66d9ef',
    magenta: '#ae81ff',
    cyan: '#a1efe4',
    white: '#f8f8f2',
    brightBlack: '#75715e',
    brightRed: '#f92672',
    brightGreen: '#a6e22e',
    brightYellow: '#f4bf75',
    brightBlue: '#66d9ef',
    brightMagenta: '#ae81ff',
    brightCyan: '#a1efe4',
    brightWhite: '#f9f8f5',
  },
}

export const TERMINAL_FONT_FAMILIES = [
  "ui-monospace, 'SFMono-Regular', 'Cascadia Code', Consolas, monospace",
  "'JetBrains Mono', 'Fira Code', ui-monospace, monospace",
  "'Cascadia Code', 'Cascadia Mono', ui-monospace, monospace",
  "'Fira Code', ui-monospace, monospace",
  "'Source Code Pro', ui-monospace, monospace",
  "'Courier New', Courier, monospace",
]

export interface TerminalSettings {
  fontSize: number
  fontFamily: string
  themeId: string
  cursorBlink: boolean
}

const STORAGE_KEY = 'ferric-terminal-settings'

const DEFAULT_SETTINGS: TerminalSettings = {
  fontSize: 13,
  fontFamily: TERMINAL_FONT_FAMILIES[0],
  themeId: 'dark-default',
  cursorBlink: true,
}

type Listener = (settings: TerminalSettings) => void
const listeners = new Set<Listener>()

export function loadTerminalSettings(): TerminalSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<TerminalSettings>
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveTerminalSettings(settings: TerminalSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  listeners.forEach((fn) => fn(settings))
}

export function subscribeTerminalSettings(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getTerminalTheme(themeId: string): TerminalTheme {
  return TERMINAL_THEMES[themeId] ?? TERMINAL_THEMES['dark-default']
}
