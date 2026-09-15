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
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { NS } from '../ns.ts'
import { connectTabGate, tabMountContext } from './gating.ts'
import { faceForRemote, fileEditorFsContribution } from './fs-remote.ts'
import { EditorView } from './EditorView.tsx'

export { VIEW_ID, VIEW_LABEL, VIEW_ORDER, VIEW_SLOT } from './registration.ts'
export { EditorView, type EditorViewInjected, type WorkspaceRowFace } from './EditorView.tsx'
export { createReadonlyWorkbench, languageForPath, type WorkbenchHandle } from './workbench.ts'
export { connectTabGate, type EditorSettingsFace } from './gating.ts'
export { faceForRemote, fileEditorFsContribution, FS_NAMESPACE, FS_SERVICE_KEY } from './fs-remote.ts'

/** Required services: slots for the tab; settingsScope for the gate. */
export const inject = ['slots', 'settingsScope']

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
  // faceForRemote succeeds once the namespace handle exists.
  ctx.effect(async (): Promise<() => void> => {
    const mount = editor.remote?.$mount(fileEditorFsContribution())
    if (mount === undefined) return () => { /* no Remote carrier in this profile */ }
    const dispose = await mount
    return async () => { await dispose() }
  }, 'web-file-editor: fileEditor Remote mount')

  const ensureFace = (): ReturnType<typeof faceForRemote> | undefined => {
    try {
      return faceForRemote(editor.remote as unknown as Record<string, unknown>)
    } catch {
      return undefined // namespace not mounted yet: keep the busy placeholder
    }
  }

  const injected = () => ({
    fs: ensureFace(),
    workspaces: workspacesRows(editor),
  })

  const scope = (editor as unknown as {
    settingsScope: { bind(opts: { namespace: string }): { getSnapshot(): unknown; subscribe(l: () => void): () => void } }
  }).settingsScope.bind({ namespace: NS })
  ctx.effect(() => connectTabGate({
    getSnapshot: () => scope.getSnapshot() as { enabled?: boolean },
    subscribe: (listener) => scope.subscribe(listener),
  }, tabMountContext((editor as unknown as Record<string, unknown>).slots as never as Parameters<typeof tabMountContext>[0], injected, EditorView)), 'web-file-editor: gated Editor tab')
}

function workspacesRows(editor: EditorClientContext): readonly { workspaceId: string; title: string; path: string }[] {
  try {
    return editor.workspaces?.list.getSnapshot().items ?? []
  } catch {
    return []
  }
}
