/**
 * The compact-handoff settings card: staged fields over the handoff config's
 * user layer, a models table, and a pure-tokens live preview. Presentation
 * only - all form semantics live in the controller. Inline styles only (no
 * CSS pipeline); plain-English labels (i18n deferred). Renders nothing while
 * the Host does not serve the namespace.
 *
 * Visual chrome (tokens, head, pills, chevron, switch, banners, shared field
 * widgets) lives in plugin-kit chrome — extracted without behavior change
 * (plugin-kit plan K3-1); this file keeps only the handoff vocabulary:
 * state wiring, vocabulary sections, model rows, and the action footer.
 *
 * @module web-compact-config/client/Card
 */

import { useState } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { CompactConfigCardFace, FieldView, ModelRowView } from './controller.ts'
import { Checkbox, Field, PluginCardShell, border, buttonBaseStyle, captionStyle, dangerGhostStyle, errorStyle, ghostButtonStyle, deriveHeaderPill, hintStyle, inputStyle, labelStyle, rowStyle, sectionStyle, Select, TOKENS, warnBannerStyle } from '../../../plugin-kit/src/client/chrome.tsx'

/** Props the renderer binds for the compact-handoff card. */
export type CompactConfigCardProps =
  PropsRuntime<'settings.plugin.item'>
  & InjectFace<CompactConfigCardFace>

/** One model-preset row: the handoff vocabulary over the kit field widgets. */
function Row(props: { index: number; row: ModelRowView; disabled: boolean; face: CompactConfigCardFace }) {
  const face = props.face
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
      <Field
        label='ratio (0-1]'
        view={props.row.ratio}
        disabled={props.disabled}
        onEdit={edit('ratio')}
        width={70}
        numeric
      />
      <Field
        label='tokens'
        view={props.row.tokens}
        disabled={props.disabled}
        onEdit={edit('tokens')}
        width={90}
        numeric
      />
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

  // Header pills follow the built-in cards: collapsed cards still show what
  // matters (unsaved edits / a failure), like the "unsaved" disclosure mark.
  const headerPill = deriveHeaderPill(state)

  return (
    <PluginCardShell
      title='Handoff auto-compact'
      pill={headerPill}
      description='Staged auto-compact triggers, retention, archiving, and per-model presets'
      descriptionTitle={'Edits are staged and apply to handoff-config.json on save; external file edits are adopted here. * marks a value this layer overrides.'}
      disclosureLabel='Handoff auto-compact'
      switchChecked={state.enabled.value}
      switchDisabled={disabled}
      switchTitle='Master switch: enable or disable the Handoff auto-compact plugin. Staged - it lands in handoff-config.json on save.'
      switchLabel='Enable or disable the Handoff auto-compact plugin'
      onSwitchToggle={next => { face.edit('enabled', next ? 'true' : 'false') }}
      body={<>
      <p style={{ ...hintStyle, margin: '0 0 4px' }}>
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

      </>}
    />
  )
}
