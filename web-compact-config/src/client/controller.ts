/**
 * Staged form behind the compact-handoff settings card. The GENERIC machinery
 * (staged drafts, pendingClear, save plan, write-verify, projection life-
 * cycle) was extracted into plugin-kit settings-form (plan K3-2, behavior-
 * unchanged); this file is the thin handoff subclass declaring the FormSpec
 * and supplying the vocabulary hooks.
 *
 * @module web-compact-config/client/controller
 */
import type { SettingsScope, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import {
  StagedSettingsForm, fieldView, isInvalid,
  parseNonNegativeIntText, parsePositiveIntText, parseRatioText,
  numToText, strToText, boolValue,
  type FieldView, type FormSpec, type ParsedNumber,
  type RowDraft,
} from '../../../plugin-kit/src/client/settings-form.ts'

/** The namespace this card edits — spelled here: a client package must not depend on a Host package. */
export const COMPACT_HANDOFF_NS = 'compact-handoff'

/** Re-exported shared view type (the kit contract; old import paths keep working). */
export type { FieldView }

/** One object-valued member of the handoff config user layer. */
type Section = Record<string, unknown>

/** Resolved handoff config as the schema serves it (absent optional scalars omitted). */
export interface HandoffSettings {
  trigger?: Section
  retain?: Section
  archive?: Section
  summarization?: Section
  retries?: Section
  enabled?: boolean
  auto?: boolean
  models?: Section[]
}

/** One editable models-table row. */
export interface ModelRowView {
  provider: FieldView
  model: FieldView
  /** 'first' | 'tokens' */
  mode: string
  ratio: FieldView
  tokens: FieldView
  /** 'none' | 'ratio' | 'tokens' */
  retainKind: string
  retainValue: FieldView
  disabled: boolean
  invalid: boolean
}

/** Card state every render reads through the bound hook. */
export interface CompactConfigCardState {
  available: boolean
  writable: boolean
  dirty: boolean
  invalid: boolean
  saving: boolean
  failed: boolean
  /** Section fields keyed by dotted path ('trigger.ratio', 'archive.root', ...). */
  fields: Record<string, FieldView>
  /** Global plugin master switch (boolean control, not draft text). */
  enabled: { value: boolean; overridden: boolean }
  /** Global auto toggle (boolean control, not draft text). */
  auto: { value: boolean; overridden: boolean }
  models: { rows: ModelRowView[]; overridden: boolean }
  /** Pure-tokens effective threshold from the staged values; undefined when ratio-based. */
  preview: { thresholdTokens: number | undefined }
}

/** The registration-side face the card's slot entry injects. */
export interface CompactConfigCardFace {
  hooks: {
    /** Card snapshot bound by the renderer as useCard. */
    card: SnapshotStore<CompactConfigCardState>
  }
  /** Stage draft text for one field (or 'true'/'false' for the 'auto'/'enabled' toggles). */
  edit: (field: string, text: string) => void
  /** Stage a section clear, so saving lets it re-inherit the defaults. */
  resetField: (section: string) => void
  /** Write every staged edit, then re-seed from what the Host accepted. */
  save: () => void
  /** Drop every staged edit. */
  discard: () => void
  /** Stage an edit inside one models-table row. */
  editRow: (index: number, field: string, text: string) => void
  /** Append an empty row. */
  addRow: () => void
  /** Remove one row. */
  removeRow: (index: number) => void
}

/** The handoff vocabulary of the staged form (the FormSpec instance). */
const SPEC: FormSpec = {
  sections: ['trigger', 'retain', 'archive', 'summarization', 'retries'],
  booleans: [
    { key: 'auto', defaultValue: true },
    { key: 'enabled', defaultValue: true },
  ],
  rowsKey: 'models',
} as const

/** Typed shape of one models-table draft row (view over the generic RowDraft). */
interface TypedRowDraft {
  provider: string
  model: string
  mode: string
  ratio: string
  tokens: string
  retainKind: string
  retainValue: string
  disabled: boolean
}

/**
 * Bridges the compact-handoff scope onto the card's staged form. The generic
 * machinery (staging/clears/discard/save/write-verify) lives in the kit base
 * class; everything below is the handoff vocabulary.
 */
export class CompactConfigCardController
  extends StagedSettingsForm<HandoffSettings, CompactConfigCardState> {
  /** @param scope - the bound settings scope for the compact-handoff namespace. */
  public constructor(scope: SettingsScope<HandoffSettings>) {
    super(SPEC, scope)
  }

  /** Build the face the card's slot registration injects. */
  public inject(): CompactConfigCardFace {
    return {
      hooks: { card: this.store as unknown as SnapshotStore<CompactConfigCardState> },
      edit: (field, text) => { this.edit(field, text) },
      resetField: (section) => { this.resetField(section) },
      save: () => { void this.save() },
      discard: () => { this.discard() },
      editRow: (index, field, text) => { this.editRow(index, field, text) },
      addRow: () => { this.addRow() },
      removeRow: (index) => { this.removeRow(index) },
    }
  }

  // ---- vocabulary hooks ----

  protected acceptSectionEdit(
    section: string,
    key: string,
    text: string,
    draft: Section,
    effective: Section,
  ): void {
    void effective
    if (section === 'trigger') {
      const d = draft as unknown as { mode: string; ratio: string; tokens: string }
      if (key === 'mode') d.mode = text === 'tokens' ? 'tokens' : 'first'
      else if (key === 'ratio') d.ratio = text
      else if (key === 'tokens') d.tokens = text
    } else if (section === 'retain') {
      const d = draft as unknown as { kind: string; value: string }
      if (key === 'kind') d.kind = ['none', 'ratio', 'tokens'].includes(text) ? text : d.kind
      else if (key === 'value') d.value = text
    } else if (section === 'archive') {
      const d = draft as unknown as { root: string; gitExclude: boolean; onFailure: string }
      if (key === 'root') d.root = text
      else if (key === 'gitExclude') d.gitExclude = text === 'true'
      else if (key === 'onFailure') d.onFailure = text === 'proceed' ? 'proceed' : 'block'
    } else if (section === 'summarization') {
      const d = draft as unknown as { provider: string; model: string; maxTokens: string }
      if (key === 'provider') d.provider = text
      else if (key === 'model') d.model = text
      else if (key === 'maxTokens') d.maxTokens = text
    } else if (section === 'retries') {
      const d = draft as unknown as { compactionRetries: string; maxOverflowRetries: string }
      if (key === 'compactionRetries') d.compactionRetries = text
      else if (key === 'maxOverflowRetries') d.maxOverflowRetries = text
    }
  }

  protected acceptRowEdit(row: RowDraft, index: number, field: string, text: string): void {
    void index
    const d = row as unknown as TypedRowDraft
    if (field === 'disabled') d.disabled = text === 'true'
    else if (field === 'mode') d.mode = text === 'tokens' ? 'tokens' : 'first'
    else if (field === 'retainKind') d.retainKind = ['none', 'ratio', 'tokens'].includes(text) ? text : d.retainKind
    else if (field === 'provider') d.provider = text
    else if (field === 'model') d.model = text
    else if (field === 'ratio') d.ratio = text
    else if (field === 'tokens') d.tokens = text
    else if (field === 'retainValue') d.retainValue = text
  }

  protected parseSection(section: string, draft: Section): Section | undefined {
    if (section === 'trigger') {
      const d = draft as unknown as { mode: string; ratio: string; tokens: string }
      const ratio = parseRatioText(d.ratio)
      const tokens = parsePositiveIntText(d.tokens)
      if (isInvalid(ratio) || isInvalid(tokens)) return undefined
      const parsed: Section = {}
      if (d.mode === 'tokens') parsed.mode = 'tokens'
      if (ratio.kind === 'value') parsed.ratio = ratio.value
      if (tokens.kind === 'value') parsed.tokens = tokens.value
      return parsed
    }
    if (section === 'retain') {
      const d = draft as unknown as { kind: string; value: string }
      if (d.kind === 'none') return {}
      const parsed = d.kind === 'ratio' ? parseRatioText(d.value) : parsePositiveIntText(d.value)
      if (parsed.kind !== 'value') return undefined
      return d.kind === 'ratio' ? { ratio: parsed.value } : { tokens: parsed.value }
    }
    if (section === 'archive') {
      const d = draft as unknown as { root: string; gitExclude: boolean; onFailure: string }
      const root = d.root.trim()
      const onFailure = d.onFailure === 'proceed' ? 'proceed' : 'block'
      if (root === '' && d.gitExclude === true && onFailure === 'block') return {}
      const parsed: Section = { gitExclude: d.gitExclude, onFailure }
      if (root !== '') parsed.root = root
      return parsed
    }
    if (section === 'summarization') {
      const d = draft as unknown as { provider: string; model: string; maxTokens: string }
      const provider = d.provider.trim()
      const model = d.model.trim()
      if ((provider === '') !== (model === '')) return undefined
      const maxTokens = parsePositiveIntText(d.maxTokens)
      if (isInvalid(maxTokens)) return undefined
      const parsed: Section = {}
      if (provider !== '') {
        parsed.provider = provider
        parsed.model = model
      }
      if (maxTokens.kind === 'value') parsed.maxTokens = maxTokens.value
      return parsed
    }
    const d = draft as unknown as { compactionRetries: string; maxOverflowRetries: string }
    const compactionRetries = parseNonNegativeIntText(d.compactionRetries)
    const maxOverflowRetries = parseNonNegativeIntText(d.maxOverflowRetries)
    if (isInvalid(compactionRetries) || isInvalid(maxOverflowRetries)) return undefined
    const parsed: Section = {}
    if (compactionRetries.kind === 'value') parsed.compactionRetries = compactionRetries.value
    if (maxOverflowRetries.kind === 'value') parsed.maxOverflowRetries = maxOverflowRetries.value
    return parsed
  }

  protected buildRows(): { value: Section[]; invalid: boolean } {
    const presets: Section[] = []
    let invalid = false
    for (const row of this.rowsDrafts()) {
      const r = row as unknown as TypedRowDraft
      const provider = r.provider.trim()
      const model = r.model.trim()
      const ratio = parseRatioText(r.ratio)
      const tokens = parsePositiveIntText(r.tokens)
      const retainParsed = r.retainKind === 'none'
        ? ({ kind: 'omit' } as const)
        : (r.retainKind === 'ratio' ? parseRatioText(r.retainValue) : parsePositiveIntText(r.retainValue))
      const isEmpty = provider === '' && model === '' && ratio.kind === 'omit' && tokens.kind === 'omit'
        && r.retainKind === 'none' && !r.disabled && r.mode === 'first'
      if (isEmpty) continue
      const rowInvalid = (provider === '') !== (model === '')
        || isInvalid(ratio) || isInvalid(tokens)
        || (r.retainKind !== 'none' && retainParsed.kind !== 'value')
      if (rowInvalid) {
        invalid = true
        continue
      }
      const preset: Section = { provider, model }
      if (r.mode === 'tokens' || ratio.kind === 'value' || tokens.kind === 'value') {
        const trigger: Section = {}
        if (r.mode === 'tokens') trigger.mode = 'tokens'
        if (ratio.kind === 'value') trigger.ratio = ratio.value
        if (tokens.kind === 'value') trigger.tokens = tokens.value
        preset.trigger = trigger
      }
      if (r.retainKind !== 'none' && retainParsed.kind === 'value') {
        preset.retain = r.retainKind === 'ratio' ? { ratio: retainParsed.value } : { tokens: retainParsed.value }
      }
      if (r.disabled) preset.disabled = true
      const carried = (this.snapshot().value?.models ?? []).find(candidate =>
        candidate.provider === provider && candidate.model === model)
      if (carried?.summarization !== undefined) preset.summarization = carried.summarization
      if (carried?.retries !== undefined) preset.retries = carried.retries
      presets.push(preset)
    }
    return { value: presets, invalid }
  }

  protected seedMissingKeys(section: string, draft: Section, effective: Section): void {
    if (section === 'trigger') {
      const d = draft as unknown as { mode: string | undefined; ratio: string | undefined; tokens: string | undefined }
      if (d.mode === undefined) d.mode = strToText(effective.mode) === 'tokens' ? 'tokens' : 'first'
      if (d.ratio === undefined) d.ratio = numToText(effective.ratio)
      if (d.tokens === undefined) d.tokens = numToText(effective.tokens)
    } else if (section === 'retain') {
      const d = draft as unknown as { kind: string | undefined; value: string | undefined }
      if (d.kind === undefined) d.kind = effective.ratio !== undefined ? 'ratio' : effective.tokens !== undefined ? 'tokens' : 'none'
      if (d.value === undefined) d.value = d.kind === 'none' ? '' : numToText(d.kind === 'ratio' ? effective.ratio : effective.tokens)
    } else if (section === 'archive') {
      const d = draft as unknown as { root: string | undefined; gitExclude: boolean | undefined; onFailure: string | undefined }
      if (d.root === undefined) d.root = strToText(effective.root)
      if (d.gitExclude === undefined) d.gitExclude = boolValue(effective.gitExclude, true)
      if (d.onFailure === undefined) d.onFailure = strToText(effective.onFailure) === 'proceed' ? 'proceed' : 'block'
    } else if (section === 'summarization') {
      const d = draft as unknown as { provider: string | undefined; model: string | undefined; maxTokens: string | undefined }
      if (d.provider === undefined) d.provider = strToText(effective.provider)
      if (d.model === undefined) d.model = strToText(effective.model)
      if (d.maxTokens === undefined) d.maxTokens = numToText(effective.maxTokens)
    } else if (section === 'retries') {
      const d = draft as unknown as { compactionRetries: string | undefined; maxOverflowRetries: string | undefined }
      if (d.compactionRetries === undefined) d.compactionRetries = numToText(effective.compactionRetries)
      if (d.maxOverflowRetries === undefined) d.maxOverflowRetries = numToText(effective.maxOverflowRetries)
    }
  }

  protected sectionViews(section: string, context: {
    overridden: boolean
    cleared: boolean
    draft: Section | undefined
    effective: Section
  }): Record<string, FieldView> {
    const overridden = context.overridden
    const effective = context.effective
    if (context.cleared) {
      // Cleared sections render their documented defaults.
      if (section === 'trigger') return {
        'trigger.mode': fieldView('first', false, false),
        'trigger.ratio': fieldView('', false, false),
        'trigger.tokens': fieldView('', false, false),
      }
      if (section === 'retain') return {
        'retain.kind': fieldView('none', false, false),
        'retain.value': fieldView('', false, false),
      }
      if (section === 'archive') return {
        'archive.root': fieldView('', false, false),
        'archive.gitExclude': fieldView('true', false, false),
        'archive.onFailure': fieldView('block', false, false),
      }
      if (section === 'summarization') return {
        'summarization.provider': fieldView('', false, false),
        'summarization.model': fieldView('', false, false),
        'summarization.maxTokens': fieldView('', false, false),
      }
      return {
        'retries.compactionRetries': fieldView('', false, false),
        'retries.maxOverflowRetries': fieldView('', false, false),
      }
    }
    if (context.draft === undefined) {
      if (section === 'trigger') return {
        'trigger.mode': fieldView(strToText(effective.mode) === 'tokens' ? 'tokens' : 'first', overridden, false),
        'trigger.ratio': fieldView(numToText(effective.ratio), overridden, false),
        'trigger.tokens': fieldView(numToText(effective.tokens), overridden, false),
      }
      if (section === 'retain') {
        const kind = effective.ratio !== undefined ? 'ratio' : effective.tokens !== undefined ? 'tokens' : 'none'
        return {
          'retain.kind': fieldView(kind, overridden, false),
          'retain.value': fieldView(kind === 'none' ? '' : numToText(kind === 'ratio' ? effective.ratio : effective.tokens), overridden, false),
        }
      }
      if (section === 'archive') return {
        'archive.root': fieldView(strToText(effective.root), overridden, false),
        'archive.gitExclude': fieldView(boolValue(effective.gitExclude, true) ? 'true' : 'false', overridden, false),
        'archive.onFailure': fieldView(strToText(effective.onFailure) === 'proceed' ? 'proceed' : 'block', overridden, false),
      }
      if (section === 'summarization') return {
        'summarization.provider': fieldView(strToText(effective.provider), overridden, false),
        'summarization.model': fieldView(strToText(effective.model), overridden, false),
        'summarization.maxTokens': fieldView(numToText(effective.maxTokens), overridden, false),
      }
      return {
        'retries.compactionRetries': fieldView(numToText(effective.compactionRetries), overridden, false),
        'retries.maxOverflowRetries': fieldView(numToText(effective.maxOverflowRetries), overridden, false),
      }
    }
    // Staged: render the draft, marking invalid parses.
    const draft = context.draft
    if (section === 'trigger') {
      const d = draft as unknown as { mode: string; ratio: string; tokens: string }
      const ratio = parseRatioText(d.ratio)
      const tokens = parsePositiveIntText(d.tokens)
      return {
        'trigger.mode': fieldView(d.mode, overridden, false),
        'trigger.ratio': fieldView(d.ratio, overridden, isInvalid(ratio)),
        'trigger.tokens': fieldView(d.tokens, overridden, isInvalid(tokens)),
      }
    }
    if (section === 'retain') {
      const d = draft as unknown as { kind: string; value: string }
      const parsed = d.kind === 'none' ? ({ kind: 'omit' } as ParsedNumber)
        : (d.kind === 'ratio' ? parseRatioText(d.value) : parsePositiveIntText(d.value))
      return {
        'retain.kind': fieldView(d.kind, overridden, false),
        'retain.value': fieldView(d.value, overridden, d.kind !== 'none' && parsed.kind !== 'value'),
      }
    }
    if (section === 'archive') {
      const d = draft as unknown as { root: string; gitExclude: boolean; onFailure: string }
      return {
        'archive.root': fieldView(d.root, overridden, false),
        'archive.gitExclude': fieldView(d.gitExclude ? 'true' : 'false', overridden, false),
        'archive.onFailure': fieldView(d.onFailure === 'proceed' ? 'proceed' : 'block', overridden, false),
      }
    }
    if (section === 'summarization') {
      const d = draft as unknown as { provider: string; model: string; maxTokens: string }
      const provider = d.provider.trim()
      const model = d.model.trim()
      const maxTokens = parsePositiveIntText(d.maxTokens)
      return {
        'summarization.provider': fieldView(d.provider, overridden, (provider === '') !== (model === '')),
        'summarization.model': fieldView(d.model, overridden, (provider === '') !== (model === '')),
        'summarization.maxTokens': fieldView(d.maxTokens, overridden, isInvalid(maxTokens)),
      }
    }
    const d = draft as unknown as { compactionRetries: string; maxOverflowRetries: string }
    const compactionRetries = parseNonNegativeIntText(d.compactionRetries)
    const maxOverflowRetries = parseNonNegativeIntText(d.maxOverflowRetries)
    return {
      'retries.compactionRetries': fieldView(d.compactionRetries, overridden, isInvalid(compactionRetries)),
      'retries.maxOverflowRetries': fieldView(d.maxOverflowRetries, overridden, isInvalid(maxOverflowRetries)),
    }
  }

  protected rowViews(): { rows: ModelRowView[]; invalid: boolean } {
    let invalid = false
    const rows = this.rowsDrafts().map((row) => {
      const r = row as unknown as TypedRowDraft
      const provider = r.provider.trim()
      const model = r.model.trim()
      const ratio = parseRatioText(r.ratio)
      const tokens = parsePositiveIntText(r.tokens)
      const retainValue = r.retainKind === 'none'
        ? ({ kind: 'omit' } as ParsedNumber)
        : (r.retainKind === 'ratio' ? parseRatioText(r.retainValue) : parsePositiveIntText(r.retainValue))
      const rowInvalid = (provider === '') !== (model === '')
        || isInvalid(ratio) || isInvalid(tokens)
        || (r.retainKind !== 'none' && retainValue.kind !== 'value')
      if (rowInvalid) invalid = true
      return {
        provider: fieldView(r.provider, false, provider === '' && model !== ''),
        model: fieldView(r.model, false, model === '' && provider !== ''),
        mode: r.mode,
        ratio: fieldView(r.ratio, false, isInvalid(ratio)),
        tokens: fieldView(r.tokens, false, isInvalid(tokens)),
        retainKind: r.retainKind,
        retainValue: fieldView(r.retainValue, false, r.retainKind !== 'none' && retainValue.kind !== 'value'),
        disabled: r.disabled,
        invalid: rowInvalid,
      }
    })
    return { rows, invalid }
  }

  protected reshowRows(): void {
    const value = this.snapshot().value ?? {}
    const presets = (value.models ?? []) as Array<{
      provider?: unknown
      model?: unknown
      trigger?: { mode?: unknown; ratio?: unknown; tokens?: unknown }
      retain?: { ratio?: unknown; tokens?: unknown }
      disabled?: unknown
    }>
    const rows: RowDraft[] = presets.map((preset): RowDraft => ({
      provider: strToText(preset.provider),
      model: strToText(preset.model),
      mode: strToText(preset.trigger?.mode) === 'tokens' ? 'tokens' : 'first',
      ratio: numToText(preset.trigger?.ratio),
      tokens: numToText(preset.trigger?.tokens),
      retainKind: preset.retain?.ratio !== undefined ? 'ratio'
        : preset.retain?.tokens !== undefined ? 'tokens' : 'none',
      retainValue: preset.retain?.ratio !== undefined
        ? numToText(preset.retain?.ratio)
        : numToText(preset.retain?.tokens),
      disabled: preset.disabled === true,
    }))
    this.replaceRows(rows)
  }

  protected emptyRow(): RowDraft {
    return {
      provider: '', model: '', mode: 'first', ratio: '', tokens: '',
      retainKind: 'none', retainValue: '', disabled: false,
    }
  }

  // ---- projection (the vocabulary shape over the machinery's reads) ----

  protected project(): CompactConfigCardState {
    const snapshot = this.snapshot()
    const fields: Record<string, FieldView> = {}
    let invalid = false
    for (const section of this.specSections()) {
      const views = this.sectionViews(section, {
        overridden: this.sectionPendingClear(section) ? false : (this.sectionStaged(section) !== undefined || this.userHas(section)),
        cleared: this.sectionPendingClear(section),
        draft: this.sectionStaged(section),
        effective: this.effectiveSection(section),
      })
      Object.assign(fields, views)
      if (Object.values(views).some(view => view.invalid)) invalid = true
    }
    const builtRows = this.rowViews()
    if (builtRows.invalid) invalid = true
    const effectiveAuto = boolValue(snapshot.value?.auto, true)
    const effectiveEnabled = boolValue(snapshot.value?.enabled, true)
    const autoOverridden = this.booleanClearPending('auto') ? false
      : (this.booleanStagedValue('auto') !== undefined || this.userHas('auto'))
    const enabledOverridden = this.booleanClearPending('enabled') ? false
      : (this.booleanStagedValue('enabled') !== undefined || this.userHas('enabled'))
    const triggerDraft = this.sectionStaged('trigger') as { mode: string; tokens: string } | undefined
    let thresholdTokens: number | undefined
    if (this.sectionPendingClear('trigger')) thresholdTokens = undefined
    else {
      const mode = triggerDraft !== undefined ? triggerDraft.mode
        : (strToText(this.effectiveSection('trigger').mode) === 'tokens' ? 'tokens' : 'first')
      const tokensText = triggerDraft !== undefined ? triggerDraft.tokens
        : numToText(this.effectiveSection('trigger').tokens)
      const tokens = parsePositiveIntText(tokensText)
      if (mode === 'tokens' && tokens.kind === 'value') thresholdTokens = tokens.value
    }
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty: this.isDirty,
      invalid,
      saving: this.isSaving(),
      failed: this.isFailed(),
      fields,
      enabled: {
        value: this.booleanClearPending('enabled') ? true
          : boolValue(this.booleanStagedValue('enabled'), effectiveEnabled),
        overridden: enabledOverridden,
      },
      auto: {
        value: this.booleanClearPending('auto') ? true
          : boolValue(this.booleanStagedValue('auto'), effectiveAuto),
        overridden: autoOverridden,
      },
      models: {
        rows: builtRows.rows,
        overridden: this.rowsClearPending() ? false : (this.rowsStagedFlag() || this.userHas('models')),
      },
      preview: { thresholdTokens },
    }
  }
}
