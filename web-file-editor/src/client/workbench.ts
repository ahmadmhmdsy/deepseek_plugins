/**
 * The Monaco workbench (FE-M-A Task 4): the engine is INLINED into the client
 * bundle — the platform loader refuses additional script URLs, so the
 * original 'lazy chunk' plan degrades to lazy INSTANTIATION (the module only
 * creates the editor when a file is actually opened). Recorded as a
 * deviation in HANDOFF §9.
 *
 * @module web-file-editor/client/workbench
 */
// Bundling all contributions (editor.all) pulls every basic-language tokenizer;
// bundling is accepted per the approved Option A.
import * as monaco from 'monaco-editor'
import 'monaco-editor/editor/editor.main.js'
import { installMonacoEnvironment } from './workers.ts'
import type { editor as MonacoEditor } from 'monaco-editor'

/** The engine face tests and the view share. */
export type MonacoApi = typeof monaco

/** Language id for one file extension (monaco ids, plugin-maintained map). */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  json: 'json', jsonc: 'json', json5: 'json',
  css: 'css', scss: 'scss', less: 'less',
  html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
  md: 'markdown', mdx: 'markdown', markdown: 'markdown',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', properties: 'ini',
  py: 'python', pyw: 'python',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  go: 'go', rs: 'rust', java: 'java', kt: 'kotlin',
  c: 'cpp', h: 'cpp', cpp: 'cpp', hpp: 'cpp', cc: 'cpp',
  cs: 'csharp', fs: 'fsharp', scala: 'scala', rb: 'ruby', php: 'php',
  sql: 'sql', graphql: 'graphql', gql: 'graphql', proto: 'protobuf',
  ps1: 'powershell', bat: 'bat', cmd: 'bat',
  lua: 'lua', perl: 'perl', swift: 'swift', dart: 'dart', rs_IN: 'rust',
  hcl: 'hcl', dockerfile: 'dockerfile', makefile: 'makefile',
}
// VS Code does not use 'rs_IN'; drop accidental junk keys politely.
delete (LANGUAGE_BY_EXTENSION as { rs_IN?: string }).rs_IN

/** Trim one rel path's extension (the last dot keeps dotfiles readable). */
export function languageForPath(relPath: string): string {
  const base = relPath.split(/[\\/]/).pop() ?? relPath
  const lastDot = base.lastIndexOf('.')
  if (lastDot <= 0) return base.toLowerCase() === 'dockerfile' ? 'dockerfile' : 'plaintext'
  return LANGUAGE_BY_EXTENSION[base.slice(lastDot + 1).toLowerCase()] ?? 'plaintext'
}

/** One mounted editor pane. */
export interface WorkbenchHandle {
  set(value: string, language: string): void
  dispose(): void
}

/**
 * Create one read-only editor inside the container; workspace-independent.
 * @param container - a detached-or-attached block element.
 */
export function createReadonlyWorkbench(container: HTMLElement): WorkbenchHandle {
  installMonacoEnvironment()
  let current = container
  const inner = document.createElement('div')
  inner.style.height = '100%'
  inner.style.minHeight = '200px'
  container.replaceChildren(inner)
  const instance = monaco.editor.create(inner, {
    value: '',
    language: 'plaintext',
    readOnly: true,
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderLineHighlight: 'all',
    lineNumbers: 'on',
    folding: true,
    fontFamily: 'ui-monospace, monospace',
    fontSize: 12.5,
    wordWrap: 'on',
    contextmenu: false,
  })
  return {
    set(value: string, language: string): void {
      const model = instance.getModel()
      if (model === null) return
      monaco.editor.setModelLanguage(model, language)
      model.setValue(value)
      instance.setScrollTop(0)
    },
    dispose(): void {
      instance.dispose()
      current.replaceChildren()
      current = container
    },
  }
}

export { monaco, type MonacoEditor }
