/**
 * Workspace-root containment and file-type policy for the editor fs service.
 * Pure helpers (path-relative, no direct fs): the Host service feeds real
 * paths, the tests feed fakes.
 *
 * Rules (FE-M-A Task 3 agreed design):
 * - every request path is resolved, then real-path checked to stay inside the
 *   workspace root (symlink escape refused);
 * - hidden default-skip: dot-names, node_modules, dist — never listed;
 * - reads beyond the byte cap are refused with a dedicated error code;
 * - binary magic signatures are sniffed on the first bytes.
 *
 * @module web-file-editor/remote/paths
 */
import { relative, sep } from 'node:path'
import { lstatSync, realpathSync } from 'node:fs'
import type { Stats } from 'node:fs'

/** Maximum bytes one read() may serve (Monaco chokes beyond this size class). */
export const MAX_READ_BYTES = 8 * 1024 * 1024

/** Names never listed even when they exist inside the root. */
const SKIP_NAMES = new Set(['node_modules', 'dist', '.git', '.dsh'])

/** Whether a directory entry is skipped by the default visibility policy. */
export function isDefaultHiddenEntry(name: string): boolean {
  return name.startsWith('.') || SKIP_NAMES.has(name)
}

/**
 * Canonical workspace root: fs.realpath of the registered path. Divergence
 * between the two means a stale registration; refuse rather than guess.
 */
export function workspaceRootReal(workspace: { path: string }): string {
  const real = realpathSync(workspace.path)
  if (real !== workspace.path) {
    throw new Error('file-editor: workspace root is not canonical (resolves to "' + real + '")')
  }
  return real
}

/** Whether the target's real path stays inside the root (exact or below). */
export function contained(rootReal: string, target: string): boolean {
  let targetReal: string
  try {
    lstatSync(target) // existence required for containment; caller handles ENOENT
    targetReal = realpathSync(target)
  } catch {
    return false
  }
  const rel = relative(rootReal, targetReal)
  return rel === '' || (rel !== '' && !rel.startsWith('..') && !rel.split(sep).includes('..'))
}

/** Whether the buffered head marks a binary file (magic bytes or NUL run). */
export function isBinaryHead(head: Buffer): boolean {
  if (head.length === 0) return false
  // Common container magics a text editor has no business opening.
  if (head[0] === 0x50 && head[1] === 0x4b) return true            // zip family
  if (head[0] === 0x25 && head[1] === 0x50) return true            // %PDF
  if (head[0] === 0x89 && head[1] === 0x50) return true            // PNG
  if (head[0] === 0xff && head[1] === 0xd8) return true            // JPEG
  if (head[0] === 0x1f && head[1] === 0x8b) return true            // gzip
  if (head[0] === 0x4d && head[1] === 0x5a) return true            // MZ (exe)
  if (head[0] === 0x7f && head[1] === 0x45) return true            // ELF
  // Heuristic NUL run: binary executables and media produce one early.
  for (let i = 0; i < Math.min(head.length, 64); i++) {
    if (head[i] === 0) return true
  }
  return false
}
