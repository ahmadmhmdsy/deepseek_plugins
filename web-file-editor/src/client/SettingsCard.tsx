/**
 * The file-editor settings card: one disclosure shell with a master switch
 * on the head (the kit's proven control placement) and a body explaining the
 * live gate. Presentation only — the controller owns state and writes.
 *
 * @module web-file-editor/client/SettingsCard
 */
import type { EditorCardFace, EditorCardState } from './card-controller.ts'
import { PluginCardShell, TOKENS } from '../../../plugin-kit/src/client/chrome.tsx'

/** Props the renderer binds for the card: snapshot hook plus our injection. */
export type EditorSettingsCardProps = {
  /** The snapshot hook the renderer binds to the injected store. */
  useCard(selector: (snapshot: EditorCardState) => EditorCardState): EditorCardState
} & EditorCardFace

/**
 * Render the file-editor settings card.
 * @param props - the card face from the registration injection.
 * @returns the card; nothing when the host does not serve the namespace.
 */
export function EditorSettingsCard(props: EditorSettingsCardProps): JSX.Element | null {
  const state: EditorCardState = props.useCard((snapshot) => snapshot)
  if (!state.available) return null
  return (
    <PluginCardShell
      title='File editor'
      description='Workspace file browser and read-only viewer (Editor tab).'
      disclosureLabel='File editor settings'
      pill={state.failed ? { tone: 'danger', label: 'save failed' } : { tone: state.enabled ? 'accent' : 'neutral', label: state.enabled ? 'enabled' : 'disabled' }}
      switchChecked={state.enabled}
      switchDisabled={state.failed}
      switchTitle='Enable or disable the Editor tab (applies live, no restart)'
      onSwitchToggle={(next) => { props.toggle(next) }}
      body={(
        <div style={{ fontSize: 12, color: TOKENS.textMuted, display: 'grid', gap: 6 }}>
          <span>The switch mounts or withdraws the Editor tab live; disabled removes the tab and its data-plane remote from the session.</span>
          {state.failed ? <span style={{ color: TOKENS.danger }}>The last write failed — the host refused or is offline. Nothing was lost; try again.</span> : null}
        </div>
      )}
    />
  )
}
