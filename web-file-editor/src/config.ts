/**
 * Shared validator for file-editor-config.json — the single store file used
 * by the plugin's settings namespace and the gated tab registration. Missing
 * file / missing keys resolve to defaults; unknown keys or a non-boolean
 * enabled are refused (fail-fast, same conventions as the handoff config).
 *
 * @module web-file-editor/config
 */
import { deepFreeze } from '@deepseek-ai/dsh-llm'

const TOP_KEYS = new Set(['enabled'])

/** The resolved plugin configuration. */
export interface ResolvedEditorConfig {
  /** Whether the Editor tab (and every editor affordance) is available. */
  readonly enabled: boolean
}

/** Validate an untrusted raw document and resolve defaults (fail-fast). */
export function parseEditorConfig(raw: unknown): ResolvedEditorConfig {
  if (raw === undefined) return deepFreeze({ enabled: true })
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('file-editor config: expected a JSON object')
  }
  for (const key of Object.keys(raw as Record<string, unknown>)) {
    if (key !== 'enabled') {
      throw new Error('file-editor config: unknown key "' + key + '"')
    }
  }
  const value = (raw as Record<string, unknown>).enabled
  if (value !== undefined && typeof value !== 'boolean') {
    throw new Error('file-editor config: enabled must be a boolean')
  }
  return deepFreeze({ enabled: value ?? true })
}
