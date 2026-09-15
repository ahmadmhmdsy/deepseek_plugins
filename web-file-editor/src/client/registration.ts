/**
 * Registration constants of the file editor tab, shared between the client
 * half and tests (single home, no drift between registration and specs).
 *
 * @module web-file-editor/client/registration
 */

/** The conversation view slot the editor tab registers into (same slot as Chat/Trajectory). */
export const VIEW_SLOT = 'conversation.view'

/** Stable id of the editor view entry (targetable via openView('editor', …)). */
export const VIEW_ID = 'editor'

/** Order after Trajectory (order 10); Chat/Trajectory live below this order band. */
export const VIEW_ORDER = 15

/** The tab label thunk returns this string until locale dictionaries land. */
export const VIEW_LABEL = 'Editor'
