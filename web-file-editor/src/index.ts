/**
 * Host half of the file editor plugin (M-A Task 1): today only the plugin
 * identity and composition options. The REAL behaviors planned for M-A
 * (settings namespace with an enabled flag, a host-side Cordis fs service for
 * lazy directory listing + file reads, workspace-root allowlisting) land with
 * FE-M-A Tasks 2+ (plan: docs/superpowers/plans/2026-09-14-file-editor-plugin.md).
 *
 * @module web-file-editor
 */
import type { Context } from '@deepseek-ai/cordis'

/** Plugin short name (also the loader entry id). */
export const name = 'web-file-editor'

/** The settings namespace this plugin registers from FE-M-A Task 2 onward. */
export const NS = 'file-editor'

/** Composition-level plugin options (reserved; validated in Task 2). */
export interface EditorConfig {}

export const Config = {}

/**
 * Mount the host half. A no-op until Task 2; exists so the package main
 * resolves through the same source-loading path as the other plugins.
 * @param ctx - plugin context.
 */
export function apply(ctx: Context): void {
  void ctx
}
