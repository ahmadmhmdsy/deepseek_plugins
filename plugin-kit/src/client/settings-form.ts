/**
 * The generic staged-form machinery behind a settings card. Extracted from
 * web-compact-config/src/client/controller.ts (behavior-unchanged, plugin-kit
 * plan K3-2): drafts live locally; a save writes whole user-layer sections;
 * the Host is the only authority on whether a write landed — every write is
 * read back from the snapshot's user layer, and a save that did not land
 * keeps its drafts (card-form semantics).
 *
 * A concrete controller declares its vocabulary through FormSpec (section
 * names, boolean controls, the table rows key) and by overriding the small
 * vocabulary hooks; staging, clears, discard, the save plan and the
 * write/verify loop stay here.
 *
 * @module plugin-kit/client/settings-form
 */
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStoreLike, type SnapshotStoreLike } from './store.ts'

/** Numeric draft text: empty omits the field, a bad value blocks the save. */
export type ParsedNumber = { kind: 'omit' } | { kind: 'value'; value: number } | { kind: 'invalid' }

/** One control's rendered state. */
export interface FieldView {
  /** Draft text the control renders. */
  text: string
  /** Whether a save would leave a user-layer entry for its section. */
  overridden: boolean
  /** Whether the draft is not a value the field accepts, which blocks saving. */
  invalid: boolean
}

export function parseRatioText(text: string): ParsedNumber {
  const trimmed = text.trim()
  if (trimmed === '') return { kind: 'omit' }
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value <= 0 || value > 1) return { kind: 'invalid' }
  return { kind: 'value', value }
}

export function parsePositiveIntText(text: string): ParsedNumber {
  const trimmed = text.trim()
  if (trimmed === '') return { kind: 'omit' }
  if (!/^\d+$/.test(trimmed) || Number(trimmed) < 1) return { kind: 'invalid' }
  return { kind: 'value', value: Number(trimmed) }
}

export function parseNonNegativeIntText(text: string): ParsedNumber {
  const trimmed = text.trim()
  if (trimmed === '') return { kind: 'omit' }
  if (!/^\d+$/.test(trimmed)) return { kind: 'invalid' }
  return { kind: 'value', value: Number(trimmed) }
}

export function isInvalid(parsed: ParsedNumber): boolean {
  return parsed.kind === 'invalid'
}

export function numToText(value: unknown): string {
  return typeof value === 'number' ? String(value) : ''
}

export function strToText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function boolValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** Structural equality over JSON-shaped data (key order-insensitive). */
export function deepEqual(a: unknown, b: unknown): boolean {
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

export function fieldView(text: string, overridden: boolean, invalid: boolean): FieldView {
  return { text, overridden, invalid }
}

/** A boolean control of the form (a checkbox / master switch pair). */
export interface BooleanControlSpec {
  /** The user-layer key ('auto', 'enabled', ...). */
  key: string
  /** The documented default when the user layer does not carry the key. */
  defaultValue: boolean
}

/** Declarative description of one settings form. */
export interface FormSpec {
  /** Object-valued user-layer members staged as field drafts. */
  sections: readonly string[]
  /** Boolean controls (whole user-layer keys, not draft text). */
  booleans: readonly BooleanControlSpec[]
  /** The user-layer key holding the form's table rows; omitted = no table. */
  rowsKey?: string
}

/** Draft of one object-valued section — string|boolean cells the spec writes. */
export type SectionDraft = Record<string, unknown>

/** One editable table-row draft. */
export type RowDraft = Record<string, unknown>

/** How a parsed section lands in the save plan. */
export type SectionPlan = { key: string; op: 'write' | 'clear'; value: unknown }

/**
 * The staged form. Vocabulary-declarative: the subclass supplies parse /
 * view / seed hooks; the staging state machine (staged + pendingClear per
 * section, boolean controls, table rows), the dirty definition, the save plan
 * (skip no-op writes, verify every write through the user layer readback) and
 * the publish/bind lifecycle live here.
 */
export abstract class StagedSettingsForm<Settings, State> {
  private readonly listeners = new Set<() => void>()
  private readonly stagedSections = new Map<string, SectionDraft>()
  private readonly pendingClear = new Set<string>()
  private readonly booleanStaged = new Map<string, boolean>()
  private readonly booleanPendingClear = new Set<string>()
  protected rows: RowDraft[] = []
  private rowsStaged = false
  private rowsPendingClear = false
  private saving = false
  private failed = false
  protected readonly spec: FormSpec
  protected readonly scope: SettingsScope<Settings>
  /** The initial projection store: available to concrete inject() faces. */
  public readonly store: SnapshotStoreLike<State>

  /** @param spec - the form's declarative vocabulary (sections/booleans/rows key). */
  protected constructor(
    spec: FormSpec,
    scope: SettingsScope<Settings>,
  ) {
    this.spec = spec
    this.scope = scope
    scope.subscribe(() => { this.publish() })
    this.reshow()
    this.store = createSnapshotStoreLike(this.project())
    this.listeners.add(() => { this.store.set(this.project()) })
  }

  /**
   * Publish a projection of this form, rebuilt on every project() change.
   * @returns the store the card's component reads through its bound selector.
   */
  public bind<P>(project: () => P): SnapshotStoreLike<P> {
    const store = createSnapshotStoreLike(project())
    this.listeners.add(() => { store.set(project()) })
    return store
  }

  /**
   * The projection factory the constructor bound. Subclasses implement it as
   * their vocabulary projection.
   */
  protected abstract project(): State

  // ---- staging ----

  /** Stage draft text for one control ('true'/'false' for boolean controls). */
  public edit(control: string, text: string): void {
    if (this.editBoolean(control, text)) { this.publish(); return }
    const dot = control.indexOf('.')
    const section = dot === -1 ? control : control.slice(0, dot)
    const key = dot === -1 ? '' : control.slice(dot + 1)
    if (!(this.spec.sections as readonly string[]).includes(section) || key === '') return
    const name = section
    this.pendingClear.delete(name)
    const draft = this.sectionDraft(name)
    this.seedMissingKeys(name, draft, this.effectiveSection(name))
    this.failed = false
    this.acceptSectionEdit(name, key, text, draft, this.effectiveSection(name))
    this.publish()
  }

  /** Stage an edit inside one table-row draft. */
  public editRow(index: number, field: string, text: string): void {
    const row = this.rows[index]
    if (row === undefined) return
    this.failed = false
    this.rowsStaged = true
    this.acceptRowEdit(row, index, field, text)
    this.publish()
  }

  /** Append an empty row. */
  public addRow(): void {
    this.rows.push(this.emptyRow())
    this.rowsStaged = true
    this.failed = false
    this.publish()
  }

  /** Remove one row. */
  public removeRow(index: number): void {
    if (this.rows[index] === undefined) return
    this.rows.splice(index, 1)
    this.rowsStaged = true
    this.failed = false
    this.publish()
  }

  /** Stage a section (or boolean/rows) clear, so saving lets it re-inherit. */
  public resetField(target: string): void {
    this.failed = false
    if ((this.spec.sections as readonly string[]).includes(target)) {
      this.stagedSections.delete(target)
      this.pendingClear.add(target)
    } else if (this.spec.booleans.some(control => control.key === target)) {
      this.booleanStaged.delete(target)
      this.booleanPendingClear.add(target)
    } else if (this.spec.rowsKey === target) {
      this.rowsStaged = false
      this.rowsPendingClear = true
    }
    this.publish()
  }

  /** Drop every staged edit. */
  public discard(): void {
    const stagedEmpty = this.stagedSections.size === 0
      && this.booleanStaged.size === 0
      && !this.rowsStaged
    if (stagedEmpty
      && this.pendingClear.size === 0
      && this.booleanPendingClear.size === 0
      && !this.rowsPendingClear
      && !this.failed) return
    this.clearStaged()
    this.publish()
  }

  private clearStaged(): void {
    this.stagedSections.clear()
    this.pendingClear.clear()
    this.booleanStaged.clear()
    this.booleanPendingClear.clear()
    this.rowsStaged = false
    this.rowsPendingClear = false
    this.failed = false
    this.reshow()
  }

  // ---- save ----

  /** Whether any staged edit or pending clear exists. */
  protected get isDirty(): boolean {
    return this.stagedSections.size > 0
      || this.pendingClear.size > 0
      || this.booleanStaged.size > 0
      || this.booleanPendingClear.size > 0
      || this.rowsStaged
      || this.rowsPendingClear
  }

  public async save(): Promise<void> {
    const plan = this.buildPlan()
    if (plan.invalid || this.saving) return
    if (plan.writes.length === 0 && !this.isDirty) return
    this.saving = true
    this.failed = false
    this.publish()
    let landed = true
    for (const write of plan.writes) {
      landed = await write() && landed
    }
    if (landed) this.clearStaged()
    this.saving = false
    this.failed = !landed
    this.publish()
  }

  /** Stage a boolean control; true when the key is one of the spec's booleans. */
  private editBoolean(control: string, text: string): boolean {
    if (!this.spec.booleans.some(entry => entry.key === control)) return false
    this.booleanPendingClear.delete(control)
    this.booleanStaged.set(control, text === 'true')
    this.failed = false
    return true
  }

  private buildPlan(): { writes: Array<() => Promise<boolean>>; invalid: boolean } {
    const writes: Array<() => Promise<boolean>> = []
    let invalid = false
    for (const section of this.spec.sections) {
      if (this.pendingClear.has(section)) {
        if (this.userHas(section)) writes.push(() => this.clearKey(section))
        continue
      }
      const draft = this.stagedSections.get(section)
      if (draft === undefined) continue
      const parsed = this.parseSection(section, draft)
      if (parsed === undefined) {
        invalid = true
        continue
      }
      if (deepEqual(parsed, this.effectiveSection(section))) continue
      if (Object.keys(parsed).length === 0) {
        if (this.userHas(section)) writes.push(() => this.clearKey(section))
      } else {
        writes.push(() => this.writeKey(section, parsed))
      }
    }
    for (const control of this.spec.booleans) {
      const defaultValue = control.defaultValue
      const key = control.key
      if (this.booleanPendingClear.has(key)) {
        if (this.userHas(key)) writes.push(() => this.clearKey(key))
      } else {
        const stagedValue = this.booleanStaged.get(key)
        if (stagedValue !== undefined) {
          const effective = boolValue(this.snapshot().value?.[key as keyof Settings], defaultValue)
          if (stagedValue !== effective) writes.push(() => this.writeKey(key, stagedValue))
        }
      }
    }
    const rowsKey = this.spec.rowsKey
    if (rowsKey !== undefined) {
      const built = this.buildRows()
      if (built.invalid) invalid = true
      else {
        const effectiveRows = (this.snapshot().value?.[rowsKey as keyof Settings] as unknown[] | undefined) ?? []
        if (!deepEqual(built.value, effectiveRows)) {
          if (built.value.length === 0) {
            if (this.userHas(rowsKey)) writes.push(() => this.clearKey(rowsKey))
          } else {
            writes.push(() => this.writeKey(rowsKey, built.value))
          }
        }
      }
    }
    return { writes, invalid }
  }

  private async writeKey(key: string, value: unknown): Promise<boolean> {
    await this.scope.set(key as never, value as never)
    const user = this.userLayer()
    return user !== undefined && key in user && deepEqual(user[key], value)
  }

  private async clearKey(key: string): Promise<boolean> {
    await this.scope.unset(key as never)
    const user = this.userLayer()
    return user === undefined || !(key in user)
  }

  // ---- generic reads the vocabulary hooks may use ----

  protected snapshot(): SettingsScopeSnapshot<Settings> {
    return this.scope.getSnapshot()
  }

  protected userLayer(): Section | undefined {
    const user = this.snapshot().user
    return typeof user === 'object' && user !== null ? (user as unknown as Section) : undefined
  }

  protected userHas(key: string): boolean {
    const user = this.userLayer()
    return user !== undefined && key in user
  }

  protected hasSectionStage(section: string): boolean { return this.stagedSections.has(section) }

  protected sectionStaged(section: string): SectionDraft | undefined { return this.stagedSections.get(section) }

  protected sectionPendingClear(section: string): boolean { return this.pendingClear.has(section) }

  protected booleanStagedValue(key: string): boolean | undefined { return this.booleanStaged.get(key) }

  protected booleanClearPending(key: string): boolean { return this.booleanPendingClear.has(key) }

  protected rowsStagedFlag(): boolean { return this.rowsStaged }

  protected rowsClearPending(): boolean { return this.rowsPendingClear }

  protected rowsDrafts(): RowDraft[] { return this.rows }

  /** Replace the whole row-draft array (only the machinery should write it). */
  protected replaceRows(rows: RowDraft[]): void {
    this.rows = rows
  }

  /** The section names as declared by the FormSpec. */
  protected specSections(): readonly string[] {
    return this.spec.sections
  }

  protected isSaving(): boolean { return this.saving }

  protected isFailed(): boolean { return this.failed }

  /**
   * The effective section as the schema serves it (empty when it is not an object).
   */
  protected effectiveSection(key: string): Section {
    const value = this.snapshot().value?.[key as keyof Settings]
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Section) : {}
  }

  // ---- vocabulary hooks ----

  /** Merge the staged text into the section draft (vocabulary write rules). */
  protected abstract acceptSectionEdit(section: string, key: string, text: string, draft: SectionDraft, effective: Section): void

  /** Merge the staged text into one row draft (vocabulary write rules). */
  protected acceptRowEdit(row: RowDraft, index: number, field: string, text: string): void {
    row[field] = text
  }

  /** Parse a staged section draft into its user-layer value; undefined = invalid. */
  protected abstract parseSection(section: string, draft: SectionDraft): Section | undefined

  /** Parse the row drafts into the rows value; invalid = a save is blocked. */
  protected abstract buildRows(): { value: Section[]; invalid: boolean }

  /** Fill missing draft keys from the effective section (read contract). */
  protected abstract seedMissingKeys(section: string, draft: SectionDraft, effective: Section): void

  /** The per-control FieldViews of one section (vocabulary rendering). */
  protected abstract sectionViews(section: string, context: {
    overridden: boolean
    cleared: boolean
    draft: SectionDraft | undefined
    effective: Section
  }): Record<string, FieldView>

  /** The face views of the table-row drafts. */
  protected abstract rowViews(): { rows: unknown; invalid: boolean }

  /** Rebuild the row drafts from the snapshot's rows. */
  protected abstract reshowRows(): void

  /** An empty new table row. */
  protected abstract emptyRow(): RowDraft

  private sectionDraft(section: string): SectionDraft {
    let draft = this.stagedSections.get(section)
    if (draft === undefined) {
      draft = {}
      this.stagedSections.set(section, draft)
    }
    return draft
  }

  private reshow(): void { this.reshowRows() }

  private publish(): void {
    for (const listener of [...this.listeners]) listener()
  }
}

type Section = Record<string, unknown>