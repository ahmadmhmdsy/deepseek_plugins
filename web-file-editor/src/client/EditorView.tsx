/**
 * The Editor tab workbench (FE-M-A Task 3b, read-only phase): a
 * workspace-scoped explorer tree on the left, the selected file's content on
 * the right. The Monaco chunk replaces the plain text pane in Task 4; the
 * tree/read flow here is the stable shell around it.
 *
 * Data flow: the registration's inject face carries hooks: sources —
 * useFs (the mounted fileEditor Remote face, undefined until the async
 * $mount resolves) and useWorkspaces (the client runtime's workspace rows);
 * entries and file contents ride the face's list()/read().
 *
 * @module web-file-editor/client/EditorView
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { EditorFsFace, FsEntryWire, FsReadResult } from './fs-remote.ts'
import { createReadonlyWorkbench, languageForPath, type WorkbenchHandle } from './workbench.ts'
import { TOKENS } from '../../../plugin-kit/src/client/chrome.tsx'

/**
 * Snapshot selector hook the slot renderer binds to the inject face's
 * `hooks:` sources (standardHookPropName renames 'fs'/'workspaces' into the
 * useFs/useWorkspaces props). Structural twin of the renderer's hook
 * contract — no value import needed.
 */
export type SnapshotSelectorHook<T> = <R>(select: (value: T) => R) => R

/** Injection face the tab registration passes per mount: observable sources. */
export interface EditorViewInjected {
  hooks: {
    /** The mounted fileEditor Remote namespace face (undefined until mounted). */
    fs: { getSnapshot(): EditorFsFace | undefined; subscribe(listener: () => void): () => void }
    /** Workspace rows the tab offers as tree roots. */
    workspaces: { getSnapshot(): readonly WorkspaceRowFace[]; subscribe(listener: () => void): () => void }
  }
}

/** The hook props the renderer feeds back into this component. */
export interface EditorViewProps {
  useFs?: SnapshotSelectorHook<EditorFsFace | undefined>
  useWorkspaces?: SnapshotSelectorHook<readonly WorkspaceRowFace[]>
}

/** Minimal workspace row the tree roots off (client runtime projections). */
export interface WorkspaceRowFace {
  readonly workspaceId: string
  readonly title: string
  readonly path: string
}

/** Per-directory expansion state (keyed by workspaceId + '#' + relDir). */
interface DirState {
  readonly expanded: boolean
  readonly loading: boolean
  readonly entries: readonly FsEntryWire[]
  readonly error: string | undefined
}

const EMPTY_DIR: DirState = { expanded: false, loading: false, entries: [], error: undefined }

const containerStyle: CSSProperties = {
  display: 'flex', flexDirection: 'row', height: '100%', minHeight: 240,
  gap: 8, overflow: 'hidden',
}
const treePaneStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6, flex: '0 0 auto',
  width: 300, minWidth: 200, overflow: 'hidden',
}
const treeScrollStyle: CSSProperties = {
  overflowY: 'auto', overflowX: 'hidden', minWidth: 0,
  borderInlineEnd: '1px solid ' + TOKENS.border, paddingInlineEnd: 8,
}
const contentStyle: CSSProperties = {
  flex: '1 1 auto', minWidth: 320, overflow: 'auto',
  background: TOKENS.disabledBackground, borderRadius: 6, padding: 8,
}
const rowStyle: CSSProperties = {
  display: 'block', width: '100%', cursor: 'pointer', padding: '2px 6px',
  borderRadius: 4, overflowWrap: 'anywhere', textAlign: 'start',
  border: 'none', background: 'transparent', font: 'inherit', fontSize: 13,
  transition: 'background-color 120ms ease',
}
const rowSelectedStyle: CSSProperties = {
  ...rowStyle,
  background: 'rgba(127,127,127,0.18)',
  boxShadow: 'inset 2px 0 0 ' + TOKENS.accent,
}
const titleStyle: CSSProperties = { fontSize: 15, fontWeight: 600, margin: 0 }
const hintStyle: CSSProperties = { fontSize: 12, opacity: 0.7, margin: 0 }
const preStyle: CSSProperties = {
  fontSize: 12.5, margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace', lineHeight: 1.5,
}
const errorStyle: CSSProperties = {
  fontSize: 13,
  color: TOKENS.danger,
  background: TOKENS.dangerSoft,
  border: '1px solid ' + TOKENS.danger,
  borderRadius: 6,
  padding: '7px 10px',
  margin: '6px 0',
  lineHeight: 1.45,
}
const emptyHintStyle: CSSProperties = {
  fontSize: 12, color: TOKENS.textMuted, padding: '2px 6px 2px 24px',
}

const COLLAPSED = String.fromCharCode(0x25b8) + ' '
const EXPANDED = String.fromCharCode(0x25be) + ' '

/**
 * Hover/focus-visible style for tree rows. Inline styles cannot express
 * `:hover` / `:focus-visible` pseudo-classes; install a tiny scoped rule
 * exactly once per Editor mount. Class `editor-tree-row` is unique enough
 * that the rule cannot leak into other plugin rows.
 */
const TREE_ROW_HOVER_RULE =
  '.editor-tree-row:hover:not([aria-selected="true"]){background:rgba(127,127,127,0.08)}' +
  '.editor-tree-row:focus-visible{outline:2px solid ' + TOKENS.accent + ';outline-offset:-2px}'

function dirKey(workspaceId: string, relDir: string): string {
  return workspaceId + '#' + relDir
}

type FileUiState = DirState & { readonly read: FsReadResult | undefined }

/**
 * The Editor tab workbench.
 * @param props - conversation view runtime props plus our injection face
 *   (the renderer mines the face's hooks: sources into useFs/useWorkspaces
 *   props — the inject cache alone would freeze a static face at the
 *   pre-mount snapshot and the tab would never leave its busy placeholder).
 */
export function EditorView(props: ConvViewProps & EditorViewProps): JSX.Element {
  // Hook-source presence is stable per registration; the early-return
  // fallbacks only shield a hypothetical face missing its hooks key.
  const fs = props.useFs === undefined ? undefined : props.useFs(value => value)
  const workspaces = props.useWorkspaces === undefined ? undefined : props.useWorkspaces(value => value)
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => workspaces?.[0]?.workspaceId ?? null)
  const [dirs, setDirs] = useState<Record<string, DirState>>({})
  const [file, setFile] = useState<{ readonly relPath: string; readonly state: FileUiState } | undefined>(undefined)

  // Install the tree-row hover/focus rule once per mount. Inline styles
  // cannot express pseudo-classes, so this is the kit-consistent way.
  useEffect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-editor-tree-row-styles', '1')
    style.textContent = TREE_ROW_HOVER_RULE
    document.head.appendChild(style)
    return () => { style.remove() }
  }, [])

  const effectiveWorkspace = workspaceId ?? workspaces?.[0]?.workspaceId ?? null

  const toggleDir = (wid: string, relDir: string): void => {
    if (fs === undefined) return
    const key = dirKey(wid, relDir)
    const current = dirs[key]
    if (current !== undefined && current.expanded) {
      setDirs(map => ({ ...map, [key]: { ...EMPTY_DIR, expanded: false } }))
      return
    }
    setDirs(map => ({ ...map, [key]: { expanded: true, loading: true, entries: [], error: undefined } }))
    fs.list(wid, relDir === '' ? undefined : relDir)
      .then(result => { setDirs(map => ({ ...map, [key]: { expanded: true, loading: false, entries: result.entries, error: undefined } })) })
      .catch(error => { setDirs(map => ({ ...map, [key]: { expanded: true, loading: false, entries: [], error: String(error) } })) })
  }

  const openFile = (wid: string, relPath: string): void => {
    if (fs === undefined) return
    setFile({ relPath, state: { ...EMPTY_DIR, expanded: true, loading: true, read: undefined } })
    fs.read(wid, relPath)
      .then(result => { setFile({ relPath, state: { ...EMPTY_DIR, expanded: true, loading: false, read: result } }) })
      .catch(error => { setFile({ relPath, state: { ...EMPTY_DIR, expanded: true, loading: false, read: undefined, error: String(error) } }) })
  }

  if (fs === undefined || workspaces === undefined || workspaces.length === 0) {
    return (
      <div style={containerStyle} data-editor-state="booting">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <p style={titleStyle}>Editor</p>
          <p style={hintStyle}>{fs === undefined ? 'The workspace file service is still mounting...' : 'No workspace is registered yet.'}</p>
        </div>
      </div>
    )
  }

  return (
    <div style={containerStyle} data-editor-workspace={workspaces.find(w => w.workspaceId === effectiveWorkspace)?.title}>
      <div style={treePaneStyle}>
        <select
          style={{ fontSize: 13, maxWidth: 288 }}
          value={effectiveWorkspace}
          onChange={(event) => { setWorkspaceId(event.target.value) }}
          aria-label="Workspace"
        >
          {workspaces.map(workspace => (
            <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.title}</option>
          ))}
        </select>
        <div style={treeScrollStyle}>
          <DirButton
            label={workspaces.find(w => w.workspaceId === effectiveWorkspace)?.title ?? ''}
            title={workspaces.find(w => w.workspaceId === effectiveWorkspace)?.path ?? ''}
            collapsed={dirs[dirKey(effectiveWorkspace, '')]?.expanded !== true}
            onClick={() => { toggleDir(effectiveWorkspace, '') }}
          />
          {dirs[dirKey(effectiveWorkspace, '')]?.expanded === true && (
            <Entries
              workspaceId={effectiveWorkspace}
              relDir=""
              depth={1}
              dirs={dirs}
              selectedRelPath={file?.relPath}
              toggleDir={toggleDir}
              openFile={openFile}
            />
          )}
        </div>
      </div>
      <div style={contentStyle}>
        {file === undefined && <p style={hintStyle}>Select a file to read it.</p>}
        {file !== undefined && file.state.loading && <p style={hintStyle}>Loading {file.relPath}...</p>}
        {file !== undefined && file.state.error !== undefined && <p style={errorStyle}>{file.state.error}</p>}
        {file !== undefined && file.state.read !== undefined && (
          <ContentPane
            key={file.state.read.relPath}
            relPath={file.state.read.relPath}
            size={file.state.read.size}
            content={file.state.read.content}
          />
        )}
      </div>
    </div>
  )
}

/** The Monaco pane for one read file: lazily instantiated on first open. */
function ContentPane(props: { relPath: string; size: number; content: string }): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const host = hostRef.current
    if (host === null) return undefined
    let handle: WorkbenchHandle | undefined
    try {
      handle = createReadonlyWorkbench(host)
      handle.set(props.content, languageForPath(props.relPath))
    } catch (error) {
      host.textContent = props.content
      host.setAttribute('data-editor-fallback', '1')
      host.setAttribute('data-editor-fallback-reason', String(error))
    }
    return () => { handle?.dispose() }
  }, [props.relPath, props.content])
  return (
    <div>
      <p style={hintStyle}>{props.relPath} ({String(props.size)} bytes)</p>
      <div ref={hostRef} style={{ height: 'calc(100% - 24px)', minHeight: 240 }} />
    </div>
  )
}

/** One directory chevron row. */
function DirButton(props: { label: string; title: string; collapsed: boolean; onClick(): void }): JSX.Element {
  return (
    <button
      className='editor-tree-row'
      title={props.title !== '' ? props.title : props.label}
      style={props.collapsed ? rowStyle : rowSelectedStyle}
      aria-expanded={!props.collapsed}
      onClick={props.onClick}
    >
      {props.collapsed ? COLLAPSED : EXPANDED}
      {props.label}
    </button>
  )
}

/** Recursively rendered children of one listed directory. */
function Entries(props: {
  workspaceId: string
  relDir: string
  depth: number
  dirs: Record<string, DirState>
  selectedRelPath: string | undefined
  toggleDir(workspaceId: string, relDir: string): void
  openFile(workspaceId: string, relPath: string): void
}): JSX.Element {
  const state = props.dirs[dirKey(props.workspaceId, props.relDir)]
  const entries = state?.entries ?? []
  const loading = state?.loading === true
  const error = state?.error
  const isEmpty = !loading && error === undefined && entries.length === 0
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingInlineStart: 10 }}
      role='group'
    >
      {error !== undefined && error !== '' ? <p style={errorStyle}>{error}</p> : null}
      {entries.map(entry => {
        const childRel = props.relDir === '' ? entry.name : props.relDir + '/' + entry.name
        const childKey = dirKey(props.workspaceId, childRel)
        if (entry.kind === 'directory') {
          const expanded = props.dirs[childKey]?.expanded === true
          return (
            <div key={childRel}>
              <button
                className='editor-tree-row'
                title={childRel}
                style={rowStyle}
                aria-expanded={expanded}
                onClick={() => { props.toggleDir(props.workspaceId, childRel) }}
              >
                {expanded ? EXPANDED : COLLAPSED}
                {entry.name}
              </button>
              {expanded && props.depth < 48 && (
                <Entries {...props} relDir={childRel} depth={props.depth + 1} />
              )}
              {expanded && props.depth >= 48 && (
                <p style={emptyHintStyle}>(deeper levels not shown — open the file directly)</p>
              )}
            </div>
          )
        }
        const isSelected = props.selectedRelPath === childRel
        return (
          <button
            key={childRel}
            className='editor-tree-row'
            title={childRel}
            aria-selected={isSelected}
            style={isSelected ? rowSelectedStyle : rowStyle}
            onClick={() => { props.openFile(props.workspaceId, childRel) }}
          >
            {entry.name}
          </button>
        )
      })}
      {loading && entries.length === 0 ? <p style={hintStyle}>Loading &#8230;</p> : null}
      {isEmpty ? <p style={emptyHintStyle}>(empty directory)</p> : null}
    </div>
  )
}
