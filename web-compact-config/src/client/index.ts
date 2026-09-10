/**
 * Browser half of the compact-handoff settings card: binds the namespace
 * scope and registers one card into the plugins settings' shared
 * `settings.plugin.item` slot, keyed by the namespace it edits.
 *
 * @module web-compact-config/client
 */
// Type-only: the settings slot declarations plus the ctx.settingsScope Context
// merge. Value imports stay bundled-local (client bundle purity gate).
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { CompactConfigCardController } from './controller.ts'
import type { HandoffSettings } from './controller.ts'
import { CompactConfigCard } from './Card.tsx'

export const inject = ['slots', 'connection', 'remote', 'settingsScope']

/**
 * Mount the compact-handoff card.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const controller = new CompactConfigCardController(
    ctx.settingsScope.bind<HandoffSettings>({ namespace: 'compact-handoff' }),
  )
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: 'compact-handoff',
    inject: () => controller.inject(),
  }, CompactConfigCard))
}
