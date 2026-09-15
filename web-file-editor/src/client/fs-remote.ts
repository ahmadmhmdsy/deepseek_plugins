/**
 * Browser half of the fileEditor Remote namespace: one hand-built
 * TypertRemoteContribution mounted into the runtime's Typed Remote service.
 *
 * The descriptors are STRICT (the Client $mount path refuses src-json
 * codecs), with self-contained JSON validators as their schema.parse — the
 * Host side needs none of this because its dispatch derives SRC descriptors
 * from the live decorated FileEditorFs service.
 *
 * @module web-file-editor/client/fs-remote
 */
import type {
  InvocationDescriptor,
  TypertCodec,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'

/** The wire namespace the host FileEditorFs service declares. */
export const FS_NAMESPACE = 'fileEditor'

/** Host service key the SRC fallback resolves (must match src/remote/index.ts). */
export const FS_SERVICE_KEY = 'fileEditorFs'

/** Ordered entry row mirror of the service wire shape. */
export interface FsEntryWire {
  readonly name: string
  readonly kind: 'file' | 'directory'
  readonly size: number
  readonly modifiedMs: number
}

/** What the mounted face returns per call. */
export interface FsListResult {
  readonly relDir: string
  readonly entries: readonly FsEntryWire[]
}

export interface FsReadResult {
  readonly relPath: string
  readonly size: number
  readonly modifiedMs: number
  readonly content: string
}

/** The editor's file-system face, wired to the mounted Remote namespace. */
export interface EditorFsFace {
  list(workspaceId: string, relDir?: string): Promise<FsListResult>
  read(workspaceId: string, relPath: string): Promise<FsReadResult>
}

interface StrictSchema {
  parse(value: unknown): unknown
}

/** Strict JSON codec with an explicit validating parse. */
function strictCodec(typeSymbol: string, schema: StrictSchema): TypertCodec {
  return { mode: 'strict', typeSymbol, schema }
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Validate { workspaceId, relDir? } exactly. */
function parseListRequest(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('list request must be an object')
  const record = value as Record<string, unknown>
  if (!isString(record.workspaceId)) throw new TypeError('list request workspaceId must be a string')
  const relDir = record.relDir
  if (relDir !== undefined && !isString(relDir)) throw new TypeError('list request relDir must be a string')
  return value
}

/** Validate { relPath } exactly. */
function parseReadRequest(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('read request must be an object')
  const record = value as Record<string, unknown>
  if (!isString(record.relPath)) throw new TypeError('read request relPath must be a string')
  return value
}

interface EntryRecord {
  name: string
  kind: 'file' | 'directory'
  size: number
  modifiedMs: number
}

/** Validate one listed entry (mutates nothing). */
function parseEntry(value: unknown): EntryRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('entry must be an object')
  const record = value as Record<string, unknown>
  if (!isString(record.name)) throw new TypeError('entry name must be a string')
  if (record.kind !== 'file' && record.kind !== 'directory') throw new TypeError('entry kind must be file or directory')
  if (!isFiniteNumber(record.size) || !isFiniteNumber(record.modifiedMs)) throw new TypeError('entry size/modifiedMs must be finite numbers')
  return value as EntryRecord
}

/** Validate the list() result. */
function parseListResult(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('list result must be an object')
  const record = value as Record<string, unknown>
  if (!isString(record.relDir)) throw new TypeError('list result relDir must be a string')
  if (!Array.isArray(record.entries)) throw new TypeError('list result entries must be an array')
  for (const entry of record.entries) { parseEntry(entry) }
  return value
}

/** Validate the read() result. */
function parseReadResult(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('read result must be an object')
  const record = value as Record<string, unknown>
  if (!isString(record.relPath) || !isString(record.content)) throw new TypeError('read result relPath/content must be strings')
  if (!isFiniteNumber(record.size) || !isFiniteNumber(record.modifiedMs)) throw new TypeError('read result size/modifiedMs must be finite numbers')
  return value
}

/** Both descriptors share this strict shape; ids stay globally stable. */
function descriptor(id: string, method: 'list' | 'read'): InvocationDescriptor {
  const isList = method === 'list'
  const parameters = [{
    name: 'request',
    wire: 'request',
    source: 'json' as const,
    codec: isList
      ? strictCodec(FS_NAMESPACE + ':listRequest', { parse: parseListRequest })
      : strictCodec(FS_NAMESPACE + ':readRequest', { parse: parseReadRequest }),
  }]
  return {
    id,
    service: FS_SERVICE_KEY,
    namespace: FS_NAMESPACE,
    method,
    invocation: { kind: 'direct' },
    parameters,
    result: isList
      ? strictCodec(FS_NAMESPACE + ':listResult', { parse: parseListResult })
      : strictCodec(FS_NAMESPACE + ':readResult', { parse: parseReadResult }),
    sourceLocation: { file: 'web-file-editor/src/client/fs-remote.ts', line: 1, column: 1 },
  }
}

/** The contribution the client owns (strict face mirrors src/remote/index.ts). */
export function fileEditorFsContribution(): TypertRemoteContribution {
  return {
    package: 'web-file-editor',
    descriptors: [
      descriptor('web-file-editor:' + FS_NAMESPACE + ':list', 'list'),
      descriptor('web-file-editor:' + FS_NAMESPACE + ':read', 'read'),
    ],
  }
}

/** The namespace handle shape the runtime exposes ($mount installs it). */
interface RemoteHandle {
  $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void>>
}

/** One mounted remote namespace entry: request object in, RemoteResult out. */
type RemoteMethod = (request: unknown) => Promise<{ ok: boolean; value?: unknown; error?: { message?: string } }>

/** Propagate a Remote call's failure and narrow its value. */
async function unwrap<T>(pending: Promise<{ ok: boolean; value?: unknown; error?: { message?: string } }>, endpoint: string): Promise<T> {
  const outcome = await pending
  if (!outcome.ok) throw new Error(endpoint + ' failed: ' + (outcome.error?.message ?? 'unknown failure'))
  return outcome.value as T
}

/** Wire the face to one mounted Remote namespace service ('fileEditor'). */
export function faceForRemote(remote: Record<string, unknown>): EditorFsFace {
  const namespace = remote[FS_NAMESPACE] as Record<string, RemoteMethod> | undefined
  if (namespace === undefined) throw new Error('web-file-editor: fileEditor namespace is not mounted yet')
  return {
    list(workspaceId: string, relDir?: string): Promise<FsListResult> {
      const request = relDir === undefined ? { workspaceId } : { workspaceId, relDir }
      return unwrap(namespace.list(request), FS_NAMESPACE + '/list')
    },
    read(workspaceId: string, relPath: string): Promise<FsReadResult> {
      return unwrap(namespace.read({ workspaceId, relPath }), FS_NAMESPACE + '/read')
    },
  }
}
