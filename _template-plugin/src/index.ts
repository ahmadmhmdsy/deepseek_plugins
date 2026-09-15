/**
 * TODO-PLUGIN — smallest useful command-plugin shape, adapted from
 * compact-config-command. Rename every TODO-PLUGIN marker after copying this
 * directory (README.md has the checklist), then wire the copy into
 * cordis.patch.yml and run docs/best-practices/plugin-checklist.md.
 *
 * @module TODO-PLUGIN
 */
import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { parseArgs } from './parse.ts'

/** TODO-PLUGIN: package name AND loader entry id — keep both in sync. */
export const name = 'TODO-PLUGIN'

/**
 * Services this plugin wants injected into apply()'s context. 'commands'
 * registers a chat command; add other services only after proving the seam
 * exists on BOTH target checkouts (AGENTS.md §4.7, MEMORY.md §2).
 */
export const inject = ['commands']

/**
 * Composition-level plugin options — declared here, passed via the
 * cordis.patch.yml 'config' row. Empty in the example; add a schemastery
 * z.object when the plugin takes real options.
 */

export function apply(ctx: Context): void {
  const handler = async (invocation: CommandInvocation): Promise<CommandResult> => {
    try {
      const request = parseArgs(invocation.rawInput)
      if (request.kind === 'usage') {
        return { kind: 'error', text: 'error: ' + (request.error ?? 'bad input') + '\n' + 'Usage: /TODO-PLUGIN ping <message>' }
      }
      // TODO-PLUGIN: replace the demo behavior with the real work. Validate
      // through one parser, never write state ad hoc (best-practices guide §3).
      return { kind: 'success', text: 'ping ok: ' + request.message }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      return { kind: 'error', text: 'error: ' + message + '\n' + 'Usage: /TODO-PLUGIN ping <message>' }
    }
  }

  // ctx.effect: registration rides the plugin lifecycle — teardown on stop
  // is automatic; never manage registry unsubscription manually.
  ctx.effect(function* () {
    yield ctx.commands.register({
      name: 'TODO-PLUGIN', // TODO-PLUGIN: the verb users type after the slash
      description: 'TODO-PLUGIN: replace me',
      handler,
    })
  }, 'TODO-PLUGIN lifecycle')
}
