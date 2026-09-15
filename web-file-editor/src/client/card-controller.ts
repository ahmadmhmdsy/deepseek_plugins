/**
 * Staged state behind the file-editor settings card: one master switch (the
 * namespace's enabled boolean), read/written live through the bound
 * settingsScope store. Presentation-free; the kit shell renders it.
 *
 * @module web-file-editor/client/card-controller
 */
import { createSnapshotStoreLike, type SnapshotStoreLike } from '../../../plugin-kit/src/client/store.ts'

/** Bound settingsScope face this card needs (loose structural shape). */
export interface EditorScopeFace {
  getSnapshot(): { enabled?: boolean } & Record<string, unknown>
  subscribe(listener: () => void): () => void
  /** @param key - one user-layer key. @param value - the committed value. */
  set(key: string, value: unknown): Promise<void>
}

/** Card state every render reads through the bound hook. */
export interface EditorCardState {
  /** Whether the host served the namespace at all. */
  available: boolean
  enabled: boolean
  /** Last write failed (banner-worthy) and has not been superseded. */
  failed: boolean
}

/** The registration-side face the card's slot entry injects. */
export interface EditorCardFace {
  hooks: {
    card: SnapshotStoreLike<EditorCardState>
  }
  /** Flip the master switch (controller-routed write). */
  toggle: (next: boolean) => void
}

/** The controller: subscribe, project, write 'enabled', republish. */
export class EditorCardController {
  private readonly store: SnapshotStoreLike<EditorCardState>
  private failed = false
  private readonly scope: EditorScopeFace

  /** @param scope - the bound file-editor settings namespace scope. */
  constructor(scope: EditorScopeFace) {
    // Plain assignment order matters: the store initializer reads the scope.
    this.scope = scope
    scope.subscribe(() => { this.publish() })
    this.store = EditorCardController.freshStore(this.project())
  }

  /** Store factory (kept static so construction order stays explicit). */
  private static freshStore<S>(initial: S): SnapshotStoreLike<S> {
    return createSnapshotStoreLike(initial)
  }

  /** Project the card state. */
  private project(): EditorCardState {
    let enabled = true
    let available = true
    try {
      const snapshot = this.scope.getSnapshot()
      if (snapshot === null || typeof snapshot !== 'object') available = false
      else enabled = snapshot.enabled ?? true
    } catch {
      available = false
    }
    return { available, enabled, failed: this.failed }
  }

  private publish(): void {
    this.store.set(this.project())
  }

  /** Flip the master switch; a failed write keeps the failed banner up. */
  public toggle(next: boolean): void {
    void this.scope.set('enabled', next).then(() => {
      this.failed = false
      this.publish()
    }).catch(() => {
      this.failed = true
      this.publish()
    })
  }

  /** The face the slot registration injects per mount. */
  public inject(): EditorCardFace {
    return {
      hooks: { card: this.store },
      toggle: (next: boolean) => { this.toggle(next) },
    }
  }
}
