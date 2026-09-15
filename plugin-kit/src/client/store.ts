/**
 * Minimal SnapshotStore-compatible store — the same { getSnapshot, subscribe,
 * set } contract the renderer's hooks compartment consumes, implemented
 * locally so the client bundle carries zero cross-plugin value imports (the
 * purity gate only ever sees react and this package's own files).
 *
 * Extracted verbatim from web-compact-config/src/client/store.ts (plugin-kit
 * plan K3-2 — the settings-form machinery needs the same contract).
 *
 * @module plugin-kit/client/store
 */

/** The store shape slot components read through a bound use<Name> selector hook. */
export type SnapshotStoreLike<S> = {
  /** Current snapshot (stable reference until the next set). */
  getSnapshot: () => S
  /** Observe snapshot replacements; returns the disposer. */
  subscribe: (listener: () => void) => () => void
  /** Replace the snapshot (no-op when Object.is-equal). */
  set: (next: S) => void
}

/** Create a store holding one immutable snapshot with listener fan-out. */
export function createSnapshotStoreLike<S>(initial: S): SnapshotStoreLike<S> {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next) {
      if (Object.is(snapshot, next)) return
      snapshot = next
      for (const listener of [...listeners]) listener()
    },
  }
}
