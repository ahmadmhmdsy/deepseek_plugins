/**
 * Staged form behind the compact-handoff settings card. Drafts live locally;
 * a save writes whole user-layer sections (the client scope exposes per-field
 * path ops only, so each handoff section is one field whose value is an
 * object). The Host is the only authority on whether a write landed — every
 * write is read back from the snapshot's user layer, and a save that did not
 * land keeps its drafts (card-form semantics).
 *
 * @module web-compact-config/client/controller
 */
import type { SettingsScope, SettingsScopeSnapshot, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStoreLike, type SnapshotStoreLike } from './store.ts'

/** The namespace this card edits — spelled here: a client package must not depend on a Host package. */
export const COMPACT_HANDOFF_NS = 'compact-handoff'

/** One object-valued member of the handoff config's user layer. */
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

/** Numeric draft text: empty omits the field, a bad value blocks the save. */
type ParsedNumber = { kind: 'omit' } | { kind: 'value'; value: number } | { kind: 'invalid' }

/** One control's rendered state. */
export interface FieldView {
  /** Draft text the control renders. */
  text: string
  /** Whether a save would leave a user-layer entry for its section. */
  overridden: boolean
  /** Whether the draft is not a value the field accepts, which blocks saving. */
  invalid: boolean
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

/** Draft of one object-valued section. */
interface SectionDraft {
  trigger?: { mode: string; ratio: string; tokens: string }
  retain?: { kind: string; value: string }
  archive?: { root: string; gitExclude: boolean; onFailure: string }
  summarization?: { provider: string; model: string; maxTokens: string }
  retries?: { compactionRetries: string; maxOverflowRetries: string }
}

interface RowDraft {
  provider: string
  model: string
  mode: string
  ratio: string
  tokens: string
  retainKind: string
  retainValue: string
  disabled: boolean
}

const SECTIONS = ['trigger', 'retain', 'archive', 'summarization', 'retries'] as const
type SectionName = (typeof SECTIONS)[number]

function parseRatioText(text: string): ParsedNumber {
  const trimmed = text.trim()
  if (trimmed === '') return { kind: 'omit' }
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value <= 0 || value > 1) return { kind: 'invalid' }
  return { kind: 'value', value }
}

function parsePositiveIntText(text: string): ParsedNumber {
  const trimmed = text.trim()
  if (trimmed === '') return { kind: 'omit' }
  if (!/^\d+$/.test(trimmed) || Number(trimmed) < 1) return { kind: 'invalid' }
  return { kind: 'value', value: Number(trimmed) }
}

function parseNonNegativeIntText(text: string): ParsedNumber {
  const trimmed = text.trim()
  if (trimmed === '') return { kind: 'omit' }
  if (!/^\d+$/.test(trimmed)) return { kind: 'invalid' }
  return { kind: 'value', value: Number(trimmed) }
}

function isInvalid(parsed: ParsedNumber): boolean {
  return parsed.kind === 'invalid'
}

function numToText(value: unknown): string {
  return typeof value === 'number' ? String(value) : ''
}

function strToText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** Structural equality over JSON-shaped data (key order-insensitive). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((entry, index) => deepEqual(entry, b[index]))
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every(key => key in right && deepEqual(left[key], right[key]))
}

function fieldView(text: string, overridden: boolean, invalid: boolean): FieldView {
  return { text, overridden, invalid }
}

/**
 * Bridges the compact-handoff scope onto the card's staged form.
 */
export class CompactConfigCardController {
  private readonly listeners = new Set<() => void>()
  private readonly staged = new Map<SectionName, SectionDraft>()
  private readonly pendingClear = new Set<SectionName>()
  private rows: RowDraft[] = []
  private modelsStaged = false
  private autoStaged: boolean | undefined
  private autoPendingClear = false
  private enabledStaged: boolean | undefined
  private enabledPendingClear = false
  private modelsPendingClear = false
  private saving = false
  private failed = false
  private readonly store: SnapshotStoreLike<CompactConfigCardState>

  /** @param scope - the bound settings scope for the compact-handoff namespace. */
  public constructor(private readonly scope: SettingsScope<HandoffSettings>) {
    this.scope.subscribe(() => { this.publish() })
    this.seedFromSnapshot()
    this.store = createSnapshotStoreLike(this.projection())
    this.listeners.add(() => { this.store.set(this.projection()) })
  }

  /**
   * Publish a projection of this form, rebuilt whenever the scope or a draft changes.
   * @param project - build the card's state from the form's current reads.
   * @returns the store the card's component reads through its bound selector.
   */
  public bind<S>(project: () => S): SnapshotStoreLike<S> {
    const store = createSnapshotStoreLike(project())
    this.listeners.add(() => { store.set(project()) })
    return store
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
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

  // ---- staging ----

  private edit(field: string, text: string): void {
    if (field === 'auto') {
      this.autoPendingClear = false
      this.autoStaged = text === 'true'
      this.failed = false
      this.publish()
      return
    }
    if (field === 'enabled') {
      this.enabledPendingClear = false
      this.enabledStaged = text === 'true'
      this.failed = false
      this.publish()
      return
    }
    const dot = field.indexOf('.')
    const section = dot === -1 ? field : field.slice(0, dot)
    const key = dot === -1 ? '' : field.slice(dot + 1)
    if (!(SECTIONS as readonly string[]).includes(section) || key === '') return
    this.pendingClear.delete(section as SectionName)
    const draft = this.sectionDraft(section as SectionName)
    this.seedMissingKeys(section as SectionName, draft)
    this.failed = false
    if (section === 'trigger') {
      const d = draft as { mode: string; ratio: string; tokens: string }
      if (key === 'mode') d.mode = text === 'tokens' ? 'tokens' : 'first'
      else if (key === 'ratio') d.ratio = text
      else if (key === 'tokens') d.tokens = text
    } else if (section === 'retain') {
      const d = draft as { kind: string; value: string }
      if (key === 'kind') d.kind = ['none', 'ratio', 'tokens'].includes(text) ? text : d.kind
      else if (key === 'value') d.value = text
    } else if (section === 'archive') {
      const d = draft as { root: string; gitExclude: boolean; onFailure: string }
      if (key === 'root') d.root = text
      else if (key === 'gitExclude') d.gitExclude = text === 'true'
      else if (key === 'onFailure') d.onFailure = text === 'proceed' ? 'proceed' : 'block'
    } else if (section === 'summarization') {
      const d = draft as { provider: string; model: string; maxTokens: string }
      if (key === 'provider') d.provider = text
      else if (key === 'model') d.model = text
      else if (key === 'maxTokens') d.maxTokens = text
    } else if (section === 'retries') {
      const d = draft as { compactionRetries: string; maxOverflowRetries: string }
      if (key === 'compactionRetries') d.compactionRetries = text
      else if (key === 'maxOverflowRetries') d.maxOverflowRetries = text
    }
    this.publish()
  }

  private editRow(index: number, field: string, text: string): void {
    const row = this.rows[index]
    if (row === undefined) return
    this.failed = false
    this.modelsStaged = true
    if (field === 'disabled') row.disabled = text === 'true'
    else if (field === 'mode') row.mode = text === 'tokens' ? 'tokens' : 'first'
    else if (field === 'retainKind') row.retainKind = ['none', 'ratio', 'tokens'].includes(text) ? text : row.retainKind
    else if (field === 'provider') row.provider = text
    else if (field === 'model') row.model = text
    else if (field === 'ratio') row.ratio = text
    else if (field === 'tokens') row.tokens = text
    else if (field === 'retainValue') row.retainValue = text
    this.publish()
  }

  private addRow(): void {
    this.rows.push({ provider: '', model: '', mode: 'first', ratio: '', tokens: '', retainKind: 'none', retainValue: '', disabled: false })
    this.modelsStaged = true
    this.failed = false
    this.publish()
  }

  private removeRow(index: number): void {
    if (this.rows[index] === undefined) return
    this.rows.splice(index, 1)
    this.modelsStaged = true
    this.failed = false
    this.publish()
  }

  private resetField(section: string): void {
    this.failed = false
    if (section === 'auto') {
      this.autoStaged = undefined
      this.autoPendingClear = true
    } else if (section === 'enabled') {
      this.enabledStaged = undefined
      this.enabledPendingClear = true
    } else if (section === 'models') {
      this.modelsStaged = false
      this.modelsPendingClear = true
    } else if ((SECTIONS as readonly string[]).includes(section)) {
      this.staged.delete(section as SectionName)
      this.pendingClear.add(section as SectionName)
    }
    this.publish()
  }

  private discard(): void {
    const stagedEmpty = this.staged.size === 0 && this.autoStaged === undefined && this.enabledStaged === undefined && !this.modelsStaged
    if (stagedEmpty && this.pendingClear.size === 0 && !this.autoPendingClear && !this.enabledPendingClear && !this.modelsPendingClear && !this.failed) return
    this.staged.clear()
    this.pendingClear.clear()
    this.autoStaged = undefined
    this.autoPendingClear = false
    this.enabledStaged = undefined
    this.enabledPendingClear = false
    this.modelsStaged = false
    this.modelsPendingClear = false
    this.failed = false
    this.seedFromSnapshot()
    this.publish()
  }

  // ---- save ----

  /** Whether any staged edit or pending clear exists — one definition shared by save() and the projection. */
  private get isDirty(): boolean {
    return this.staged.size > 0
      || this.pendingClear.size > 0
      || this.autoStaged !== undefined
      || this.autoPendingClear
      || this.enabledStaged !== undefined
      || this.enabledPendingClear
      || this.modelsStaged
      || this.modelsPendingClear
  }

  private async save(): Promise<void> {
    const plan = this.plan()
    if (plan.invalid || this.saving) return
    if (plan.writes.length === 0 && !this.isDirty) return
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    for (const write of plan.writes) {
      landed = await write() && landed
    }
    if (landed) {
      this.staged.clear()
      this.pendingClear.clear()
      this.autoStaged = undefined
      this.autoPendingClear = false
      this.enabledStaged = undefined
      this.enabledPendingClear = false
      this.modelsStaged = false
      this.modelsPendingClear = false
      this.seedFromSnapshot()
    }
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  private plan(): { writes: Array<() => Promise<boolean>>; invalid: boolean } {
    const writes: Array<() => Promise<boolean>> = []
    let invalid = false
    for (const section of SECTIONS) {
      if (this.pendingClear.has(section)) {
        if (this.userHas(section)) writes.push(() => this.clearSection(section))
        continue
      }
      const draft = this.staged.get(section)
      if (draft === undefined) continue
      const parsed = this.parseSection(section, draft)
      if (parsed === undefined) {
        invalid = true
        continue
      }
      if (deepEqual(parsed, this.effectiveSection(section))) continue
      if (Object.keys(parsed).length === 0) {
        if (this.userHas(section)) writes.push(() => this.clearSection(section))
      } else {
        writes.push(() => this.writeSection(section, parsed))
      }
    }
    if (this.autoPendingClear) {
      if (this.userHas('auto')) writes.push(() => this.clearSection('auto'))
    } else if (this.autoStaged !== undefined) {
      const effectiveAuto = boolValue(this.snapshot().value?.auto, true)
      if (this.autoStaged !== effectiveAuto) writes.push(() => this.writeSection('auto', this.autoStaged))
    }
    if (this.enabledPendingClear) {
      if (this.userHas('enabled')) writes.push(() => this.clearSection('enabled'))
    } else if (this.enabledStaged !== undefined) {
      const effectiveEnabled = boolValue(this.snapshot().value?.enabled, true)
      if (this.enabledStaged !== effectiveEnabled) writes.push(() => this.writeSection('enabled', this.enabledStaged))
    }
    const models = this.buildModels()
    if (models.invalid) invalid = true
    else {
      const effectiveModels = this.snapshot().value?.models ?? []
      if (!deepEqual(models.presets, effectiveModels)) {
        if (models.presets.length === 0) {
          if (this.userHas('models')) writes.push(() => this.clearSection('models'))
        } else {
          writes.push(() => this.writeSection('models', models.presets))
        }
      }
    }
    return { writes, invalid }
  }

  private async writeSection(section: string, value: unknown): Promise<boolean> {
    await this.scope.set(section, value)
    const user = this.userLayer()
    return user !== undefined && section in user && deepEqual((user as Section)[section], value)
  }

  private async clearSection(section: string): Promise<boolean> {
    await this.scope.unset(section)
    const user = this.userLayer()
    return user === undefined || !(section in user)
  }

  // ---- parsing drafts into section objects ----

  private parseSection(section: SectionName, draft: SectionDraft): Section | undefined {
    if (section === 'trigger') {
      const d = draft as { mode: string; ratio: string; tokens: string }
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
      const d = draft as { kind: string; value: string }
      if (d.kind === 'none') return {}
      const parsedNumber = d.kind === 'ratio' ? parseRatioText(d.value) : parsePositiveIntText(d.value)
      if (parsedNumber.kind !== 'value') return undefined
      return d.kind === 'ratio' ? { ratio: parsedNumber.value } : { tokens: parsedNumber.value }
    }
    if (section === 'archive') {
      const d = draft as { root: string; gitExclude: boolean; onFailure: string }
      const root = d.root.trim()
      const onFailure = d.onFailure === 'proceed' ? 'proceed' : 'block'
      if (root === '' && d.gitExclude === true && onFailure === 'block') return {}
      const parsed: Section = { gitExclude: d.gitExclude, onFailure }
      if (root !== '') parsed.root = root
      return parsed
    }
    if (section === 'summarization') {
      const d = draft as { provider: string; model: string; maxTokens: string }
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
    const d = draft as { compactionRetries: string; maxOverflowRetries: string }
    const compactionRetries = parseNonNegativeIntText(d.compactionRetries)
    const maxOverflowRetries = parseNonNegativeIntText(d.maxOverflowRetries)
    if (isInvalid(compactionRetries) || isInvalid(maxOverflowRetries)) return undefined
    const parsed: Section = {}
    if (compactionRetries.kind === 'value') parsed.compactionRetries = compactionRetries.value
    if (maxOverflowRetries.kind === 'value') parsed.maxOverflowRetries = maxOverflowRetries.value
    return parsed
  }

  private buildModels(): { presets: Section[]; invalid: boolean } {
    const presets: Section[] = []
    let invalid = false
    for (const row of this.rows) {
      const provider = row.provider.trim()
      const model = row.model.trim()
      const ratio = parseRatioText(row.ratio)
      const tokens = parsePositiveIntText(row.tokens)
      const retainParsed = row.retainKind === 'none'
        ? ({ kind: 'omit' } as const)
        : (row.retainKind === 'ratio' ? parseRatioText(row.retainValue) : parsePositiveIntText(row.retainValue))
      const isEmpty = provider === '' && model === '' && ratio.kind === 'omit' && tokens.kind === 'omit'
        && row.retainKind === 'none' && !row.disabled && row.mode === 'first'
      if (isEmpty) continue
      const rowInvalid = (provider === '') !== (model === '')
        || isInvalid(ratio) || isInvalid(tokens)
        || (row.retainKind !== 'none' && retainParsed.kind !== 'value')
      if (rowInvalid) {
        invalid = true
        continue
      }
      const preset: Section = { provider, model }
      if (row.mode === 'tokens' || ratio.kind === 'value' || tokens.kind === 'value') {
        const trigger: Section = {}
        if (row.mode === 'tokens') trigger.mode = 'tokens'
        if (ratio.kind === 'value') trigger.ratio = ratio.value
        if (tokens.kind === 'value') trigger.tokens = tokens.value
        preset.trigger = trigger
      }
      if (row.retainKind !== 'none' && retainParsed.kind === 'value') {
        preset.retain = row.retainKind === 'ratio' ? { ratio: retainParsed.value } : { tokens: retainParsed.value }
      }
      if (row.disabled) preset.disabled = true
      const carried = (this.snapshot().value?.models ?? []).find(candidate =>
        candidate.provider === provider && candidate.model === model)
      if (carried?.summarization !== undefined) preset.summarization = carried.summarization
      if (carried?.retries !== undefined) preset.retries = carried.retries
      presets.push(preset)
    }
    return { presets, invalid }
  }

  // ---- projection ----

  private seedMissingKeys(section: SectionName, draft: SectionDraft): void {
    const effective = this.effectiveSection(section)
    if (section === 'trigger') {
      const d = draft as { mode: string; ratio: string; tokens: string }
      if (d.mode === undefined) d.mode = strToText(effective.mode) === 'tokens' ? 'tokens' : 'first'
      if (d.ratio === undefined) d.ratio = numToText(effective.ratio)
      if (d.tokens === undefined) d.tokens = numToText(effective.tokens)
    } else if (section === 'retain') {
      const d = draft as { kind: string; value: string }
      if (d.kind === undefined) d.kind = effective.ratio !== undefined ? 'ratio' : effective.tokens !== undefined ? 'tokens' : 'none'
      if (d.value === undefined) d.value = d.kind === 'none' ? '' : numToText(d.kind === 'ratio' ? effective.ratio : effective.tokens)
    } else if (section === 'archive') {
      const d = draft as { root: string; gitExclude: boolean; onFailure: string }
      if (d.root === undefined) d.root = strToText(effective.root)
      if (d.gitExclude === undefined) d.gitExclude = boolValue(effective.gitExclude, true)
      if (d.onFailure === undefined) d.onFailure = strToText(effective.onFailure) === 'proceed' ? 'proceed' : 'block'
    } else if (section === 'summarization') {
      const d = draft as { provider: string; model: string; maxTokens: string }
      if (d.provider === undefined) d.provider = strToText(effective.provider)
      if (d.model === undefined) d.model = strToText(effective.model)
      if (d.maxTokens === undefined) d.maxTokens = numToText(effective.maxTokens)
    } else if (section === 'retries') {
      const d = draft as { compactionRetries: string; maxOverflowRetries: string }
      if (d.compactionRetries === undefined) d.compactionRetries = numToText(effective.compactionRetries)
      if (d.maxOverflowRetries === undefined) d.maxOverflowRetries = numToText(effective.maxOverflowRetries)
    }
  }

  private sectionDraft(section: SectionName): SectionDraft {
    let draft = this.staged.get(section)
    if (draft === undefined) {
      draft = {}
      this.staged.set(section, draft)
    }
    return draft
  }

  private snapshot(): SettingsScopeSnapshot<HandoffSettings> {
    return this.scope.getSnapshot()
  }

  private userLayer(): Section | undefined {
    const user = this.snapshot().user
    return typeof user === 'object' && user !== null ? user as Section : undefined
  }

  private userHas(section: string): boolean {
    const user = this.userLayer()
    return user !== undefined && section in user
  }

  private effectiveSection(section: string): Section {
    const value = this.snapshot().value?.[section as keyof HandoffSettings]
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Section : {}
  }

  private seedFromSnapshot(): void {
    const value = this.snapshot().value ?? {}
    this.rows = (value.models ?? []).map(preset => ({
      provider: strToText(preset.provider),
      model: strToText(preset.model),
      mode: strToText((preset.trigger as Section | undefined)?.mode) === 'tokens' ? 'tokens' : 'first',
      ratio: numToText((preset.trigger as Section | undefined)?.ratio),
      tokens: numToText((preset.trigger as Section | undefined)?.tokens),
      retainKind: (preset.retain as Section | undefined)?.ratio !== undefined ? 'ratio'
        : (preset.retain as Section | undefined)?.tokens !== undefined ? 'tokens' : 'none',
      retainValue: (preset.retain as Section | undefined)?.ratio !== undefined
        ? numToText((preset.retain as Section | undefined)?.ratio)
        : numToText((preset.retain as Section | undefined)?.tokens),
      disabled: preset.disabled === true,
    }))
  }

  private publish(): void {
    for (const listener of [...this.listeners]) listener()
  }

  private sectionFieldViews(section: SectionName): Record<string, FieldView> {
    const overridden = this.pendingClear.has(section) ? false : (this.staged.has(section) || this.userHas(section))
    if (this.pendingClear.has(section)) {
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
    const draft = this.staged.get(section)
    if (draft === undefined) {
      const effective = this.effectiveSection(section)
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
    if (section === 'trigger') {
      const d = draft as { mode: string; ratio: string; tokens: string }
      const ratio = parseRatioText(d.ratio)
      const tokens = parsePositiveIntText(d.tokens)
      return {
        'trigger.mode': fieldView(d.mode, overridden, false),
        'trigger.ratio': fieldView(d.ratio, overridden, isInvalid(ratio)),
        'trigger.tokens': fieldView(d.tokens, overridden, isInvalid(tokens)),
      }
    }
    if (section === 'retain') {
      const d = draft as { kind: string; value: string }
      const parsed = d.kind === 'none' ? ({ kind: 'omit' } as ParsedNumber)
        : (d.kind === 'ratio' ? parseRatioText(d.value) : parsePositiveIntText(d.value))
      return {
        'retain.kind': fieldView(d.kind, overridden, false),
        'retain.value': fieldView(d.value, overridden, d.kind !== 'none' && parsed.kind !== 'value'),
      }
    }
    if (section === 'archive') {
      const d = draft as { root: string; gitExclude: boolean; onFailure: string }
      return {
        'archive.root': fieldView(d.root, overridden, false),
        'archive.gitExclude': fieldView(d.gitExclude ? 'true' : 'false', overridden, false),
        'archive.onFailure': fieldView(d.onFailure === 'proceed' ? 'proceed' : 'block', overridden, false),
      }
    }
    if (section === 'summarization') {
      const d = draft as { provider: string; model: string; maxTokens: string }
      const provider = d.provider.trim()
      const model = d.model.trim()
      const maxTokens = parsePositiveIntText(d.maxTokens)
      return {
        'summarization.provider': fieldView(d.provider, overridden, (provider === '') !== (model === '')),
        'summarization.model': fieldView(d.model, overridden, (provider === '') !== (model === '')),
        'summarization.maxTokens': fieldView(d.maxTokens, overridden, isInvalid(maxTokens)),
      }
    }
    const d = draft as { compactionRetries: string; maxOverflowRetries: string }
    const compactionRetries = parseNonNegativeIntText(d.compactionRetries)
    const maxOverflowRetries = parseNonNegativeIntText(d.maxOverflowRetries)
    return {
      'retries.compactionRetries': fieldView(d.compactionRetries, overridden, isInvalid(compactionRetries)),
      'retries.maxOverflowRetries': fieldView(d.maxOverflowRetries, overridden, isInvalid(maxOverflowRetries)),
    }
  }

  private projection(): CompactConfigCardState {
    const snapshot = this.snapshot()
    const fields: Record<string, FieldView> = {}
    let invalid = false
    for (const section of SECTIONS) {
      const views = this.sectionFieldViews(section)
      Object.assign(fields, views)
      if (Object.values(views).some(view => view.invalid)) invalid = true
    }
    const rows = this.rows.map((row) => {
      const provider = row.provider.trim()
      const model = row.model.trim()
      const ratio = parseRatioText(row.ratio)
      const tokens = parsePositiveIntText(row.tokens)
      const retainValue = row.retainKind === 'none'
        ? ({ kind: 'omit' } as ParsedNumber)
        : (row.retainKind === 'ratio' ? parseRatioText(row.retainValue) : parsePositiveIntText(row.retainValue))
      const rowInvalid = (provider === '') !== (model === '')
        || isInvalid(ratio) || isInvalid(tokens)
        || (row.retainKind !== 'none' && retainValue.kind !== 'value')
      if (rowInvalid) invalid = true
      return {
        provider: fieldView(row.provider, false, provider === '' && model !== ''),
        model: fieldView(row.model, false, model === '' && provider !== ''),
        mode: row.mode,
        ratio: fieldView(row.ratio, false, isInvalid(ratio)),
        tokens: fieldView(row.tokens, false, isInvalid(tokens)),
        retainKind: row.retainKind,
        retainValue: fieldView(row.retainValue, false, row.retainKind !== 'none' && retainValue.kind !== 'value'),
        disabled: row.disabled,
        invalid: rowInvalid,
      }
    })
    const models = this.buildModels()
    const dirty = this.isDirty
    const effectiveAuto = boolValue(snapshot.value?.auto, true)
    const autoOverridden = this.autoPendingClear ? false : (this.autoStaged !== undefined || this.userHas('auto'))
    const effectiveEnabled = boolValue(snapshot.value?.enabled, true)
    const enabledOverridden = this.enabledPendingClear ? false : (this.enabledStaged !== undefined || this.userHas('enabled'))
    const triggerDraft = this.staged.get('trigger')
    let thresholdTokens: number | undefined
    if (this.pendingClear.has('trigger')) thresholdTokens = undefined
    else {
      const mode = triggerDraft !== undefined ? (triggerDraft as { mode: string }).mode
        : (strToText(this.effectiveSection('trigger').mode) === 'tokens' ? 'tokens' : 'first')
      const tokensText = triggerDraft !== undefined ? (triggerDraft as { tokens: string }).tokens
        : numToText(this.effectiveSection('trigger').tokens)
      const tokens = parsePositiveIntText(tokensText)
      if (mode === 'tokens' && tokens.kind === 'value') thresholdTokens = tokens.value
    }
    return {
      available: snapshot.status === 'ready',
      writable: snapshot.writable,
      dirty,
      invalid,
      saving: this.saving,
      failed: this.failed,
      fields,
      enabled: { value: this.enabledPendingClear ? true : boolValue(this.enabledStaged, effectiveEnabled), overridden: enabledOverridden },
      auto: { value: this.autoPendingClear ? true : boolValue(this.autoStaged, effectiveAuto), overridden: autoOverridden },
      models: {
        rows,
        overridden: this.modelsPendingClear ? false : (this.modelsStaged || this.userHas('models')),
      },
      preview: { thresholdTokens },
    }
  }
}
