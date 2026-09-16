/**
 * Browser half of the file editor plugin: registers one 'Editor' tab into the
 * shared conversation.view slot (the same slot the built-in Chat/Trajectory
 * tabs use), GATED by the file-editor settings namespace — disabled removes
 * the tab entirely (and with it, nothing editor-related mounts anywhere).
 *
 * The tab's data plane rides the mounted 'fileEditor' Remote namespace
 * (fs-remote.ts); the workspaces rows come from the runtime's
 * ctx.workspaces.list snapshot.
 *
 * @module web-file-editor/client
 */
// Type-only client imports: their module names are erased before the bundle
// purity gate, so only platform VALUE imports ever remain in lib/client.js.
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NS } from '../ns.ts'
import { connectTabGate, tabMountContext } from './gating.ts'
import type { EditorFsFace } from './fs-remote.ts'
import { faceForRemote, fileEditorFsContribution, FS_NAMESPACE } from './fs-remote.ts'
import { EditorView } from './EditorView.tsx'
import { EditorCardController, type EditorScopeFace } from './card-controller.ts'
import { EditorSettingsCard } from './SettingsCard.tsx'

export { VIEW_ID, VIEW_LABEL, VIEW_ORDER, VIEW_SLOT } from './registration.ts'
export { EditorView, type EditorViewInjected, type EditorViewProps, type SnapshotSelectorHook, type WorkspaceRowFace } from './EditorView.tsx'
export { createReadonlyWorkbench, languageForPath, type WorkbenchHandle } from './workbench.ts'
export { EditorSettingsCard } from './SettingsCard.tsx'
export { EditorCardController, type EditorCardFace, type EditorCardState } from './card-controller.ts'
export { connectTabGate, type EditorSettingsFace } from './gating.ts'
export { faceForRemote, fileEditorFsContribution, FS_NAMESPACE, FS_SERVICE_KEY } from './fs-remote.ts'

/** Required services: slots for the tab; settingsScope for the gate; remote carries $mount and workspaces feeds the tree. The mounted namespace ('remote.fileEditor') is NOT inject-declared — it does not exist until this plugin's own $mount creates it (a declared waitable key would park the whole boot). */
export const inject = ['slots', 'settingsScope', 'remote', 'workspaces']

/** Loose client-context merge this plugin actually touches. */
type EditorClientContext = ClientContext & {
  /** Client workspaces service (ctx.workspaces.list snapshot rows). */
  readonly workspaces?: {
    readonly list: {
      getSnapshot(): { items?: readonly { workspaceId: string; title: string; path: string }[] }
      subscribe(listener: () => void): () => void
    }
  }
  /** Client Typed Remote service ($mount installs namespace handles). */
  readonly remote?: {
    $mount(contribution: unknown): Promise<() => Promise<void>>
  }
}

/**
 * Mount the gated editor tab plus its fileEditor Remote data plane. Each
 * mounts independently: a profile without the Remote carrier still renders
 * the busy placeholder, and disabling the setting withdraws the tab.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  const editor = ctx as EditorClientContext

  // Data plane: mount the strict contribution for the whole plugin lifetime;
  // faceForRemote succeeds once the namespace handle exists. The mount is
  // ASYNC: the view learns about it through the fs hook source (the renderer
  // memoizes a static inject face at first evaluation, which lands before
  // the mount resolves and would pin the busy placeholder forever).
  const fsListeners = new Set<() => void>()
  let fsFace: EditorFsFace | undefined
  const ensureFace = (): EditorFsFace | undefined => {
    if (fsFace === undefined) {
      const viewer = editor as unknown as { get?(key: string): unknown }
      const namespace = viewer.get?.('remote.' + FS_NAMESPACE) as
        | Record<string, unknown>
        | undefined
      if (namespace === undefined) return undefined // not mounted yet: keep the busy placeholder
      fsFace = faceForRemote({ [FS_NAMESPACE]: namespace })
    }
    return fsFace
  }
  const emitFs = (): void => { for (const listener of fsListeners) listener() }
  ctx.effect(async (): Promise<() => void> => {
    const mount = editor.remote?.$mount(fileEditorFsContribution())
    if (mount === undefined) return () => { /* no Remote carrier in this profile */ }
    const dispose = await mount
    fsFace = ensureFace()
    emitFs()
    return async () => { await dispose() }
  }, 'web-file-editor: fileEditor Remote mount')

  const fsSource = {
    getSnapshot: () => ensureFace(),
    subscribe: (listener: () => void) => {
      fsListeners.add(listener)
      return () => { fsListeners.delete(listener) }
    },
  }
  // Rows ride the runtime's own store snapshot (stable identity until the
  // list store writes), so the hook never loops on a fresh array literal.
  const EMPTY_ROWS: readonly { workspaceId: string; title: string; path: string }[] = []
  const workspacesSource = {
    getSnapshot: () => {
      const items = workspacesRows(editor)
      return items.length === 0 ? EMPTY_ROWS : items
    },
    subscribe: (listener: () => void) => editor.workspaces?.list.subscribe(listener) ?? (() => undefined),
  }

  const injected = () => ({
    hooks: { fs: fsSource, workspaces: workspacesSource },
  })

  const scope = (editor as unknown as {
    settingsScope: { bind(opts: { namespace: string }): { getSnapshot(): unknown; subscribe(l: () => void): () => void } }
  }).settingsScope.bind({ namespace: NS })
  // Settings card: one head-switch card in the plugins settings slot, sharing
  // the same bound scope as the tab gate (both react to namespace flips).
  const cardController = new EditorCardController(scope as unknown as EditorScopeFace)
  const slotsBinding = (editor as unknown as Record<string, unknown>).slots as {
    inject(hole: string, factory: () => unknown): void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
  ctx.effect(() => {
    slotsBinding.inject('settings.plugin.item', () => slotsBinding.register({
      name: 'settings.plugin.item',
      key: NS,
      inject: () => cardController.inject(),
    }, EditorSettingsCard))
    return () => { /* slot disposer handled by the registration row itself */ }
  }, 'web-file-editor: settings card')
  ctx.effect(() => connectTabGate({
    getSnapshot: () => scope.getSnapshot() as { enabled?: boolean },
    subscribe: (listener) => scope.subscribe(listener),
  }, tabMountContext(slotsBinding as never as Parameters<typeof tabMountContext>[0], injected, EditorView)), 'web-file-editor: gated Editor tab')
}

function workspacesRows(editor: EditorClientContext): readonly { workspaceId: string; title: string; path: string }[] {
  try {
    return editor.workspaces?.list.getSnapshot().items ?? []
  } catch {
    return []
  }
}
