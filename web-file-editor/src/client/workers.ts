/**
 * Monaco worker provisioning for the inlined engine (FE-M-A Task 4).
 *
 * The plugin bundle is a CJS factory: the platform loader refuses additional
 * script URLs, so the standard worker files cannot be served. A silent Blob
 * worker answers nothing — Monaco degrades the worker-backed features
 * (link detection, diff) but keeps main-thread highlighting, folding, and
 * search intact, which is exactly the read-only workbench needs.
 *
 * @module web-file-editor/client/workers
 */

/** Install the Blob-based worker fallback exactly once per page. */
export function installMonacoEnvironment(): void {
  const globalScope = globalThis as { MonacoEnvironment?: unknown }
  if (globalScope.MonacoEnvironment !== undefined) return
  globalScope.MonacoEnvironment = {
    getWorker(): Worker {
      const source = 'self.onmessage = function () { /* silent plugin fallback worker */ }'
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
      return new Worker(url)
    },
  }
}
