/**
 * Client Remote contribution face: strict descriptors only, the wire shape
 * mirrors src/remote/index.ts, faceForRemote unwraps RemoteResult correctly.
 *
 * @module web-file-editor/tests
 */
import { describe, expect, it } from 'vitest'
import { faceForRemote, fileEditorFsContribution, FS_NAMESPACE, FS_SERVICE_KEY } from '../src/client/fs-remote.ts'

describe('fileEditor client contribution', () => {
  const contribution = fileEditorFsContribution()

  it('carries list and read with one request parameter each', () => {
    expect(contribution.package).toBe('web-file-editor')
    expect(contribution.descriptors.map(d => d.method).sort()).toEqual(['list', 'read'])
    for (const d of contribution.descriptors) {
      expect(d.namespace).toBe(FS_NAMESPACE)
      expect(d.service).toBe(FS_SERVICE_KEY)
      expect(d.invocation).toEqual({ kind: 'direct' })
      expect(d.parameters.length).toBe(1)
      expect(d.parameters[0].name).toBe('request')
      expect(d.parameters[0].codec.mode).toBe('strict')
      expect(d.result.mode).toBe('strict')
    }
  })

  it('request codecs validate the request envelopes', () => {
    const listRequest = contribution.descriptors.find(d => d.method === 'list')!.parameters[0].codec
    const readRequest = contribution.descriptors.find(d => d.method === 'read')!.parameters[0].codec
    expect((listRequest as unknown as { schema: { parse(value: unknown): unknown } }).schema).toBeDefined()
    expect(() => (listRequest as { schema: { parse(v: unknown): unknown } }).schema.parse({ workspaceId: 'ws1' })).not.toThrow()
    expect(() => (listRequest as { schema: { parse(v: unknown): unknown } }).schema.parse({ workspaceId: 1 })).toThrow()
    expect(() => (readRequest as { schema: { parse(v: unknown): unknown } }).schema.parse({ relPath: 'a.ts', workspaceId: 'ws1' })).not.toThrow()
    expect(() => (readRequest as { schema: { parse(v: unknown): unknown } }).schema.parse({ relPath: 3 })).toThrow()
  })

  it('result codecs validate entries and reads', () => {
    const listResult = contribution.descriptors.find(d => d.method === 'list')!.result
    const readResult = contribution.descriptors.find(d => d.method === 'read')!.result
    expect(() => (listResult as { schema: { parse(v: unknown): unknown } }).schema.parse({
      relDir: '', entries: [{ name: 'sub', kind: 'directory', size: 0, modifiedMs: 1 }],
    })).not.toThrow()
    expect(() => (listResult as { schema: { parse(v: unknown): unknown } }).schema.parse({ relDir: '', entries: [{ name: 'x' }] })).toThrow()
    expect(() => (readResult as { schema: { parse(v: unknown): unknown } }).schema.parse({
      relPath: 'a.ts', size: 3, modifiedMs: 1, content: 'abc',
    })).not.toThrow()
    expect(() => (readResult as { schema: { parse(v: unknown): unknown } }).schema.parse({ relPath: 'a.ts' })).toThrow()
  })

  it('faceForRemote rejects before the namespace is mounted', () => {
    expect(() => faceForRemote({})).toThrow(/not mounted/)
  })

  it('faceForRemote unwraps ok results and failures', async () => {
    const calls: { endpoint: string; request: unknown }[] = []
    const namespace = {
      list: (request: unknown) => {
        calls.push({ endpoint: 'list', request })
        return Promise.resolve({ ok: true, value: { relDir: 'sub', entries: [] } })
      },
      read: (request: unknown) => Promise.resolve({ ok: false, error: { message: 'file-editor: binary' } }),
    }
    const face = faceForRemote({ [FS_NAMESPACE]: namespace })
    const listed = await face.list('ws1', 'sub')
    expect(listed).toEqual({ relDir: 'sub', entries: [] })
    expect(calls[0]!.request).toEqual({ workspaceId: 'ws1', relDir: 'sub' })
    await expect(face.read('ws1', 'z.ts')).rejects.toThrow('fileEditor/read failed')
    const rootList = await face.list('ws1')
    expect(calls[1]!.request).toEqual({ workspaceId: 'ws1' })
    void rootList
  })
})
