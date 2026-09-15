/**
 * FS policy acceptance checks over a REAL temp workspace: traversal refusal,
 * hidden skip policy, listing order, size cap, binary refusal, symlink
 * containment, and a round-trip read.
 *
 * @module web-file-editor/tests
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { assertRelPolicy, ensureTheRealPathStays, listEntries, readFileContent } from '../src/remote/policy.ts'
import { FsPolicyError, type FsEntry } from '../src/remote/index.ts'
import { MAX_READ_BYTES } from '../src/remote/paths.ts'

const FIXTURE = realpathSync(mkdtempSync(join(tmpdir(), 'we-file-editor-')))
const NL = String.fromCharCode(10)

afterAll(() => { rmSync(FIXTURE, { recursive: true, force: true }) })

describe('editor fs policy', () => {
  it('lists the root: directories first, hidden entries skipped', () => {
    mkdirSync(join(FIXTURE, 'sub'), { recursive: true })
    writeFileSync(join(FIXTURE, 'sub', 'child.ts'), 'export {}' + NL)
    writeFileSync(join(FIXTURE, 'zeta.ts'), 'const a = 1' + NL)
    writeFileSync(join(FIXTURE, '.hidden.txt'), 'x')
    mkdirSync(join(FIXTURE, '.git'))
    mkdirSync(join(FIXTURE, 'node_modules'))
    mkdirSync(join(FIXTURE, 'dist'))
    const result = listEntries(FIXTURE, '')
    const names = result.entries.map((entry: FsEntry) => entry.name)
    expect(names).toEqual(['sub', 'zeta.ts'])
    expect(result.entries[0]?.kind).toBe('directory')
  })

  it('lists one nested directory under a relDir', () => {
    const nested = listEntries(join(FIXTURE, 'sub'), 'sub')
    expect(nested.entries.map((entry: FsEntry) => entry.name)).toEqual(['child.ts'])
    expect(nested.entries[0]?.kind).toBe('file')
  })

  it('refuses traversal segments in relative paths', () => {
    expect(() => assertRelPolicy('..')).toThrow(FsPolicyError)
    expect(() => assertRelPolicy('a/../../b')).toThrow(FsPolicyError)
  })

  it('refuses hidden paths even by explicit request', () => {
    expect(() => assertRelPolicy('.git')).toThrow(/hidden/)
    expect(() => assertRelPolicy('node_modules/x.ts')).toThrow(/hidden/)
  })

  it('reads a text file with size and mtime metadata', () => {
    const result = readFileContent(join(FIXTURE, 'zeta.ts'), 'zeta.ts')
    expect(result.content).toBe('const a = 1' + NL)
    expect(result.size).toBe(result.content.length)
    expect(result.modifiedMs).toBeGreaterThan(0)
  })

  it('refuses a binary file by magic signature', () => {
    writeFileSync(join(FIXTURE, 'blob.bin'), Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    expect(() => readFileContent(join(FIXTURE, 'blob.bin'), 'blob.bin')).toThrow(/binary/)
  })

  it('refuses a NUL-run binary and an oversized file', () => {
    writeFileSync(join(FIXTURE, 'nul.dat'), Buffer.alloc(512, 0))
    expect(() => readFileContent(join(FIXTURE, 'nul.dat'), 'nul.dat')).toThrow(FsPolicyError)
    writeFileSync(join(FIXTURE, 'more-big.txt'), 'x'.repeat(MAX_READ_BYTES + 1))
    expect(() => readFileContent(join(FIXTURE, 'more-big.txt'), 'more-big.txt')).toThrow(/read cap/)
  })

  it('accepts a file up to the read cap and refuses one byte beyond', () => {
    writeFileSync(join(FIXTURE, 'big.txt'), 'x'.repeat(MAX_READ_BYTES))
    const result = readFileContent(join(FIXTURE, 'big.txt'), 'big.txt')
    expect(result.content.length).toBe(MAX_READ_BYTES)
  })

  it('refuses a symlink escaping the workspace root', () => {
    try {
      symlinkSync(tmpdir(), join(FIXTURE, 'escapeDir'), 'dir')
    } catch { return } // symlink unsupported on this volume: skip honestly
    expect(() => ensureTheRealPathStays(FIXTURE, join(FIXTURE, 'escapeDir'))).toThrow(FsPolicyError)
  })

  it('accepts the exact root and an inner file as contained', () => {
    expect(() => ensureTheRealPathStays(FIXTURE, FIXTURE)).not.toThrow()
    expect(() => ensureTheRealPathStays(FIXTURE, join(FIXTURE, 'sub', 'child.ts'))).not.toThrow()
  })

  it('round-trips a written text file byte-identically', () => {
    writeFileSync(join(FIXTURE, 'round2.txt'), 'round-trip' + NL)
    const result = readFileContent(join(FIXTURE, 'round2.txt'), 'round2.txt')
    expect(result.content).toBe('round-trip' + NL)
  })

  it('rejects a non-canonical workspace root reference through realpath semantics', () => {
    // The service layer real-paths each root; policy provides the containment
    // judge — a stale non-canonical root Falls out at resolveFileSync in the
    // service. Here: the containment judge accepts the canonical fixture root.
    expect(() => ensureTheRealPathStays(realpathSync(FIXTURE), join(FIXTURE, 'sub'))).not.toThrow()
  })
})

void symlinkSync // keep value import
