/**
 * TODO-PLUGIN input grammar. Pure module — no cordis imports, no harness
 * imports: it is unit-tested directly and shared by entry + tests.
 *
 * Replace the example grammar with your plugin's real one; keep the contract:
 * a closed union of result shapes, with 'usage' carrying a reason.
 *
 * @module TODO-PLUGIN/parse
 */

/** Requests the example /TODO-PLUGIN command accepts. */
export type TemplateRequest =
  | { kind: 'ping'; message: string }
  | { kind: 'usage'; error?: string }

/**
 * Parse the command's raw input.
 * @param raw - everything after the command verb.
 */
export function parseArgs(raw: string): TemplateRequest {
  const tokens = raw.trim().split(/\s+/).filter(token => token.length > 0)
  if (tokens.length === 0) return { kind: 'usage', error: 'TODO-PLUGIN needs an argument' }
  const [head, ...rest] = tokens
  if (head === 'ping') {
    const message = rest.join(' ')
    if (message.length === 0) return { kind: 'usage', error: 'ping needs a message' }
    return { kind: 'ping', message }
  }
  return { kind: 'usage', error: 'unknown subcommand "' + String(head) + '"' }
}
