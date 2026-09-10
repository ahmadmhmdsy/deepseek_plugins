/**
 * The compact-handoff settings card: staged fields over the handoff config's
 * user layer, a models table, and a pure-tokens live preview. Inline styles
 * only (this package has no CSS pipeline); plain-English labels (i18n
 * deferred). Renders nothing while the Host does not serve the namespace.
 *
 * @module web-compact-config/client/Card
 */
import type { CSSProperties } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { CompactConfigCardFace, FieldView, ModelRowView } from './controller.ts'

/** Props the renderer binds for the compact-handoff card. */
export type CompactConfigCardProps =
  PropsRuntime<'settings.plugin.item'>
  & InjectFace<CompactConfigCardFace>

const labelStyle: CSSProperties = { display: 'block', fontSize: 12, color: '#666', marginBottom: 2 }
const inputStyle: CSSProperties = { width: 160, boxSizing: 'border-box', padding: '2px 4px' }
const sectionStyle: CSSProperties = { marginBottom: 10 }
const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }
const buttonStyle: CSSProperties = { padding: '3px 10px', cursor: 'pointer' }
const hintStyle: CSSProperties = { fontSize: 11, color: '#999' }
const errorStyle: CSSProperties = { fontSize: 11, color: '#b33' }

function Field(props: {
  label: string
  view: FieldView
  disabled: boolean
  onEdit: (text: string) => void
  onReset?: (() => void) | undefined
  width?: number | undefined
}) {
  const style = props.width === undefined ? inputStyle : { ...inputStyle, width: props.width }
  return (
    <label>
      <span style={labelStyle}>
        {props.label}
        {props.view.overridden ? ' *' : ''}
      </span>
      <input
        type="text"
        value={props.view.text}
        disabled={props.disabled}
        style={props.view.invalid ? { ...style, outline: '1px solid #b33' } : style}
        onChange={event => { props.onEdit(event.target.value) }}
      />
      {props.onReset !== undefined
        ? (
            <button type="button" style={{ ...buttonStyle, marginLeft: 4 }} disabled={props.disabled} onClick={props.onReset}>
              reset
            </button>
          )
        : null}
    </label>
  )
}

function Select(props: {
  label: string
  value: string
  options: readonly string[]
  disabled: boolean
  overridden: boolean
  onEdit: (text: string) => void
}) {
  return (
    <label>
      <span style={labelStyle}>
        {props.label}
        {props.overridden ? ' *' : ''}
      </span>
      <select
        value={props.value}
        disabled={props.disabled}
        style={inputStyle}
        onChange={event => { props.onEdit(event.target.value) }}
      >
        {props.options.map(option => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  )
}

function Checkbox(props: {
  label: string
  checked: boolean
  disabled: boolean
  overridden: boolean
  onEdit: (text: string) => void
}) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={event => { props.onEdit(event.target.checked ? 'true' : 'false') }}
      />
      <span>
        {props.label}
        {props.overridden ? ' *' : ''}
      </span>
    </label>
  )
}

function Row(props: { index: number; row: ModelRowView; disabled: boolean; face: CompactConfigCardFace }) {
  const { face } = props
  const edit = (field: string) => (text: string) => { face.editRow(props.index, field, text) }
  return (
    <div style={{ ...rowStyle, outline: props.row.invalid ? '1px solid #b33' : undefined, padding: 2 }}>
      <input
        type="text"
        placeholder="provider"
        value={props.row.provider.text}
        disabled={props.disabled}
        style={{ ...inputStyle, width: 110 }}
        onChange={event => { edit('provider')(event.target.value) }}
      />
      <input
        type="text"
        placeholder="model"
        value={props.row.model.text}
        disabled={props.disabled}
        style={{ ...inputStyle, width: 130 }}
        onChange={event => { edit('model')(event.target.value) }}
      />
      <Select
        label="mode"
        value={props.row.mode}
        options={['first', 'tokens']}
        disabled={props.disabled}
        overridden={false}
        onEdit={edit('mode')}
      />
      <input
        type="text"
        placeholder="ratio"
        value={props.row.ratio.text}
        disabled={props.disabled}
        style={{ ...inputStyle, width: 60 }}
        onChange={event => { edit('ratio')(event.target.value) }}
      />
      <input
        type="text"
        placeholder="tokens"
        value={props.row.tokens.text}
        disabled={props.disabled}
        style={{ ...inputStyle, width: 80 }}
        onChange={event => { edit('tokens')(event.target.value) }}
      />
      <Select
        label="retain"
        value={props.row.retainKind}
        options={['none', 'ratio', 'tokens']}
        disabled={props.disabled}
        overridden={false}
        onEdit={edit('retainKind')}
      />
      <input
        type="text"
        placeholder="retain value"
        value={props.row.retainValue.text}
        disabled={props.disabled}
        style={{ ...inputStyle, width: 80 }}
        onChange={event => { edit('retainValue')(event.target.value) }}
      />
      <Checkbox
        label="disabled"
        checked={props.row.disabled}
        disabled={props.disabled}
        overridden={false}
        onEdit={edit('disabled')}
      />
      <button type="button" style={buttonStyle} disabled={props.disabled} onClick={() => { face.removeRow(props.index) }}>
        remove
      </button>
    </div>
  )
}

/**
 * Render the compact-handoff card.
 * @param props - the card snapshot and its form actions.
 * @returns the card, or nothing when the namespace is unavailable.
 */
export function CompactConfigCard(props: CompactConfigCardProps) {
  const state = props.useCard(snapshot => snapshot)
  if (!state.available) return null
  const face = props as unknown as CompactConfigCardFace
  const disabled = !state.writable
  const blocked = !state.dirty || state.invalid || state.saving
  const sectionReset = (section: string) => () => { face.resetField(section) }
  return (
    <li style={{ listStyle: 'none', border: '1px solid #ddd', borderRadius: 6, padding: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 2 }}>Handoff auto-compact</div>
      <p style={hintStyle}>
        Edits apply to handoff-config.json on save; external file edits are adopted here.
        {' *'} marks a value the user layer overrides.
      </p>
      {!state.writable ? <p style={hintStyle} role="status">The Host document is read-only.</p> : null}

      <div style={sectionStyle}>
        <div style={{ fontWeight: 600 }}>Trigger</div>
        <div style={rowStyle}>
          <Select
            label="mode"
            value={state.fields['trigger.mode']!.text}
            options={['first', 'tokens']}
            disabled={disabled}
            overridden={state.fields['trigger.mode']!.overridden}
            onEdit={text => { face.edit('trigger.mode', text) }}
          />
          <Field
            label="ratio (0-1]"
            view={state.fields['trigger.ratio']!}
            disabled={disabled}
            onEdit={text => { face.edit('trigger.ratio', text) }}
            onReset={sectionReset('trigger')}
            width={70}
          />
          <Field
            label="tokens"
            view={state.fields['trigger.tokens']!}
            disabled={disabled}
            onEdit={text => { face.edit('trigger.tokens', text) }}
            width={90}
          />
          <span style={hintStyle}>
            {state.preview.thresholdTokens === undefined
              ? 'threshold: ratio-based (use /compact-config test for the effective value)'
              : 'threshold: ~' + String(state.preview.thresholdTokens) + ' tokens (pure-tokens mode)'}
          </span>
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={{ fontWeight: 600 }}>Retain</div>
        <div style={rowStyle}>
          <Select
            label="kind"
            value={state.fields['retain.kind']!.text}
            options={['none', 'ratio', 'tokens']}
            disabled={disabled}
            overridden={state.fields['retain.kind']!.overridden}
            onEdit={text => { face.edit('retain.kind', text) }}
          />
          <Field
            label="value"
            view={state.fields['retain.value']!}
            disabled={disabled}
            onEdit={text => { face.edit('retain.value', text) }}
            onReset={sectionReset('retain')}
            width={90}
          />
          <span style={hintStyle}>ratio and tokens are mutually exclusive; the non-empty one wins.</span>
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={{ fontWeight: 600 }}>Archive</div>
        <div style={rowStyle}>
          <Field
            label="root"
            view={state.fields['archive.root']!}
            disabled={disabled}
            onEdit={text => { face.edit('archive.root', text) }}
            onReset={sectionReset('archive')}
            width={200}
          />
          <Checkbox
            label="git-exclude"
            checked={state.fields['archive.gitExclude']?.text === 'true'}
            disabled={disabled}
            overridden={state.fields['archive.gitExclude']?.overridden === true}
            onEdit={text => { face.edit('archive.gitExclude', text) }}
          />
          <Select
            label="on failure"
            value={state.fields['archive.onFailure']!.text}
            options={['block', 'proceed']}
            disabled={disabled}
            overridden={state.fields['archive.onFailure']!.overridden}
            onEdit={text => { face.edit('archive.onFailure', text) }}
          />
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={{ fontWeight: 600 }}>Summarization</div>
        <div style={rowStyle}>
          <Field
            label="provider"
            view={state.fields['summarization.provider']!}
            disabled={disabled}
            onEdit={text => { face.edit('summarization.provider', text) }}
            onReset={sectionReset('summarization')}
            width={120}
          />
          <Field
            label="model"
            view={state.fields['summarization.model']!}
            disabled={disabled}
            onEdit={text => { face.edit('summarization.model', text) }}
            width={140}
          />
          <Field
            label="max tokens"
            view={state.fields['summarization.maxTokens']!}
            disabled={disabled}
            onEdit={text => { face.edit('summarization.maxTokens', text) }}
            width={90}
          />
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={{ fontWeight: 600 }}>Retries</div>
        <div style={rowStyle}>
          <Field
            label="compaction retries"
            view={state.fields['retries.compactionRetries']!}
            disabled={disabled}
            onEdit={text => { face.edit('retries.compactionRetries', text) }}
            onReset={sectionReset('retries')}
            width={60}
          />
          <Field
            label="overflow retries"
            view={state.fields['retries.maxOverflowRetries']!}
            disabled={disabled}
            onEdit={text => { face.edit('retries.maxOverflowRetries', text) }}
            width={60}
          />
        </div>
      </div>

      <div style={sectionStyle}>
        <Checkbox
          label="auto-compact enabled"
          checked={state.auto.value}
          disabled={disabled}
          overridden={state.auto.overridden}
          onEdit={text => { face.edit('auto', text) }}
        />
        <button type="button" style={{ ...buttonStyle, marginLeft: 8 }} disabled={disabled} onClick={sectionReset('auto')}>
          reset
        </button>
      </div>

      <div style={sectionStyle}>
        <div style={{ fontWeight: 600 }}>Model presets</div>
        <div>
          {state.models.rows.map((row, index) => (
            <Row key={index} index={index} row={row} disabled={disabled} face={face} />
          ))}
        </div>
        <button type="button" style={buttonStyle} disabled={disabled} onClick={() => { face.addRow() }}>
          add row
        </button>
        <button
          type="button"
          style={{ ...buttonStyle, marginLeft: 6 }}
          disabled={disabled}
          onClick={sectionReset('models')}
        >
          reset
        </button>
      </div>

      {state.invalid ? <p style={errorStyle} role="alert">Some staged values are invalid; fix them to save.</p> : null}
      {state.failed ? <p style={errorStyle} role="alert">The last save did not land; your edits are kept.</p> : null}
      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        <button type="button" style={buttonStyle} disabled={!state.dirty || state.saving} onClick={() => { face.discard() }}>
          discard
        </button>
        <button
          type="button"
          style={{ ...buttonStyle, fontWeight: 600 }}
          disabled={blocked}
          onClick={() => { face.save() }}
        >
          {state.saving ? 'saving...' : 'save'}
        </button>
      </div>
    </li>
  )
}
