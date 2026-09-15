/**
 * Shared card chrome for client-card plugins — presentation only, extracted
 * verbatim from web-compact-config/src/client/Card.tsx (behavior-unchanged
 * extraction, plugin-kit plan K3-1; provenance: proven M3 rendering plus the
 * header-sibling rule of commit 6c52415). A card imports these by RELATIVE
 * path and supplies its own vocabulary inside the shell slots; the shell owns
 * the disclosure open state so cards do not re-create it.
 *
 * Inline styles only; no icon packages; value imports here are of react only.
 *
 * @module plugin-kit/client/chrome
 */
import { useState, type CSSProperties, type ReactNode } from 'react'

/** Shorthand style helper: a one-pixel solid border in the given color. */
export const border = (color: string): string => '1px solid ' + color

// ---- design tokens (shared; cards may extend locally but never re-invent) ----

export const TOKENS = {
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

export const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: TOKENS.fontSmall,
  color: TOKENS.textMuted,
  marginBottom: 3,
  letterSpacing: 0.2,
}

export const inputStyle: CSSProperties = {
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

export const invalidInputStyle: CSSProperties = {
  ...inputStyle,
  borderColor: TOKENS.danger,
  background: TOKENS.dangerSoft,
}

export const disabledInputStyle: CSSProperties = {
  ...inputStyle,
  background: TOKENS.disabledBackground,
  cursor: 'not-allowed',
  opacity: 0.7,
}

export const sectionStyle: CSSProperties = {
  padding: '14px 0',
  borderTop: border(TOKENS.border),
}

export const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  gap: 10,
  flexWrap: 'wrap',
  marginBottom: 2,
}

export const captionStyle: CSSProperties = {
  fontSize: TOKENS.fontCaption,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.8,
  color: TOKENS.textMuted,
  marginBottom: 8,
}

export const buttonBaseStyle: CSSProperties = {
  padding: '5px 14px',
  fontSize: TOKENS.fontUi,
  borderRadius: TOKENS.radius,
  border: border(TOKENS.borderStrong),
  background: '#ffffff',
  color: TOKENS.text,
  cursor: 'pointer',
  transition: 'background 120ms ease, border-color 120ms ease',
}

export const ghostButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  padding: '4px 10px',
  fontSize: TOKENS.fontSmall,
  borderColor: 'transparent',
  background: 'transparent',
}

export const dangerGhostStyle: CSSProperties = {
  ...ghostButtonStyle,
  color: TOKENS.danger,
}

export const hintStyle: CSSProperties = {
  fontSize: TOKENS.fontSmall,
  color: TOKENS.textMuted,
  lineHeight: 1.45,
}

export const errorStyle: CSSProperties = {
  fontSize: TOKENS.fontSmall,
  color: TOKENS.danger,
  background: TOKENS.dangerSoft,
  border: border(TOKENS.danger),
  borderRadius: TOKENS.radius,
  padding: '7px 10px',
  margin: '10px 0',
  lineHeight: 1.45,
}

export const warnBannerStyle: CSSProperties = {
  fontSize: TOKENS.fontSmall,
  color: TOKENS.warn,
  background: TOKENS.warnSoft,
  border: border(TOKENS.warn),
  borderRadius: TOKENS.radius,
  padding: '7px 10px',
  margin: '10px 0',
  lineHeight: 1.45,
}

export const PILL_TONES = {
  neutral: { color: TOKENS.textMuted, background: TOKENS.disabledBackground },
  accent: { color: TOKENS.accent, background: TOKENS.accentSoft },
  danger: { color: TOKENS.danger, background: TOKENS.dangerSoft },
} as const

/** A pill state: the tone palette plus the flag that decides its visibility. */
export type PillState = { tone: keyof typeof PILL_TONES; label: string; active: boolean }

export function pillStyle(active: boolean, tone: keyof typeof PILL_TONES): CSSProperties {
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

/**
 * Derive the header status pill from pure card-state booleans. The priority
 * order (invalid > saving > dirty > failed) is behavior: highest-priority flag
 * wins, none set = no pill.
 */
export function deriveHeaderPill(state: {
  invalid: boolean
  saving: boolean
  dirty: boolean
  failed: boolean
}): { tone: keyof typeof PILL_TONES; label: string } | null {
  if (state.invalid) return { tone: 'danger', label: 'invalid edits' }
  if (state.saving) return { tone: 'accent', label: 'saving...' }
  if (state.dirty) return { tone: 'accent', label: 'unsaved edits' }
  if (state.failed) return { tone: 'danger', label: 'last save failed' }
  return null
}

/** Overridden mark: accent asterisk, explained on hover. */
export function Overridden() {
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

/** Structural view of one field value (matches the card controllers' FieldView). */
export interface FieldViewLike {
  text: string
  overridden?: boolean
  invalid?: boolean
}

export function Field(props: {
  label: string
  view: FieldViewLike
  disabled: boolean
  onEdit: (text: string) => void
  onReset?: (() => void) | undefined
  width?: number | undefined
  numeric?: boolean | undefined
}) {
  const base = props.disabled ? disabledInputStyle : inputStyle
  const style = props.width === undefined ? base : { ...base, width: props.width }
  const shown = props.view.invalid === true ? { ...style, ...invalidInputStyle } : style
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
        aria-invalid={props.view.invalid === true}
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

export function Select(props: {
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

export function Checkbox(props: {
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

// ---- card shell (disclosure chrome mirroring the built-in plugin cards) ----

export const cardStyle: CSSProperties = {
  listStyle: 'none',
  border: border(TOKENS.border),
  borderRadius: 12,
  background: '#fff',
  transition: 'border-color 160ms, background 160ms',
}

export const cardOpenStyle: CSSProperties = {
  border: border(TOKENS.borderStrong),
}

export const headerStyle: CSSProperties = {
  width: '100%',
  appearance: 'none',
  border: 'none',
  background: 'none',
  font: 'inherit',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '14px 16px',
  borderRadius: 12,
}

export const headTextStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

export const headNameStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  fontSize: 15,
  fontWeight: 600,
  lineHeight: 1.4,
  color: TOKENS.text,
}

export const headDescriptionStyle: CSSProperties = {
  fontSize: TOKENS.fontUi,
  lineHeight: 1.5,
  color: TOKENS.textMuted,
}

export const bodyStyle: CSSProperties = {
  borderTop: border(TOKENS.border),
  margin: '0 16px',
  padding: '12px 0 8px',
}

/** Simple inline chevron (no icon-package import; the client bundle is pure). */
export function Chevron(props: { open: boolean }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox='0 0 16 16'
      fill='none'
      stroke={TOKENS.textMuted}
      strokeWidth={1.6}
      strokeLinecap='round'
      strokeLinejoin='round'
      style={{ flex: 'none', transition: 'transform 160ms', transform: props.open ? 'rotate(180deg)' : 'none' }}
      aria-hidden='true'
    >
      <path d='M3 6l5 5 5-5' />
    </svg>
  )
}

export const headerRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  paddingRight: 4,
}

/** Small switch toggle (role="switch") built from inline styles only. */
export function Switch(props: {
  checked: boolean
  disabled: boolean
  /** Accessible name; falls back to the title. */
  label?: string | undefined
  title: string
  onToggle: (next: boolean) => void
}) {
  const track: CSSProperties = {
    flex: 'none',
    width: 34,
    height: 20,
    borderRadius: 999,
    border: border(props.checked ? TOKENS.accent : TOKENS.borderStrong),
    background: props.checked ? TOKENS.accent : TOKENS.disabledBackground,
    position: 'relative',
    cursor: props.disabled ? 'not-allowed' : 'pointer',
    padding: 0,
    appearance: 'none',
    transition: 'background 160ms, border-color 160ms',
    opacity: props.disabled ? 0.7 : 1,
  }
  const knob: CSSProperties = {
    position: 'absolute',
    top: 1,
    left: props.checked ? 15 : 1,
    width: 16,
    height: 16,
    borderRadius: 999,
    background: '#fff',
    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
    transition: 'left 160ms',
  }
  return (
    <button
      type='button'
      role='switch'
      aria-checked={props.checked}
      aria-label={props.label ?? props.title}
      title={props.title}
      disabled={props.disabled}
      style={track}
      onClick={() => { props.onToggle(!props.checked) }}
    >
      <span style={knob} />
    </button>
  )
}

/**
 * Card disclosure chrome. The header button is always visible and toggles the
 * card-local open state; the body exists in the tree only while open. The
 * head row carries optional sibling controls (NOT nested inside the button —
 * a control must not nest inside another button; proven on 6c52415).
 */
export function PluginCardShell(props: {
  /** The card title in the disclosure head. */
  title: string
  /** The muted description line under the title. */
  description: string
  /** Title attribute over the description ("what happens on save" text). */
  descriptionTitle?: string
  /** aria-label for the disclosure button in both states ("Expand: " / "Collapse: " titles). */
  disclosureLabel: string
  /** Header status pill (priority already derived — see deriveHeaderPill). */
  pill?: { tone: keyof typeof PILL_TONES; label: string } | null | undefined
  /** Optional head sibling control: the master switch beside the button. */
  switchChecked?: boolean
  switchDisabled?: boolean
  switchTitle?: string
  switchLabel?: string | undefined
  onSwitchToggle?: (next: boolean) => void
  /** The card body; rendered only while open. */
  body: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const hasSwitch = props.switchTitle !== undefined && props.onSwitchToggle !== undefined
  return (
    <li style={open ? { ...cardStyle, ...cardOpenStyle } : cardStyle}>
      <div style={headerRowStyle}>
        <button
          type='button'
          style={headerStyle}
          aria-expanded={open}
          aria-label={(open ? 'Collapse: ' : 'Expand: ') + props.disclosureLabel}
          onClick={() => { setOpen(!open) }}
        >
          <span style={headTextStyle}>
            <span style={headNameStyle}>
              {props.title}
              {props.pill !== null && props.pill !== undefined
                ? (
                    <span
                      style={{
                        ...pillStyle(true, props.pill.tone),
                        fontSize: 11,
                        padding: '1px 8px',
                        whiteSpace: 'nowrap',
                      }}
                    >{props.pill.label}</span>
                  )
                : null}
            </span>
            <span style={headDescriptionStyle} title={props.descriptionTitle}>{props.description}</span>
          </span>
          <Chevron open={open} />
        </button>
        {hasSwitch
          ? (
              <Switch
                checked={props.switchChecked === true}
                disabled={props.switchDisabled === true}
                label={props.switchLabel}
                title={props.switchTitle!}
                onToggle={props.onSwitchToggle!}
              />
            )
          : null}
      </div>
      {open ? <div style={bodyStyle}>{props.body}</div> : null}
    </li>
  )
}
