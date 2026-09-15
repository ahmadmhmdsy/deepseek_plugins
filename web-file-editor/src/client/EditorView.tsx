/**
 * The Editor tab workbench (FE-M-A Task 3b, read-only phase): a
 * workspace-scoped explorer tree on the left, the selected file's content on
 * the right. The Monaco chunk replaces the plain text pane in Task 4; the
 * tree/read flow here is the stable shell around it.
 *
 * Data flow: the workspace rows arrive through injected
 * { fs, workspaces } (injection face from the tab registration: the mounted
 * fileEditor Remote face plus the client runtime's workspace rows); entries
 * and file contents ride that face's list()/read().
 *
 * @module web-file-editor/client/EditorView
 */
import { useState, type CSSProperties } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { EditorFsFace, FsEntryWire, FsReadResult } from './fs-remote.ts'

/** Injection face the tab registration passes per mount. */
export interface EditorViewInjected {
  /** The mounted fileEditor Remote namespace face (undefined until mounted). */
  fs: EditorFsFace | undefined
  /** Workspace rows the tab offers as tree roots. */
  workspaces: readonly WorkspaceRowFace[]
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
  borderInlineEnd: '1px solid rgba(127,127,127,0.25)', paddingInlineEnd: 8,
}
const contentStyle: CSSProperties = {
  flex: '1 1 auto', minWidth: 320, overflow: 'auto',
  background: 'rgba(127,127,127,0.07)', borderRadius: 6, padding: 8,
}
const rowStyle: CSSProperties = {
  display: 'block', width: '100%', cursor: 'pointer', padding: '2px 6px',
  borderRadius: 4, overflowWrap: 'anywhere', textAlign: 'start',
  border: 'none', background: 'transparent', font: 'inherit', fontSize: 13,
}
const rowSelectedStyle: CSSProperties = { ...rowStyle, background: 'rgba(127,127,127,0.18)' }
const titleStyle: CSSProperties = { fontSize: 15, fontWeight: 600, margin: 0 }
const hintStyle: CSSProperties = { fontSize: 12, opacity: 0.7, margin: 0 }
const preStyle: CSSProperties = {
  fontSize: 12.5, margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace', lineHeight: 1.5,
}
const errorStyle: CSSProperties = { fontSize: 13, color: '#b91c1c', margin: 0 }

const COLLAPSED = String.fromCharCode(0x25b8) + ' '
const EXPANDED = String.fromCharCode(0x25be) + ' '

function dirKey(workspaceId: string, relDir: string): string {
  return workspaceId + '#' + relDir
}

type FileUiState = DirState & { readonly read: FsReadResult | undefined }

/**
 * The Editor tab workbench.
 * @param props - conversation view runtime props plus our injection face.
 */
export function EditorView(props: ConvViewProps & Partial<EditorViewInjected>): JSX.Element {
  const { fs, workspaces } = props
  const [workspaceId, setWorkspaceId] = useState<string | null>(() => workspaces?.[0]?.workspaceId ?? null)
  const [dirs, setDirs] = useState<Record<string, DirState>>({})
  const [file, setFile] = useState<{ readonly relPath: string; readonly state: FileUiState } | undefined>(undefined)

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
            label={(effectiveWorkspace ? workspaces.find(w => w.workspaceId === effectiveWorkspace)?.path : undefined) ?? ''}
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
          <div>
            <p style={hintStyle}>{file.state.read.relPath} ({String(file.state.read.size)} bytes)</p>
            <pre style={preStyle}>{file.state.read.content}</pre>
          </div>
        )}
      </div>
    </div>
  )
}

/** One directory chevron row. */
function DirButton(props: { label: string; collapsed: boolean; onClick(): void }): JSX.Element {
  return (
    <button style={props.collapsed ? rowStyle : rowSelectedStyle} onClick={props.onClick}>
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
  if (state.loading) return <p style={hintStyle}>Loading &#8230;</p>
  if (state.error !== undefined) return <p style={errorStyle}>{state.error}</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, paddingInlineStart: 10 }}>
      {state.entries.map(entry => {
        const childRel = props.relDir === '' ? entry.name : props.relDir + '/' + entry.name
        const childKey = dirKey(props.workspaceId, childRel)
        if (entry.kind === 'directory') {
          const expanded = props.dirs[childKey]?.expanded === true
          return (
            <div key={childRel}>
              <button style={rowStyle} onClick={() => { props.toggleDir(props.workspaceId, childRel) }}>
                {expanded ? EXPANDED : COLLAPSED}
                {entry.name}
              </button>
              {expanded && props.depth < 48 && (
                <Entries {...props} relDir={childRel} depth={props.depth + 1} />
              )}
            </div>
          )
        }
        return (
          <button
            key={childRel}
            style={props.selectedRelPath === childRel ? rowSelectedStyle : rowStyle}
            onClick={() => { props.openFile(props.workspaceId, childRel) }}
          >
            {entry.name}
          </button>
        )
      })}
    </div>
  )
}
