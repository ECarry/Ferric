/**
 * Rust `AppError` mirrors this shape: a translatable `code`, interpolation
 * `params`, and an optional raw `detail` that can be shown for diagnostics.
 */
export interface AppError {
  code: string
  params?: Record<string, string | number | undefined>
  detail?: string
}

export function isAppError(err: unknown): err is AppError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as AppError).code === 'string'
  )
}

export type ErrorTranslator = (
  key: string,
  options?: Record<string, unknown>,
) => string

/**
 * Render a backend error into a user-facing localized string.
 *
 * If the error is a structured `AppError`, the `code` is resolved through
 * `t` with `params`. A missing translation falls back to the code itself
 * plus the raw `detail`.
 *
 * Non-structured errors are stringified as-is.
 */
export function formatAppError(
  err: unknown,
  t: ErrorTranslator,
): string {
  if (isAppError(err)) {
    const { code, params = {}, detail } = err
    let msg = t(code, params as Record<string, unknown>)
    // If the key is missing, i18next returns the key. Provide a fallback that
    // still shows the (translated) raw detail when available.
    if (msg === code) {
      msg = t('errUnknown', { detail: detail ?? '' })
    } else if (detail) {
      msg += ` (${detail})`
    }
    return msg
  }
  return String(err)
}
