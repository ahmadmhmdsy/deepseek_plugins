/**
 * The compact-handoff settings card: staged fields over the handoff config's
 * user layer, a models table, and a pure-tokens live preview. Presentation
 * only - all form semantics live in the controller. Inline styles only (no
 * CSS pipeline); plain-English labels (i18n deferred). Renders nothing while
 * the Host does not serve the namespace.
 *
 * Visual design (impeccable pass): design tokens for color/type/spacing;
 * header with live status pills; grouped sections with uppercase captions;
 * focus rings + aria attributes on inputs; banner-style errors and notices;
 * separated action footer with primary Save and ghost Discard.
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

// ---- design tokens ----

const TOKENS = {
  text: '#1f2328',
  textMuted: '#8b9199',
  accent: '#3b6ef6',
  accentSoft: 'rgba(59, 110, 246, 0.14)',
  danger: '#c02b33',
  dangerSoft: 'rgba(192, 43, 51, 0.08)',
  warn: '#8a6100',
  warnSoft: 'rgba(200, 150, 10, 0.12)',
  border: '#e2e4e8',
  borderStrong: '#c9ccd2',
  inputBorder: '#d2d5da',
  inputBackground: '#ffffff',
  disabledBackground: '#f5f6f8',
  radius: 6,
  fontUi: 13,
  fontSmall: 12,
  fontCaption: 11,
} as const

const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: TOKENS.fontSmall,
  color: TOKENS.textMuted,
  marginBottom: 3,
  letterSpacing: 0.2,
}

const inputStyle: CSSProperties = {
  width: 160,
  boxSizing: 'border-box',
  padding: '5px 8px',
  fontSize: TOKENS.fontUi,
  color: TOKENS.text,
  border: border(TOKENS.inputBorder),
  borderRadius: TOKENS.radius,
  background: TOKENS.inputBackground,
  transition: 'border-color 120ms ease, box-shadow 120ms ease',
  outline: 'none',
}

const invalidInputStyle: CSSProperties = {
  ...inputStyle,
  borderColor: TOKENS.danger,
  background: TOKENS.dangerSoft,
}

const disabledInputStyle: CSSProperties = {
  ...inputStyle,
  background: TOKENS.disabledBackground,
  cursor: 'not-allowed',
  opacity: 0.7,
}

const sectionStyle: CSSProperties = {
  padding: '14px 0',
  borderTop: border(TOKENS.border),
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  gap: 10,
  flexWrap: 'wrap',
  marginBottom: 2,
}

const captionStyle: CSSProperties = {
  fontSize: TOKENS.fontCaption,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.8,
  color: TOKENS.textMuted,
  marginBottom: 8,
}

const buttonBaseStyle: CSSProperties = {
  padding: '5px 14px',
  fontSize: TOKENS.fontUi,
  borderRadius: TOKENS.radius,
  border: border(TOKENS.borderStrong),
  background: '#ffffff',
  color: TOKENS.text,
  cursor: 'pointer',
  transition: 'background 120ms ease, border-color 120ms ease',
}

const ghostButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  padding: '4px 10px',
  fontSize: TOKENS.fontSmall,
  borderColor: 'transparent',
  background: 'transparent',
}

const dangerGhostStyle: CSSProperties = {
  ...ghostButtonStyle,
  color: TOKENS.danger,
}

const hintStyle: CSSProperties = {
  fontSize: TOKENS.fontSmall,
  color: TOKENS.textMuted,
  lineHeight: 1.45,
}

const errorStyle: CSSProperties = {
  fontSize: TOKENS.fontSmall,
  color: TOKENS.danger,
  background: TOKENS.dangerSoft,
  border: border(TOKENS.danger),
  borderRadius: TOKENS.radius,
  padding: '7px 10px',
  margin: '10px 0',
  lineHeight: 1.45,
}

const warnBannerStyle: CSSProperties = {
  fontSize: TOKENS.fontSmall,
  color: TOKENS.warn,
  background: TOKENS.warnSoft,
  border: border(TOKENS.warn),
  borderRadius: TOKENS.radius,
  padding: '7px 10px',
  margin: '10px 0',
  lineHeight: 1.45,
}

const PILL_TONES = {
  neutral: { color: TOKENS.textMuted, background: TOKENS.disabledBackground },
  accent: { color: TOKENS.accent, background: TOKENS.accentSoft },
  danger: { color: TOKENS.danger, background: TOKENS.dangerSoft },
} as const

function pillStyle(active: boolean, tone: 'neutral' | 'accent' | 'danger'): CSSProperties {
  return {
    display: 'inline-block',
    fontSize: TOKENS.fontCaption,
    fontWeight: 600,
    padding: '2px 9px',
    borderRadius: 999,
    ...PILL_TONES[tone],
    opacity: active ? 1 : 0,
  }
}

/** Overridden mark: accent asterisk, explained on hover. */
function Overridden() {
  return (
    <span
      title='A value customized by this settings layer. Use reset to let it re-inherit the default.'
      style={{ color: TOKENS.accent, cursor: 'help', marginLeft: 2 }}
      aria-label='overridden value'
    >
      *
    </span>
  )
}

function Field(props: {
  label: string
  view: FieldView
  disabled: boolean
  onEdit: (text: string) => void
  onReset?: (() => void) | undefined
  width?: number | undefined
  numeric?: boolean | undefined
}) {
  const base = props.disabled ? disabledInputStyle : inputStyle
  const style = props.width === undefined ? base : { ...base, width: props.width }
  const shown = props.view.invalid ? { ...style, ...invalidInputStyle } : style
  return (
    <span>
      <span style={labelStyle}>
        {props.label}
        {props.view.overridden ? <Overridden /> : null}
      </span>
      <input
        type='text'
        inputMode={props.numeric === true ? 'decimal' : 'text'}
        value={props.view.text}
        disabled={props.disabled}
        aria-invalid={props.view.invalid}
        style={shown}
        onChange={event => { props.onEdit(event.target.value) }}
      />
      {props.onReset !== undefined
        ? (
            <button
              type='button'
              style={{ ...ghostButtonStyle, marginLeft: 2 }}
              disabled={props.disabled}
              onClick={props.onReset}
              title='Clear this section override so it re-inherits the default'
            >
              reset
            </button>
          )
        : null}
    </span>
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
    <span>
      <span style={labelStyle}>
        {props.label}
        {props.overridden ? <Overridden /> : null}
      </span>
      <select
        value={props.value}
        disabled={props.disabled}
        style={{ ...inputStyle, cursor: props.disabled ? 'not-allowed' : 'pointer' }}
        onChange={event => { props.onEdit(event.target.value) }}
      >
        {props.options.map(option => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </span>
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
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: TOKENS.fontUi, padding: '5px 0', cursor: props.disabled ? 'not-allowed' : 'pointer' }}>
      <input
        type='checkbox'
        checked={props.checked}
        disabled={props.disabled}
        onChange={event => { props.onEdit(event.target.checked ? 'true' : 'false') }}
      />
      <span>
        {props.label}
        {props.overridden ? <Overridden /> : null}
      </span>
    </label>
  )
}

function Row(props: { index: number; row: ModelRowView; disabled: boolean; face: CompactConfigCardFace }) {
  const { face } = props
  const edit = (field: string) => (text: string) => { face.editRow(props.index, field, text) }
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: 10,
        flexWrap: 'wrap',
        padding: '10px 12px',
        marginBottom: 8,
        border: border(props.row.invalid ? TOKENS.danger : TOKENS.border),
        borderRadius: TOKENS.radius,
        background: props.row.invalid ? TOKENS.dangerSoft : '#fafbfc',
      }}
    >
      <span>
        <span style={labelStyle}>provider</span>
        <input
          type='text'
          placeholder='e.g. deepseek'
          value={props.row.provider.text}
          disabled={props.disabled}
          aria-invalid={props.row.provider.invalid}
          style={{ ...inputStyle, width: 130 }}
          onChange={event => { edit('provider')(event.target.value) }}
        />
      </span>
      <span>
        <span style={labelStyle}>model</span>
        <input
          type='text'
          placeholder='e.g. deepseek-chat'
          value={props.row.model.text}
          disabled={props.disabled}
          aria-invalid={props.row.model.invalid}
          style={{ ...inputStyle, width: 150 }}
          onChange={event => { edit('model')(event.target.value) }}
        />
      </span>
      <Select
        label='mode'
        value={props.row.mode}
        options={['first', 'tokens']}
        disabled={props.disabled}
        overridden={false}
        onEdit={edit('mode')}
      />
      <Field label='ratio (0-1]' view={props.row.ratio} disabled={props.disabled} onEdit={edit('ratio')} width={70} numeric />
      <Field label='tokens' view={props.row.tokens} disabled={props.disabled} onEdit={edit('tokens')} width={90} numeric />
      <Select
        label='retain'
        value={props.row.retainKind}
        options={['none', 'ratio', 'tokens']}
        disabled={props.disabled}
        overridden={false}
        onEdit={edit('retainKind')}
      />
      <Field
        label='retain value'
        view={props.row.retainValue}
        disabled={props.disabled}
        onEdit={edit('retainValue')}
        width={90}
        numeric={props.row.retainKind !== 'none'}
      />
      <Checkbox
        label='disabled'
        checked={props.row.disabled}
        disabled={props.disabled}
        overridden={false}
        onEdit={edit('disabled')}
      />
      <button
        type='button'
        style={dangerGhostStyle}
        disabled={props.disabled}
        onClick={() => { face.removeRow(props.index) }}
        title='Remove this preset'
      >
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
    <li style={{ listStyle: 'none', padding: 0 }}>
      <div style={{ border: border(TOKENS.border), borderRadius: 10, padding: 16, background: '#fff' }}>

        {/* header: title + live status pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: TOKENS.text }}>Handoff auto-compact</span>
          <span style={pillStyle(state.invalid, 'danger')} aria-live='polite'>invalid edits</span>
          <span style={pillStyle(!state.invalid && state.saving, 'accent')}>saving...</span>
          <span style={pillStyle(!state.invalid && !state.saving && state.dirty, 'accent')}>unsaved edits</span>
          <span style={pillStyle(!state.invalid && !state.saving && !state.dirty && state.failed, 'danger')}>last save failed</span>
        </div>
        <p style={{ ...hintStyle, margin: '2px 0 0' }}>
          Edits are staged and apply to handoff-config.json on save; external file edits
          are adopted here. <span style={{ color: TOKENS.accent }}>*</span> marks a value
          this layer overrides.
        </p>

        {!state.writable ? (
          <p style={warnBannerStyle} role='status'>
            The Host document is read-only - you can look around, but nothing can be
            staged or saved until it becomes writable.
          </p>
        ) : null}

        {/* Trigger */}
        <div style={{ ...sectionStyle, borderTop: 'none' }}>
          <div style={captionStyle}>Trigger</div>
          <div style={rowStyle}>
            <Select
              label='mode'
              value={state.fields['trigger.mode']!.text}
              options={['first', 'tokens']}
              disabled={disabled}
              overridden={state.fields['trigger.mode']!.overridden}
              onEdit={text => { face.edit('trigger.mode', text) }}
            />
            <Field
              label='ratio (0-1]'
              view={state.fields['trigger.ratio']!}
              disabled={disabled}
              onEdit={text => { face.edit('trigger.ratio', text) }}
              onReset={sectionReset('trigger')}
              width={80}
              numeric
            />
            <Field
              label='tokens'
              view={state.fields['trigger.tokens']!}
              disabled={disabled}
              onEdit={text => { face.edit('trigger.tokens', text) }}
              width={100}
              numeric
            />
            <span style={{ ...hintStyle, paddingBottom: 6 }}>
              {state.preview.thresholdTokens === undefined
                ? 'threshold: ratio-based (run /compact-config test for the effective value)'
                : 'threshold: ~' + String(state.preview.thresholdTokens) + ' tokens'}
            </span>
          </div>
        </div>

        {/* Retain */}
        <div style={sectionStyle}>
          <div style={captionStyle}>Retain</div>
          <div style={rowStyle}>
            <Select
              label='kind'
              value={state.fields['retain.kind']!.text}
              options={['none', 'ratio', 'tokens']}
              disabled={disabled}
              overridden={state.fields['retain.kind']!.overridden}
              onEdit={text => { face.edit('retain.kind', text) }}
            />
            <Field
              label='value'
              view={state.fields['retain.value']!}
              disabled={disabled}
              onEdit={text => { face.edit('retain.value', text) }}
              onReset={sectionReset('retain')}
              width={100}
              numeric={state.fields['retain.kind']!.text !== 'none'}
            />
          </div>
          <p style={{ ...hintStyle, margin: '4px 0 0' }}>
            ratio and tokens are mutually exclusive; the non-empty one wins.
          </p>
        </div>

        {/* Archive */}
        <div style={sectionStyle}>
          <div style={captionStyle}>Archive</div>
          <div style={rowStyle}>
            <Field
              label='root'
              view={state.fields['archive.root']!}
              disabled={disabled}
              onEdit={text => { face.edit('archive.root', text) }}
              onReset={sectionReset('archive')}
              width={220}
            />
            <Checkbox
              label='git-exclude'
              checked={state.fields['archive.gitExclude']?.text === 'true'}
              disabled={disabled}
              overridden={state.fields['archive.gitExclude']?.overridden === true}
              onEdit={text => { face.edit('archive.gitExclude', text) }}
            />
            <Select
              label='on failure'
              value={state.fields['archive.onFailure']!.text}
              options={['block', 'proceed']}
              disabled={disabled}
              overridden={state.fields['archive.onFailure']!.overridden}
              onEdit={text => { face.edit('archive.onFailure', text) }}
            />
          </div>
          <p style={{ ...hintStyle, margin: '4px 0 0' }}>
            Archive root (relative to the session working directory; handoff + pointer
            index live under it). block halts a compaction whose handoff could not be
            written; proceed lets it continue.
          </p>
        </div>

        {/* Summarization */}
        <div style={sectionStyle}>
          <div style={captionStyle}>Summarization</div>
          <div style={rowStyle}>
            <Field
              label='provider'
              view={state.fields['summarization.provider']!}
              disabled={disabled}
              onEdit={text => { face.edit('summarization.provider', text) }}
              onReset={sectionReset('summarization')}
              width={130}
            />
            <Field
              label='model'
              view={state.fields['summarization.model']!}
              disabled={disabled}
              onEdit={text => { face.edit('summarization.model', text) }}
              width={150}
            />
            <Field
              label='max tokens'
              view={state.fields['summarization.maxTokens']!}
              disabled={disabled}
              onEdit={text => { face.edit('summarization.maxTokens', text) }}
              width={100}
              numeric
            />
          </div>
          <p style={{ ...hintStyle, margin: '4px 0 0' }}>
            Empty provider + model = write the handoff with the session's own model.
          </p>
        </div>

        {/* Retries */}
        <div style={sectionStyle}>
          <div style={captionStyle}>Retries</div>
          <div style={rowStyle}>
            <Field
              label='compaction retries'
              view={state.fields['retries.compactionRetries']!}
              disabled={disabled}
              onEdit={text => { face.edit('retries.compactionRetries', text) }}
              onReset={sectionReset('retries')}
              width={70}
              numeric
            />
            <Field
              label='overflow retries'
              view={state.fields['retries.maxOverflowRetries']!}
              disabled={disabled}
              onEdit={text => { face.edit('retries.maxOverflowRetries', text) }}
              width={70}
              numeric
            />
          </div>
        </div>

        {/* Switches */}
        <div style={sectionStyle}>
          <div style={captionStyle}>Switches</div>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Checkbox
                  label='plugin enabled'
                  checked={state.enabled.value}
                  disabled={disabled}
                  overridden={state.enabled.overridden}
                  onEdit={text => { face.edit('enabled', text) }}
                />
                <button
                  type='button'
                  style={ghostButtonStyle}
                  disabled={disabled}
                  onClick={sectionReset('enabled')}
                  title='Clear the enabled override so it re-inherits the default'
                >
                  reset
                </button>
              </span>
              <p style={{ ...hintStyle, margin: '2px 0 0', maxWidth: 330 }}>
                Master switch - off means no auto-compact and no archiving at all.
              </p>
            </span>
            <span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Checkbox
                  label='auto-compact enabled'
                  checked={state.auto.value}
                  disabled={disabled}
                  overridden={state.auto.overridden}
                  onEdit={text => { face.edit('auto', text) }}
                />
                <button
                  type='button'
                  style={ghostButtonStyle}
                  disabled={disabled}
                  onClick={sectionReset('auto')}
                  title='Clear the auto override so it re-inherits the default'
                >
                  reset
                </button>
              </span>
              <p style={{ ...hintStyle, margin: '2px 0 0', maxWidth: 330 }}>
                Gates only the automatic pressure trigger - manual compaction still
                archives a handoff while plugin enabled is on.
              </p>
            </span>
          </div>
        </div>

        {/* Model presets */}
        <div style={{ ...sectionStyle, paddingBottom: 4 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ ...captionStyle, marginBottom: 8 }}>Model presets</div>
            <span style={{ ...hintStyle, marginLeft: 'auto', paddingBottom: 8 }}>
              Per-model trigger/retain overrides; provider + model must both be filled,
              or both empty.
            </span>
          </div>
          <div>
            {state.models.rows.map((row, index) => (
              <Row key={index} index={index} row={row} disabled={disabled} face={face} />
            ))}
            {state.models.rows.length === 0
              ? <p style={{ ...hintStyle, fontStyle: 'italic', margin: '4px 0 10px' }}>
                  No model presets - the global trigger applies to every model.
                </p>
              : null}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type='button'
              style={ghostButtonStyle}
              disabled={disabled}
              onClick={() => { face.addRow() }}
              title='Append an empty preset row'
            >
              + add row
            </button>
            <button
              type='button'
              style={ghostButtonStyle}
              disabled={disabled}
              onClick={sectionReset('models')}
              title='Clear the models override so it re-inherits the default'
            >
              reset
            </button>
          </div>
        </div>

        {/* banners */}
        {state.invalid ? (
          <p style={errorStyle} role='alert'>
            Some staged values are invalid (marked in red). Fix them to enable Save.
          </p>
        ) : null}
        {state.failed ? (
          <p style={errorStyle} role='alert'>
            The last save did not land (the Host document may have changed). Your edits
            are kept - review and save again, or discard.
          </p>
        ) : null}

        {/* action footer */}
        <div style={{
          marginTop: 12,
          paddingTop: 14,
          borderTop: border(TOKENS.border),
          display: 'flex',
          gap: 10,
          alignItems: 'center',
        }}>
          <button
            type='button'
            style={buttonBaseStyle}
            disabled={!state.dirty || state.saving}
            onClick={() => { face.discard() }}
            title='Throw away the staged edits and re-read the saved values'
          >
            discard
          </button>
          <button
            type='button'
            style={{
              ...buttonBaseStyle,
              fontWeight: 600,
              background: TOKENS.accent,
              borderColor: TOKENS.accent,
              color: '#ffffff',
            }}
            disabled={blocked}
            onClick={() => { face.save() }}
            title={state.invalid
              ? 'Fix the invalid (red) values first'
              : !state.dirty ? 'No staged edits to save' : undefined}
          >
            {state.saving ? 'saving...' : 'save'}
          </button>
          <span style={{ ...hintStyle, marginLeft: 'auto' }}>
            {state.dirty && !state.invalid
              ? 'Staged edits will replace the named sections user layer.'
              : null}
          </span>
        </div>
      </div>
    </li>
  )
}
