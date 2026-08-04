export type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'other'

export function getLogLevel(line: string): LogLevel {
  const value = line.toLowerCase()
  if (/\b(err|error|fatal|critical|crit|fail)\b/.test(value)) return 'error'
  if (/\b(warn|warning)\b/.test(value)) return 'warn'
  if (/\b(info|notice|started|accepted|success)\b/.test(value)) return 'info'
  if (/\b(debug|trace)\b/.test(value)) return 'debug'
  return 'other'
}
