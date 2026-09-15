/**
 * Pure policy engine for the file-editor fs service: path/visibility rules
 * plus the two disk readers the Remote face delegates to. Tested over a REAL
 * temp workspace (realpath/traversal/hidden/size/binary/ordering).
 *
 * @module web-file-editor/remote/policy
 */
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync, type Stats } from 'node:fs'
import { join } from 'node:path'
import { MAX_READ_BYTES, contained, isBinaryHead, isDefaultHiddenEntry } from './paths.ts'
import { FsPolicyError } from './index.ts'

/** The workspace anchor the policy engine needs (registry row). */
export interface WorkspaceAnchorLike {
  /** Canonical registered workspace path. */
  readonly path: string
}

/** List one already-authorized directory; entries sorted directories-first. */
export function listEntries(absDir: string, relDir: string): ListValue {
  let names: readonly string[] = []
  try {
    names = readdirSync(absDir)
  } catch (error) {
    throw new FsPolicyError('not-found', 'unreadable directory: ' + String(error))
  }
  const entries: FsEntry[] = []
  for (const name of names) {
    if (isDefaultHiddenEntry(name)) continue
    const full = join(absDir, name)
    const stats = statQuiet(full)
    if (stats === undefined) continue
    entries.push({
      name,
      kind: stats.isDirectory() ? 'directory' : 'file',
      size: stats.size,
      modifiedMs: stats.mtimeMs,
    })
  }
  entries.sort(byDirThenName)
  return { relDir, entries }
}

/** Read one already-authorized file (size cap + binary head refusal). */
export function readFileContent(abs: string, relPath: string): ReadValue {
  try {
    const lstats = lstatSync(abs)
    if (lstats.isDirectory()) throw new FsPolicyError('outside-root', 'path is a directory')
    if (!lstats.isFile()) throw new FsPolicyError('outside-root', 'path is not a regular file')
    if (lstats.size > MAX_READ_BYTES) {
      throw new FsPolicyError('too-large', 'file exceeds the ' + MAX_READ_BYTES + ' byte read cap')
    }
    const size = lstats.size
    const modifiedMs = statSync(abs).mtimeMs
    const buffer = readFileSync(abs)
    if (isBinaryHead(buffer.subarray(0, Math.min(buffer.length, 512)))) {
      throw new FsPolicyError('binary', 'file is binary (by magic/head sniff)')
    }
    return { relPath, size, modifiedMs, content: buffer.toString('utf8') }
  } catch (error) {
    if (error instanceof FsPolicyError) throw error
    throw new FsPolicyError('not-found', 'unreadable path: ' + String(error))
  }
}

/** Workspace-relative traversal/hide policy check (checked BEFORE root resolve). */
export function assertRelPolicy(rel: string): void {
  const segments = rel === '' ? [] : rel.split(/[\\/]/)
  if (segments.includes('..')) {
    throw new FsPolicyError('outside-root', 'relative path contains ".."')
  }
  for (const segment of segments) {
    if (isDefaultHiddenEntry(segment)) {
      throw new FsPolicyError('hidden', 'path is hidden by the default visibility policy')
    }
  }
}

/**
 * Patient symlink-escape check: the target's real path must stay inside the
 * root. A missing target is left to the caller's fs error path (containment
 * is moot for nonexistent targets).
 */
export function ensureTheRealPathStays(rootReal: string, abs: string): void {
  let realTarget: string
  try {
    realTarget = realpathSync(abs)
  } catch {
    return
  }
  if (realTarget !== abs && !contained(rootReal, realTarget)) {
    throw new FsPolicyError('outside-root', 'path resolves outside the workspace root')
  }
}

/** Sorted order: directories first, then by name. */
function byDirThenName(a: FsEntry, b: FsEntry): number {
  if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
}

function statQuiet(targetPath: string): Stats | undefined {
  try {
    return statSync(targetPath)
  } catch {
    return undefined
  }
}

interface FsEntry {
  readonly name: string
  readonly kind: 'file' | 'directory'
  readonly size: number
  readonly modifiedMs: number
}
interface ListValue {
  readonly relDir: string
  readonly entries: readonly FsEntry[]
}
interface ReadValue {
  readonly relPath: string
  readonly size: number
  readonly modifiedMs: number
  readonly content: string
}
