/** Argument grammar for /compact-config (spec §7). Pure — no cordis imports. */

export type CompactConfigRequest =
  | { kind: 'show' }
  | { kind: 'test' }
  | { kind: 'archive' }
  | { kind: 'set'; path: readonly string[]; value: string }
  | { kind: 'presetAdd'; provider: string; model: string; fields: Record<string, string | boolean> }
  | { kind: 'presetRemove'; provider: string; model: string }
  | { kind: 'presetSet'; provider: string; model: string; field: string; value: string }
  | { kind: 'usage'; error?: string }

export function parseCompactConfigArgs(raw: string): CompactConfigRequest {
  const tokens = raw.trim().split(/\s+/).filter(token => token.length > 0)
  if (tokens.length === 0) return { kind: 'show' }
  const [head, ...rest] = tokens
  switch (head) {
    case 'show': return rest.length === 0 ? { kind: 'show' } : { kind: 'usage', error: 'show takes no arguments' }
    case 'test': return rest.length === 0 ? { kind: 'test' } : { kind: 'usage', error: 'test takes no arguments' }
    case 'archive': return rest.length === 0 ? { kind: 'archive' } : { kind: 'usage', error: 'archive takes no arguments' }
    case 'set': return parseSet(rest)
    case 'preset': return parsePreset(rest)
    default: return { kind: 'usage', error: 'unknown subcommand "' + String(head) + '"' }
  }
}

function parseSet(rest: string[]): CompactConfigRequest {
  // set <path...> <value>: set ratio 0.8 | set retain tokens 32768 |
  // set archive onFailure block | set summarization maxTokens 4096 | set auto false
  if (rest.length < 2) return { kind: 'usage', error: 'set needs a field path and a value' }
  return { kind: 'set', path: rest.slice(0, -1), value: rest[rest.length - 1]! }
}

function parsePreset(rest: string[]): CompactConfigRequest {
  const [action, provider, model] = rest
  if (action === 'add') {
    if (provider === undefined || model === undefined) {
      return { kind: 'usage', error: 'preset add <provider> <model> [tokens N] [ratio R] [mode M] [retain tokens N|retain ratio R] [disabled]' }
    }
    const tail = rest.slice(3)
    const fields: Record<string, string | boolean> = {}
    for (let i = 0; i < tail.length; i += 1) {
      const key = tail[i]!
      if (key === 'tokens' || key === 'ratio' || key === 'mode') {
        const value = tail[i + 1]
        if (value === undefined) return { kind: 'usage', error: 'preset add: ' + key + ' needs a value' }
        fields[key === 'tokens' ? 'trigger.tokens' : key === 'ratio' ? 'trigger.ratio' : 'trigger.mode'] = value
        i += 1
      } else if (key === 'retain') {
        const form = tail[i + 1]
        const value = tail[i + 2]
        if ((form !== 'tokens' && form !== 'ratio') || value === undefined) {
          return { kind: 'usage', error: 'preset add: retain tokens N | retain ratio R' }
        }
        fields['retain.' + form] = value
        i += 2
      } else if (key === 'disabled') {
        fields.disabled = true
      } else {
        return { kind: 'usage', error: 'preset add: unknown field "' + key + '"' }
      }
    }
    return { kind: 'presetAdd', provider, model, fields }
  }
  if (action === 'remove') {
    if (provider === undefined || model === undefined || rest.length !== 3) {
      return { kind: 'usage', error: 'preset remove <provider> <model>' }
    }
    return { kind: 'presetRemove', provider, model }
  }
  if (action === 'set') {
    const field = rest[3]
    const value = rest[4]
    if (provider === undefined || model === undefined || field === undefined || value === undefined || rest.length !== 5) {
      return { kind: 'usage', error: 'preset set <provider> <model> <field> <value>' }
    }
    return { kind: 'presetSet', provider, model, field, value }
  }
  return { kind: 'usage', error: 'preset needs add | remove | set' }
}
