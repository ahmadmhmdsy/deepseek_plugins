/**
 * The mutation path used by command plugins that tune a settings file:
 * staged raw edits against the last saved document, re-validated by a shared
 * validator BEFORE any write, then an atomic rewrite. Extracted from
 * compact-config-command/src/index.ts (behavior-unchanged, plugin-kit plan
 * K3-3).
 *
 * @module plugin-kit/host/command-mutations
 */
import { readConfigRaw } from './hot-reload-store.ts'

/** Coerce one CLI text token to true/false/int/float/string. */
export function parseScalar(value: string): unknown {
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10)
  if (/^-?\d*\.\d+$/.test(value)) return Number.parseFloat(value)
  return value
}

/**
 * Set a (possibly nested) key on the raw document. Creates parent objects —
 * matching the scalar-coercion contract of the /compact-config set grammar.
 */
export function applyPathSet(
  raw: Record<string, unknown>,
  path: readonly string[],
  value: string,
): void {
  const finalValue = parseScalar(value)
  let cursor = raw
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i]!
    if (typeof cursor[key] !== 'object' || cursor[key] === null) cursor[key] = {}
    cursor = cursor[key] as Record<string, unknown>
  }
  cursor[path[path.length - 1]!] = finalValue
}

/** How a command run describes the applied mutation for its response text. */
export type MutationDescriber<Parsed> = (parsed: Parsed, raw: Record<string, unknown>) => string

/**
 * One store-file mutation round: read the last saved raw document, apply the
 * raw mutation, re-validate through a shared validator (throwing BEFORE any
 * write — the command's shared gate), atomically rewrite, and describe the
 * parsed result for the response text.
 */
export async function runConfigMutation<Parsed>(
  opts: {
    /** The store file's absolute path (normally borrowed from the engine). */
    filePath: string
    /** The shared validator; throws on invalid input so no write happens. */
    parse: (raw: unknown) => Parsed
    /** Atomic writer (host plugins supply the kit's atomicWriteJson). */
    write: (filePath: string, raw: unknown) => Promise<void>
    /** Describes the parsed + written state for the command's response. */
    describe: (parsed: Parsed, raw: Record<string, unknown>) => string
  },
  mutateRaw: (raw: Record<string, unknown>) => void,
): Promise<string> {
  const raw = structuredClone((readConfigRaw(opts.filePath) ?? {}) as Record<string, unknown>)
  mutateRaw(raw)
  const parsed = opts.parse(raw) // shared validator — throws before any write
  await opts.write(opts.filePath, raw)
  return opts.describe(parsed, raw)
}
