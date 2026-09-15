/**
 * Registration constants and the delivered client bundle contract (loader
 * banner, package id, platform-external shape). Since FE-M-A Task 4 the
 * bundle inlines the Monaco engine, so the size cap (former stub check)
 * became an LOWER-bound presence check plus the exact-sized engine marker.
 *
 * @module web-file-editor/tests
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { VIEW_ID, VIEW_LABEL, VIEW_ORDER, VIEW_SLOT } from '../src/client/registration.ts'

const HERE = fileURLToPath(import.meta.url)
const BUNDLE = join(dirname(HERE), '..', 'lib', 'client.js')

describe('web-file-editor registration constants', () => {
  it('targets the conversation.view slot after Trajectory', () => {
    expect(VIEW_SLOT).toBe('conversation.view')
    expect(VIEW_ID).toBe('editor')
    expect(VIEW_ORDER).toBeGreaterThan(10)
    expect(VIEW_LABEL.length).toBeGreaterThan(0)
  })

  it('delivers a loader-banner CJS bundle under lib/client.js', () => {
    expect(existsSync(BUNDLE), 'bundle built (run tsdown before patched boot)').toBe(true)
    const source = readFileSync(BUNDLE, 'utf8')
    expect(source.includes('window.__ModuleLoader__.load(')).toBe(true)
    expect(source.includes('web-file-editor')).toBe(true)
    // externals: the platform module table provides react (inlined react would bloat)
    expect(source.includes('require("react/jsx-runtime")')).toBe(true)
    expect(source.includes('var module = { exports: {} };')).toBe(true)
    // the reader workbench: the monaco engine is inlined (no external require may remain)
    expect(source.length).toBeGreaterThan(100000)
    expect(source.includes('require("monaco-editor')).toBe(false)
    expect(source.includes('MonacoEnvironment')).toBe(true)
  })
})
