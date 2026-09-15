/**
 * Placeholder editor view (FE-M-A Task 1). Renders as a full-area panel and
 * proves the tab path; FE-M-A Task 2 replaces this with the lazily loaded
 * Monaco workbench (explorer tree + lazy engine chunk). Own styles are inline
 * style objects because the client bundle purity gate forbids CSS modules.
 *
 * @module web-file-editor/client/EditorView
 */
import type { CSSProperties } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

/** Session-bound share injected by the registration; empty in the stub. */
export type EditorViewInjected = Record<never, never>

const styles: Record<'container' | 'title' | 'hint', CSSProperties> = {
  container: {
    display: 'flex', flexDirection: 'column', height: '100%', minHeight: 200,
    alignItems: 'center', justifyContent: 'center', color: '#6b7280', gap: 4,
  },
  title: { fontSize: 15, fontWeight: 600, margin: 0 },
  hint: { fontSize: 12, opacity: 0.7, margin: 0 },
}

/**
 * The editor tab placeholder. Props follow the proven TrajectoryView shape.
 * @param props - conversation view runtime props plus our injection face.
 */
export function EditorView(props: ConvViewProps): JSX.Element {
  const request = props.viewRequest as { focus?: string } | null
  const focus = request !== null ? request.focus : null
  return (
    <div style={styles.container} data-focus={focus ?? undefined}>
      <div style={styles.title}>File editor</div>
      <div style={styles.hint}>Placeholder {"\u2014"} Monaco workbench arrives with FE-M-A Task 2.</div>
    </div>
  )
}
