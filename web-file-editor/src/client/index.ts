/**
 * Browser half of the file editor plugin: registers one 'Editor' tab into the
 * shared conversation.view slot (the same slot the built-in Chat/Trajectory
 * tabs use), GATED by the file-editor settings namespace — disabled removes
 * the tab entirely (and Salesforce-grade: with it, nothing editor-related
 * mounts anywhere).
 *
 * @module web-file-editor/client
 */
// The conversation.view SlotMap row + this gate's settingsScope Context merge
// arrive via type-only import; type imports are erased before the bundle
// purity gate, so the module names are never value imports.
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NS } from '../ns.ts'
import { connectTabGate, tabMountContext } from './gating.ts'

export { VIEW_ID, VIEW_LABEL, VIEW_ORDER, VIEW_SLOT } from './registration.ts'
export { EditorView, type EditorViewInjected } from './EditorView.tsx'
export { connectTabGate, type EditorSettingsFace } from './gating.ts'

/** Required services: slots for the tab; settingsScope for the enable/disable gate. */
export const inject = ['slots', 'settingsScope']

/**
 * Mount the gated editor tab. The slot inject factory is called by the
 * runtime when the slot declaration lands; the gate itself rides the
 * settingsScope store so a later enable/disable flip mounts/withdraws live.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const scope = (ctx as unknown as {
    settingsScope: { bind(opts: { namespace: string }): { getSnapshot(): unknown; subscribe(l: () => void): () => void } }
  }).settingsScope.bind({ namespace: NS })
  ctx.effect(() => connectTabGate({
    getSnapshot: () => scope.getSnapshot() as { enabled?: boolean },
    subscribe: (listener) => scope.subscribe(listener),
  }, tabMountContext(ctx as never as Parameters<typeof tabMountContext>[0])), 'web-file-editor: gated Editor tab')
}
