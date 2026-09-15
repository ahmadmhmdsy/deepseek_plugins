/**
 * The enable/disable gate: one subscription owns the tab lifecycle. Mounts
 * the Editor tab registration while the namespace's resolved value reports
 * enabled:true, withdraws it (slot disposer, including any child declarations)
 * when it reports false, and stays stable across re-flips.
 *
 * Kept as a pure facade over a subscribe callback so tests run without the
 * browser runtime.
 *
 * @module web-file-editor/client/gating
 */
import { VIEW_ID, VIEW_LABEL, VIEW_ORDER, VIEW_SLOT } from './registration.ts'
import { EditorView, type EditorViewInjected } from './EditorView.tsx'

/** The settings face this gate reads (bound settingsScope store). */
export interface EditorSettingsFace {
  /** Read the resolved namespace value. */
  getSnapshot(): { enabled?: boolean }
  /** Subscribe to namespace changes; the return unbinds. */
  subscribe(listener: () => void): () => void
}

/** The mount/unmount actions the gate drives. */
export interface TabMountHandler {
  /** Register the conversation.view tab; returns its disposer. */
  mount: () => () => void
}

/**
 * Drive the tab by the enabled value. Returns the gate's own disposer
 * (unsubscribes and withdraws a mounted tab — stale disposers are no-ops).
 */
export function connectTabGate(store: EditorSettingsFace, mountTab: TabMountHandler['mount']): () => void {
  let disposer: (() => void) | undefined
  const sync = (): void => {
    let enabled = true
    try { enabled = store.getSnapshot().enabled ?? true } catch { /* no UI face yet: keep default */ }
    if (enabled && disposer === undefined) {
      disposer = mountTab()
    } else if (!enabled && disposer !== undefined) {
      disposer()
      disposer = undefined
    }
  }
  sync()
  const unbind = store.subscribe(sync)
  return () => {
    unbind()
    if (disposer !== undefined) disposer()
    disposer = undefined
  }
}

/** Build the framework registration pair from the runtime context's services. */
export function tabMountContext(
  slots: {
    inject(hole: string, factory: () => unknown): void
    register(options: Record<string, unknown>, component: unknown): () => void
  },
  injected: () => EditorViewInjected,
): TabMountHandler['mount'] {
  return () => {
    let d: (() => void) | undefined
    slots.inject(VIEW_SLOT, () => { d = slots.register({
      name: VIEW_SLOT,
      id: VIEW_ID,
      order: VIEW_ORDER,
      label: () => VIEW_LABEL,
      inject: injected as unknown as () => Record<string, never>,
    }, EditorView) })
    return d ?? (() => { /* registration never completed */ })
  }
}
