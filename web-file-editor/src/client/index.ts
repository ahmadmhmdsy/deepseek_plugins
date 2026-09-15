/**
 * Browser half of the file editor plugin (FE-M-A Task 1): registers one
 * 'Editor' tab into the shared conversation.view slot — the same slot the
 * built-in Chat/Trajectory tabs use (proven pattern from
 * ui-trajectory/src/client/index.ts). Unloading the plugin removes the tab
 * (slot effect semantics), which is the future enable/disable path.
 *
 * @module web-file-editor/client
 */
// The conversation.view SlotMap row comes from the local ambient shim
// (src/client/conversation-view.d.ts) in this task; type-only imports are
// erased before the bundle purity gate, so the module is never a value import.
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { EditorView, type EditorViewInjected } from './EditorView.tsx'
import { VIEW_ID, VIEW_LABEL, VIEW_ORDER, VIEW_SLOT } from './registration.ts'

export { VIEW_ID, VIEW_LABEL, VIEW_ORDER, VIEW_SLOT } from './registration.ts'
export { EditorView, type EditorViewInjected } from './EditorView.tsx'

/** Required services: the slot registry only (data hooks arrive with Task 2). */
export const inject = ['slots']

/**
 * Register the editor tab. Registration rides the slot service's effect
 * wrapper, so plugin unload removes the tab.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject(VIEW_SLOT, () => ctx.slots.register({
    name: VIEW_SLOT,
    id: VIEW_ID,
    order: VIEW_ORDER,
    label: () => VIEW_LABEL,
    inject: () => ({}) as EditorViewInjected,
  }, EditorView))
}
