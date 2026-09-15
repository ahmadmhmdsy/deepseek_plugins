/**
 * Host fs service for the file editor — one Remote wire namespace
 * ('fileEditor') reachable from the browser, backed by the workspace registry
 * for root authorization. The class is a THIN Typert face: all policy and
 * disk contact lives in ./policy.ts (unit-tested over a real temp workspace).
 *
 * Containment policy: every request resolves under the workspace's canonical
 * root; traversal segments are refused outright, real-path divergence
 * (symlink escape) is refused. Default-hidden paths/entries are never served.
 * Reads enforce the byte cap and the binary refusal.
 *
 * @module web-file-editor/remote
 */
import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import {
  assertRelPolicy,
  ensureTheRealPathStays,
  listEntries,
  readFileContent,
} from './policy.ts'

/** Descriptor of a listed tree entry (JSON-safe wire shape). */
export interface FsEntry {
  readonly name: string
  readonly kind: 'file' | 'directory'
  readonly size: number
  /** Last modification (ms epoch), FE-M-B conflict-detection groundwork. */
  readonly modifiedMs: number
}

/** Wire request: list a workspace-relative directory. */
export interface ListRequest {
  readonly workspaceId: string
  /** Workspace-relative directory; '' lists the root. */
  readonly relDir?: string
}

/** Wire value of list(). */
export interface ListValue {
  readonly relDir: string
  readonly entries: readonly FsEntry[]
}

/** Wire request: read a workspace-relative file. */
export interface ReadRequest {
  readonly workspaceId: string
  /** Workspace-relative file path. */
  readonly relPath: string
}

/** Wire value of read(). */
export interface ReadValue {
  readonly relPath: string
  readonly size: number
  readonly modifiedMs: number
  /** UTF-8 content (never silently truncated: oversized files refuse). */
  readonly content: string
}

/** Structured failure the UI and tests branch on. */
export class FsPolicyError extends Error {
  override readonly name = 'FsPolicyError'

  /**
   * @param code - stable policy code the client and tests branch on.
   * @param message - human-readable detail.
   */
  constructor(
    readonly code: 'outside-root' | 'too-large' | 'binary' | 'hidden' | 'not-found' | 'no-workspace',
    message: string,
  ) {
    super('file-editor: ' + message)
  }
}

/** Minimal workspace registry face (the real ctx.workspaceRegistry provides it). */
export interface WorkspaceRegistryFace {
  /** @param id - workspace id. @returns the canonical row or undefined. */
  get(id: string): { readonly path: string } | undefined
}

/** The file-editor Remote service ('fileEditor' wire namespace). */
export class FileEditorFs extends TypertRemoteService {
  static inject = ['workspaceRegistry']

  /**
   * @param ctx - Host context carrying the Workspace registry.
   */
  constructor(ctx: Context) {
    super(ctx, 'fileEditorFs', { namespace: 'fileEditor' })
  }

  private registry(): WorkspaceRegistryFace {
    const registry = this.ctx.get('workspaceRegistry') as WorkspaceRegistryFace | undefined
    if (registry === undefined) throw new FsPolicyError('no-workspace', 'workspace registry not mounted')
    return registry
  }

  /** Resolve + hide-policy-validate one workspace-relative path, containment-checked. */
  private toAbs(workspaceId: string, rel: string): string {
    assertRelPolicy(rel)
    const workspace = this.registry().get(workspaceId)
    if (workspace === undefined) {
      throw new FsPolicyError('no-workspace', 'workspace "' + workspaceId + '" is not registered')
    }
    const rootReal = realpathSync(workspace.path)
    const abs = join(rootReal, ...rel.split(/[\\/]/))
    // Symlink-escape guard: the joined path must real-path back inside the root.
    ensureTheRealPathStays(rootReal, abs)
    return abs
  }

  /** List one directory of the workspace (directories first, hidden skipped). */
  @Remote('list')
  list(request: ListRequest): ListValue {
    const relDir = request.relDir ?? ''
    const result = listEntries(this.toAbs(request.workspaceId, relDir), relDir)
    return { relDir, entries: result.entries }
  }

  /** Read one UTF-8 file of the workspace with the size and binary caps. */
  @Remote('read')
  read(request: ReadRequest): ReadValue {
    return readFileContent(this.toAbs(request.workspaceId, request.relPath), request.relPath)
  }
}
