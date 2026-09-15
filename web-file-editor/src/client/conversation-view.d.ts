/**
 * Local type shim for the conversation view slot row — FE-M-A Task 1.
 *
 * The vendor sources declare the row inside '@deepseek-ai/dsh-client-ui-conversation/client',
 * whose transitive type imports (attachment, session-controller, ui-session …)
 * are NOT in this workspace's tsconfig facade (ui-session /
 * api-session-controller / store are absent on the RUN target; pulling the
 * chain exploded the typecheck into ~30 vendor errors). This shim:
 * 1. augments '@deepseek-ai/dsh-client-ui-slots' with the 'conversation.view'
 *    SlotMap row (the same global SlotMap the vendor shims augment);
 * 2. grants the 'conversation.view' runtime prop face our view and
 *    registration consume as a named export of the conversation client
 *    module specifier.
 *
 * FE-M-A Task 2 (tree + workbench) reassesses whether the full facade chain
 * is worth road-mapping; until then the shim keeps the typecheck local to
 * what the plugin actually uses.
 *
 * @module web-file-editor/client/conversation-view
 */

/** Owner share of a conversation.view entry (local subset mirroring the vendor owner). */
interface ConversationViewRequest {
    /** The targeted conversation view entry id. */
    view: string
    /** Opaque focus identity (stub: a file path in Task 2+; 'callId' for trajectory). */
    focus: string
  }

interface ConversationViewOwnerProps {
    /** Focus request addressed to the selected view. */
    viewRequest: ConversationViewRequest | null
    /** Select a view and address one opaque focus identity to it. */
    openView: (view: string, focus: string) => void
    /** Acknowledge the current one-shot focus request. */
    completeViewRequest: () => void
  }

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Registered conversation target views, rendered one at a time. Mirrors the vendor owner row. */
    'conversation.view': { kind: 'list'; scope: 'session'; owner: ConversationViewOwnerProps }
  }
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  /** Runtime props of one conversation view entry (local subset). */
  type ConvViewProps = import('@deepseek-ai/dsh-client-ui-slots').PropsRuntime<'conversation.view'>
  export { ConvViewProps }
}
