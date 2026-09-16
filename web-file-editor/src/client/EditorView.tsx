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
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { EditorFsFace, FsEntryWire, FsReadResult } from './fs-remote.ts'
import { createReadonlyWorkbench, languageForPath, type WorkbenchHandle } from './workbench.ts'
import { TOKENS, inputStyle, labelStyle } from '../../../plugin-kit/src/client/chrome.tsx'

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
  width: 340, minWidth: 240, overflow: 'hidden',
}
const treeScrollStyle: CSSProperties = {
  overflowY: 'auto', overflowX: 'hidden', minWidth: 0,
  borderInlineEnd: '1px solid ' + TOKENS.border, paddingInlineEnd: 8, paddingInlineStart: 2,
}
/**
 * Neutral-selection backgrounds for tree rows. The kit has no dedicated
 * constants for these; keeping them local documents intent and makes a
 * future kit extraction trivial (rename to TOKENS.selectionBg /
 * TOKENS.selectionBgHover).
 */
const NEUTRAL_SELECTION: string = 'rgba(127,127,127,0.18)'
const NEUTRAL_SELECTION_HOVER: string = 'rgba(127,127,127,0.08)'

const contentStyle: CSSProperties = {
  flex: '1 1 auto', minWidth: 320,
  display: 'flex', flexDirection: 'column',
  overflow: 'hidden', // the inner Monaco host scrolls; the outer pane never should
  background: TOKENS.disabledBackground, borderRadius: 6, padding: 8,
}
/** Inner column of one ContentPane: header row + relative-positioned host. */
const contentPaneColumnStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column',
  flex: '1 1 auto', minHeight: 0,
  position: 'relative', // anchors the absolute-positioned Monaco host
  overflow: 'hidden',
}
/**
 * Monaco host: absolutely fills the column minus the header. Absolute
 * positioning dodges the flex-shrink race where Monaco paints text at
 * a 0px-measured canvas before automaticLayout fires.
 */
const contentPaneMonacoHostStyle: CSSProperties = {
  position: 'absolute',
  insetInlineStart: 0, insetInlineEnd: 0,
  top: 24, // leaves room for the 14-px-tall hint header (line-height ~20)
  bottom: 0,
  border: '1px solid ' + TOKENS.border, borderRadius: 4,
  background: TOKENS.inputBackground,
  overflow: 'hidden',
}
const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '18px 18px minmax(0, 1fr) auto auto',
  columnGap: 6, alignItems: 'center',
  width: '100%', cursor: 'pointer', padding: '2px 6px',
  borderRadius: 4, overflow: 'hidden', textAlign: 'start',
  border: 'none', background: 'transparent', font: 'inherit', fontSize: 13,
  transition: 'background-color 120ms ease',
  color: TOKENS.text,
}
const rowSelectedStyle: CSSProperties = {
  ...rowStyle,
  background: NEUTRAL_SELECTION,
  boxShadow: 'inset 2px 0 0 ' + TOKENS.accent,
}
const rowGlyphStyle: CSSProperties = {
  display: 'inline-flex', justifyContent: 'center', alignItems: 'center',
  color: TOKENS.textMuted, width: 18,
}
const rowNameStyle: CSSProperties = {
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  minWidth: 0, // grid overflow guard
}
const rowMetaStyle: CSSProperties = {
  fontSize: 12, color: TOKENS.textMuted, fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
}
const rowChevronStyle: CSSProperties = {
  display: 'inline-flex', justifyContent: 'center', alignItems: 'center',
  width: 18, color: TOKENS.textMuted,
}
/** Per-nesting-level guide line. Kit has no indent-guide token; centralizing
 *  the value here makes a future extraction (TOKENS.indentGuide) trivial.
 *  Reuses the neutral-selection alpha (0.18) — same family, same intent. */
const INDENT_GUIDE: string = '1px solid rgba(127,127,127,0.18)'
/** Root-level children (depth 0): no guide line, normal indent padding. */
const entriesContainerRootStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 1,
  paddingInlineStart: 10,
}
/** Nested children (depth >= 1): guide line drawn at the indent. */
const entriesContainerWithGuideStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 1,
  paddingInlineStart: 10,
  borderInlineStart: INDENT_GUIDE,
  marginInlineStart: 4,
}
const titleStyle: CSSProperties = { fontSize: 15, fontWeight: 600, margin: 0 }
const hintStyle: CSSProperties = { fontSize: 12, opacity: 0.7, margin: 0 }
const preStyle: CSSProperties = {
  fontSize: 13, margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, monospace', lineHeight: 1.5,
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

const breadcrumbStyle: CSSProperties = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2,
  fontSize: 12, color: TOKENS.textMuted,
  padding: '2px 2px 4px', minHeight: 22,
}
const breadcrumbSegStyle: CSSProperties = {
  cursor: 'pointer', padding: '1px 6px', borderRadius: 4,
  border: '1px solid transparent',
}
const breadcrumbSepStyle: CSSProperties = {
  opacity: 0.5, padding: '0 2px', userSelect: 'none',
}
const breadcrumbLeafStyle: CSSProperties = {
  padding: '1px 6px', borderRadius: 4, color: TOKENS.text, fontWeight: 500,
}
const placeholderTitleStyle: CSSProperties = { fontSize: 16, fontWeight: 600, margin: '0 0 4px', color: TOKENS.text }
const placeholderDescStyle: CSSProperties = { fontSize: 13, margin: '0 0 2px', color: TOKENS.textMuted }
const placeholderSpinnerStyle: CSSProperties = {
  display: 'inline-block', width: 14, height: 14, verticalAlign: 'text-bottom',
  border: '2px solid ' + TOKENS.border, borderTopColor: TOKENS.accent,
  borderRadius: '50%', animation: 'editor-spin 1s linear infinite',
  marginInlineEnd: 6,
}
const placeholderContainerStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', justifyContent: 'center',
  alignItems: 'center', textAlign: 'center', height: '100%', gap: 6, padding: 24,
}

/**
 * Identity-placeholder spinner keyframes. Sits in the same scoped <style>
 * tag as TREE_ROW_HOVER_RULE (data-editor-tree-row-styles) so cleanup is
 * automatic on unmount; class name has 'editor-' prefix to avoid clashing
 * with the host theme.
 */
const SPINNER_RULE = '@keyframes editor-spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}'

const COLLAPSED = String.fromCharCode(0x25b8) + ' '
const EXPANDED = String.fromCharCode(0x25be) + ' '

/**
 * Hover/focus-visible style for tree rows. Inline styles cannot express
 * `:hover` / `:focus-visible` pseudo-classes; install a tiny scoped rule
 * exactly once per Editor mount. Class `editor-tree-row` is unique enough
 * that the rule cannot leak into other plugin rows.
 */
const TREE_ROW_HOVER_RULE =
  '.editor-tree-row:hover:not([aria-selected="true"]){background:' + NEUTRAL_SELECTION_HOVER + '}' +
  '.editor-tree-row:focus-visible{outline:2px solid ' + TOKENS.accent + ';outline-offset:-2px} ' +
  SPINNER_RULE

function dirKey(workspaceId: string, relDir: string): string {
  return workspaceId + '#' + relDir
}


/** Flatten-tree row descriptor (M-D.2 keyboard nav). */
interface FlatRow {
  readonly kind: 'root' | 'dir' | 'file'
  readonly relPath: string
}

/** DFS display order; stable across renders when the dirs map is stable. */
function flattenRows(dirs: Record<string, DirState>, workspaceId: string): FlatRow[] {
  const out: FlatRow[] = [{ kind: 'root', relPath: '' }]
  const walk = (relDir) => {
    const state = dirs[dirKey(workspaceId, relDir)]
    if (state === undefined || state.expanded !== true) return
    for (const entry of state.entries) {
      const childRel = relDir === '' ? entry.name : relDir + '/' + entry.name
      if (entry.kind === 'directory') {
        out.push({ kind: 'dir', relPath: childRel })
        walk(childRel)
      } else {
        out.push({ kind: 'file', relPath: childRel })
      }
    }
  }
  walk('')
  return out
}

/** Deepest expanded directory; alphabetic tiebreak on equal length. */
function deepestExpandedDir(dirs, workspaceId) {
  let best = ''
  for (const key of Object.keys(dirs)) {
    if (!key.startsWith(workspaceId + '#')) continue
    if (dirs[key] === undefined || dirs[key].expanded !== true) continue
    const rel = key.slice(workspaceId.length + 1)
    if (rel.length > best.length || (rel.length === best.length && rel < best)) best = rel
  }
  return best
}

/** '' → []; 'a/b/c' → ['a','b','c']. */
function splitPath(rel) {
  return rel === '' ? [] : rel.split('/')
}


/** Compact size formatter for the tree-row metadata column. */
function formatSize(n: number): string {
  if (n < 1024) return String(n) + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + ' KB'
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB'
  return (n / (1024 * 1024 * 1024)).toFixed(1) + ' GB'
}

/** Relative-time formatter: 'just now', '5 min ago', '2 days ago', 'Mar 14'. */
function formatRelativeTime(ms: number, now: number): string {
  const diff = Math.max(0, now - ms)
  const sec = Math.floor(diff / 1000)
  if (sec < 45) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return String(min) + ' min ago'
  const hr = Math.floor(min / 60)
  if (hr < 24) return String(hr) + ' hr ago'
  const day = Math.floor(hr / 24)
  if (day < 30) return String(day) + ' day' + (day === 1 ? '' : 's') + ' ago'
  // Beyond a month: short calendar date.
  const d = new Date(ms)
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return months[d.getMonth()] + ' ' + String(d.getDate())
}

/** 14x14 inline-SVG glyphs (kit has no icon pack; path strings only). */
const FOLDER_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h2.879a1.5 1.5 0 0 1 1.06.439l.83.83.47.47a.5.5 0 0 0 .354.146H13a1.5 1.5 0 0 1 1.5 1.5v6.615A1.5 1.5 0 0 1 13 13.5H3a1.5 1.5 0 0 1-1.5-1.5V3.5Z"/></svg>'
const FILE_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3.5 1.75A1.75 1.75 0 0 0 1.75 3.5v9A1.75 1.75 0 0 0 3.5 14.25h9A1.75 1.75 0 0 0 14.25 12.5V5.621c0-.464-.184-.909-.513-1.237L10.866 1.513A1.75 1.75 0 0 0 9.629 1H3.5Zm5.75 1.5v2.5A1.25 1.25 0 0 0 10.5 7h2.75v5.5a.25.25 0 0 1-.25.25h-9a.25.25 0 0 1-.25-.25v-9a.25.25 0 0 1 .25-.25h5Z"/></svg>'

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

  // Keyboard nav (M-D.2): flatten rows for tree container keyboard handling.
  const flatRows = useMemo<FlatRow[]>(
    () => workspaces === undefined || effectiveWorkspace === null ? [] : flattenRows(dirs, effectiveWorkspace),
    [workspaces, effectiveWorkspace, dirs],
  )
  // Breadcrumb anchor: the selected file's parent dir if any file is open,
  // else the deepest expanded directory, else root.
  const breadcrumbAnchor = useMemo<string>(() => {
    if (file !== undefined) {
      const idx = file.relPath.lastIndexOf('/')
      return idx === -1 ? '' : file.relPath.slice(0, idx)
    }
    if (effectiveWorkspace === null) return ''
    return deepestExpandedDir(dirs, effectiveWorkspace)
  }, [file, effectiveWorkspace, dirs])
  const breadcrumbSegments = useMemo<string[]>(
    () => splitPath(breadcrumbAnchor),
    [breadcrumbAnchor],
  )
  const rootLabel = workspaces?.find(w => w.workspaceId === effectiveWorkspace)?.title ?? ''
  const rootPath = workspaces?.find(w => w.workspaceId === effectiveWorkspace)?.path ?? ''
  const onBreadcrumbJump = useCallback((relDir: string): void => {
    if (effectiveWorkspace === null) return
    // Open the clicked segment if not already expanded.
    if (dirs[dirKey(effectiveWorkspace, relDir)]?.expanded !== true) {
      toggleDir(effectiveWorkspace, relDir)
    }
  }, [effectiveWorkspace, dirs, toggleDir])
  const getRowIndex = useCallback((relPath: string): number => {
    return flatRows.findIndex(r => r.relPath === relPath)
  }, [flatRows])

  const focusRow = useCallback((index: number): void => {
    if (index < 0 || index >= flatRows.length) return
    const target = document.querySelector('[data-editor-row-index="' + String(index) + '"]') as HTMLElement | null
    if (target !== null) target.focus()
  }, [flatRows])
  // Generic over the target: the handler is attached to <button> rows,
  // to the same <button>s that act as breadcrumb segments, and to the
  // <div role='tree'> root container. We only read event.key + call
  // preventDefault/stopPropagation, none element-typed — so KeyboardEvent
  // (the base class) is sufficient and avoids per-callsite type drift.
  const onTreeKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>): void => {
    if (flatRows.length === 0) return
    const current = document.activeElement as HTMLElement | null
    const currentIndex = current === null ? -1 : Number(current.getAttribute('data-editor-row-index') ?? '-1')
    const row = currentIndex >= 0 ? flatRows[currentIndex] : undefined
    const onRow = (action: () => void): void => {
      event.preventDefault()
      event.stopPropagation()
      action()
    }
    switch (event.key) {
      case 'ArrowDown':
        onRow(() => { focusRow(currentIndex < 0 ? 0 : Math.min(flatRows.length - 1, currentIndex + 1)) })
        return
      case 'ArrowUp':
        onRow(() => { focusRow(currentIndex < 0 ? 0 : Math.max(0, currentIndex - 1)) })
        return
      case 'Home':
        onRow(() => { focusRow(0) })
        return
      case 'End':
        onRow(() => { focusRow(flatRows.length - 1) })
        return
      case 'ArrowRight':
        if (row !== undefined && (row.kind === 'root' || row.kind === 'dir') && effectiveWorkspace !== null) {
          if (dirs[dirKey(effectiveWorkspace, row.relPath)]?.expanded !== true) {
            onRow(() => { toggleDir(effectiveWorkspace, row.relPath) })
            return
          }
        }
        onRow(() => { focusRow(Math.min(flatRows.length - 1, currentIndex + 1)) })
        return
      case 'ArrowLeft':
        if (row !== undefined && row.kind === 'dir' && effectiveWorkspace !== null) {
          if (dirs[dirKey(effectiveWorkspace, row.relPath)]?.expanded === true) {
            onRow(() => { toggleDir(effectiveWorkspace, row.relPath) })
            return
          }
          // Jump to parent row.
          const parentIdx = row.relPath.lastIndexOf('/')
          const parentRel = parentIdx === -1 ? '' : row.relPath.slice(0, parentIdx)
          const parentIndex = flatRows.findIndex(r => r.relPath === parentRel)
          if (parentIndex !== -1) {
            onRow(() => { focusRow(parentIndex) })
            return
          }
        }
        if (row !== undefined && row.kind === 'file' && effectiveWorkspace !== null) {
          const parentRel = row.relPath.includes('/') ? row.relPath.slice(0, row.relPath.lastIndexOf('/')) : ''
          const parentIndex = flatRows.findIndex(r => r.relPath === parentRel)
          if (parentIndex !== -1) {
            onRow(() => { focusRow(parentIndex) })
            return
          }
        }
        return
      case 'Enter':
      case ' ':
        if (row !== undefined && row.kind === 'file' && effectiveWorkspace !== null) {
          onRow(() => { openFile(effectiveWorkspace, row.relPath) })
        } else if (row !== undefined && (row.kind === 'root' || row.kind === 'dir') && effectiveWorkspace !== null) {
          onRow(() => { toggleDir(effectiveWorkspace, row.relPath) })
        }
        return
    }
  }, [flatRows, dirs, effectiveWorkspace, toggleDir, openFile, focusRow])

  if (fs === undefined || workspaces === undefined || workspaces.length === 0) {
    const bootWorkspace = workspaces?.[0]?.title
    return (
      <div style={containerStyle} data-editor-state="booting">
        <div style={placeholderContainerStyle}>
          <p style={placeholderTitleStyle}>File Explorer</p>
          <p style={placeholderDescStyle}>Browse and read files in the active workspace.</p>
          {bootWorkspace !== undefined ? <p style={placeholderDescStyle}>Workspace: {bootWorkspace}</p> : null}
          <p style={placeholderDescStyle}>
            <span style={placeholderSpinnerStyle} aria-hidden='true' />
            {fs === undefined ? 'Mounting workspace file service…' : 'No workspace is registered yet.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={containerStyle} data-editor-workspace={workspaces.find(w => w.workspaceId === effectiveWorkspace)?.title}>
      <div style={treePaneStyle}>
        {workspaces.length > 1
          ? (
              <>
                <span style={labelStyle}>Workspace</span>
                <select
                  style={{ ...inputStyle, width: 328 }}
                  value={effectiveWorkspace}
                  onChange={(event) => { setWorkspaceId(event.target.value) }}
                  aria-label='Workspace'
                >
                  {workspaces.map(workspace => (
                    <option key={workspace.workspaceId} value={workspace.workspaceId}>{workspace.title}</option>
                  ))}
                </select>
              </>
            )
          : null}
        <div style={breadcrumbStyle} aria-label='Path'>
          <button
            className='editor-tree-row'
            data-editor-row-index='0'
            tabIndex={0}
            style={breadcrumbSegStyle}
            title={rootPath}
            onClick={() => { onBreadcrumbJump('') }}
            onKeyDown={onTreeKeyDown}
          >
            {rootLabel === '' ? 'workspace' : rootLabel}
          </button>
          {breadcrumbSegments.map((segment, i) => {
            const relUpTo = breadcrumbSegments.slice(0, i + 1).join('/')
            const isLeaf = i === breadcrumbSegments.length - 1
            const childFlatIndex = flatRows.findIndex(r => r.relPath === relUpTo)
            return (
              <span key={relUpTo} style={{ display: 'inline-flex', alignItems: 'center' }}>
                <span style={breadcrumbSepStyle} aria-hidden='true'>{'›'}</span>
                <button
                  className='editor-tree-row'
                  data-editor-row-index={childFlatIndex === -1 ? 0 : childFlatIndex}
                  tabIndex={isLeaf ? -1 : 0}
                  style={isLeaf ? breadcrumbLeafStyle : breadcrumbSegStyle}
                  onClick={() => { onBreadcrumbJump(relUpTo) }}
                  onKeyDown={onTreeKeyDown}
                >
                  {segment}
                </button>
              </span>
            )
          })}
        </div>
        <div style={treeScrollStyle} role='tree' onKeyDown={onTreeKeyDown}>
          <DirButton
            label={workspaces.find(w => w.workspaceId === effectiveWorkspace)?.title ?? ''}
            title={workspaces.find(w => w.workspaceId === effectiveWorkspace)?.path ?? ''}
            collapsed={dirs[dirKey(effectiveWorkspace, '')]?.expanded !== true}
            rowIndex={0}
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
              getRowIndex={getRowIndex}
            />
          )}
        </div>
      </div>
      <div style={contentStyle}>
        {file === undefined && (
          <div style={placeholderContainerStyle}>
            <p style={placeholderTitleStyle}>File Explorer</p>
            <p style={placeholderDescStyle}>Browse and read files in the active workspace.</p>
            <p style={placeholderDescStyle}>Workspace: {workspaces.find(w => w.workspaceId === effectiveWorkspace)?.title ?? ''}</p>
            <p style={placeholderDescStyle}>Select a file in the tree to read it here.</p>
          </div>
        )}
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
    <div style={contentPaneColumnStyle}>
      <p style={hintStyle}>{props.relPath} ({String(props.size)} bytes)</p>
      <div ref={hostRef} style={contentPaneMonacoHostStyle} data-editor-monaco-host='1' />
    </div>
  )
}

/** One directory chevron row. */
function DirButton(props: { label: string; title: string; collapsed: boolean; rowIndex: number; onClick(): void }): JSX.Element {
  return (
    <button
      className='editor-tree-row'
      title={props.title !== '' ? props.title : props.label}
      style={props.collapsed ? rowStyle : rowSelectedStyle}
      aria-expanded={!props.collapsed}
      tabIndex={0}
      data-editor-row-index={props.rowIndex}
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
  getRowIndex(relPath: string): number
}): JSX.Element {
  const state = props.dirs[dirKey(props.workspaceId, props.relDir)]
  const entries = state?.entries ?? []
  const loading = state?.loading === true
  const error = state?.error
  const isEmpty = !loading && error === undefined && entries.length === 0
  const showGuideLine = props.depth > 0
  return (
    <div
      style={showGuideLine ? entriesContainerWithGuideStyle : entriesContainerRootStyle}
      role='group'
      data-editor-entries-depth={props.depth}
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
                title={childRel + (entry.size !== 0 ? ' (' + formatSize(entry.size) + ', modified ' + formatRelativeTime(entry.modifiedMs, Date.now()) + ')' : '')}
                style={rowStyle}
                aria-expanded={expanded}
                tabIndex={0}
                data-editor-row-index={props.getRowIndex(childRel)}
                onClick={() => { props.toggleDir(props.workspaceId, childRel) }}
              >
                <span style={rowChevronStyle} aria-hidden='true'>{expanded ? EXPANDED : COLLAPSED}</span>
                <span style={rowGlyphStyle} dangerouslySetInnerHTML={{ __html: FOLDER_SVG }} />
                <span style={rowNameStyle}>{entry.name}</span>
                <span style={rowMetaStyle}>{'—'}</span>
                <span style={rowMetaStyle}>{formatRelativeTime(entry.modifiedMs, Date.now())}</span>
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
            title={childRel + ' (' + formatSize(entry.size) + ', modified ' + formatRelativeTime(entry.modifiedMs, Date.now()) + ')'}
            aria-selected={isSelected}
            style={isSelected ? rowSelectedStyle : rowStyle}
            tabIndex={0}
            data-editor-row-index={props.getRowIndex(childRel)}
            onClick={() => { props.openFile(props.workspaceId, childRel) }}
          >
            <span style={rowChevronStyle} aria-hidden='true'>&nbsp;</span>
            <span style={rowGlyphStyle} dangerouslySetInnerHTML={{ __html: FILE_SVG }} />
            <span style={rowNameStyle}>{entry.name}</span>
            <span style={rowMetaStyle}>{formatSize(entry.size)}</span>
            <span style={rowMetaStyle}>{formatRelativeTime(entry.modifiedMs, Date.now())}</span>
          </button>
        )
      })}
      {loading && entries.length === 0 ? <p style={hintStyle}>Loading &#8230;</p> : null}
      {isEmpty ? <p style={emptyHintStyle}>(empty directory)</p> : null}
    </div>
  )
}
