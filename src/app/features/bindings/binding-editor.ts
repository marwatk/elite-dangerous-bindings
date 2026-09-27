import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSliderModule } from '@angular/material/slider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { conflictsFor } from '../../core/binds/analysis';
import { CONTEXT_LABELS, GameContext } from '../../core/binds/contexts';
import { ActionState, InputRef, SlotBinding, SlotName, isBound } from '../../core/binds/binds-document';
import { CatalogService } from '../../core/data/catalog.service';
import { InputService } from '../../core/input/input.service';
import { CaptureResult } from '../../core/input/input.types';
import { BindingsStore } from '../../core/state/bindings-store.service';
import { InputLabelPipe } from '../../shared/input-label.pipe';
import { BindingsView } from './bindings-view.service';
import { ControlPicker } from './control-picker';
import {
  ActionTraits,
  EditorDraft,
  PickTarget,
  acceptFor,
  actionsWithDraft,
  addModifier,
  applyDraft,
  captureToSlot,
  draftEdits,
  draftFrom,
  isCompatible,
  removeModifier,
  slotsEqual,
  withInput,
} from './editor-model';
import { applyLinks, linkKey, linkSections, linkWrites } from './link-model';
import { SlotView } from './slot-view';

export interface BindingEditorData {
  code: string;
  /** Slot to start on. */
  slot?: SlotName;
}

const SLOT_LABELS: Record<SlotName, string> = { Primary: 'Primary', Secondary: 'Secondary', Binding: 'Axis binding' };

/** Edit one command: slots, modifiers, flags. Apply writes everything as one undo step. */
@Component({
  selector: 'app-binding-editor',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    MatSliderModule,
    MatTooltipModule,
    InputLabelPipe,
    SlotView,
    ControlPicker,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './binding-editor.html',
  styleUrl: './binding-editor.scss',
})
export class BindingEditor implements OnDestroy {
  private readonly data = inject<BindingEditorData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<BindingEditor, boolean>>(MatDialogRef);
  private readonly store = inject(BindingsStore);
  private readonly catalog = inject(CatalogService);
  protected readonly liveInput = inject(InputService);
  private readonly view = inject(BindingsView);

  protected readonly SLOT_LABELS = SLOT_LABELS;
  protected readonly info = this.catalog.action(this.data.code);
  protected readonly orig: ActionState = this.store.actionMap().get(this.data.code) ?? {
    code: this.data.code,
    kind: this.info.type === 'analogue' ? 'axis' : 'button',
    slots: {},
    toggleOn: null,
    inverted: null,
    deadzone: null,
  };
  protected readonly traits: ActionTraits = { kind: this.orig.kind, hasAnalogue: this.info.hasAnalogue };
  protected readonly slotNames: SlotName[] = this.orig.kind === 'axis' ? ['Binding'] : ['Primary', 'Secondary'];

  protected readonly active = signal<SlotName>(
    this.data.slot && this.slotNames.includes(this.data.slot) ? this.data.slot : this.slotNames[0],
  );
  protected readonly draft = signal<EditorDraft>(draftFrom(this.orig));
  /** What a running capture is for. */
  protected readonly capturing = signal<PickTarget | null>(null);
  protected readonly picking = signal<PickTarget | null>(null);
  protected readonly captureError = signal<string | null>(null);
  protected readonly suggestInverted = signal(false);
  protected readonly fullAxis = signal<SlotBinding | null>(null);

  private abort: AbortController | null = null;
  private readonly waitPanel = viewChild<ElementRef<HTMLElement>>('waitPanel');
  private readonly bindButton = viewChild<ElementRef<HTMLElement>>('bindButton');

  protected readonly current = computed(() => this.draft().slots[this.active()] ?? null);
  protected readonly currentBound = computed(() => {
    const c = this.current();
    return c && isBound(c) ? c : null;
  });
  protected readonly original = computed(() => {
    const o = this.orig.slots[this.active()];
    return o && isBound(o) ? o : null;
  });
  protected readonly slotChanged = computed(() => !slotsEqual(this.original(), this.current()));
  protected readonly edits = computed(() => draftEdits(this.orig, this.draft()));
  protected readonly incompatible = computed(() => {
    const c = this.currentBound();
    return !!c && !isCompatible(c.key, this.traits);
  });

  /** Other commands in the same context already using the active slot's input + modifiers. */
  protected readonly conflicts = computed(() => {
    const cur = this.currentBound();
    if (!cur) return [];
    const actions = actionsWithDraft(this.store.actions(), this.orig, this.draft());
    return conflictsFor(actions, this.view.meta, this.orig.code, this.active(), cur).map((u) => ({
      ...u,
      name: this.catalog.action(u.code).longName,
    }));
  });

  /** Conflicts on slots other than the active one, so they're not missed. */
  protected readonly otherConflicts = computed(() => {
    const actions = actionsWithDraft(this.store.actions(), this.orig, this.draft());
    return this.slotNames
      .filter((s) => s !== this.active())
      .filter((s) => {
        const b = this.draft().slots[s];
        return b && isBound(b) && conflictsFor(actions, this.view.meta, this.orig.code, s, b).length > 0;
      });
  });

  // ------------------------------------------------------------ also apply to…

  /** User choices for "Also apply to" rows, by linkKey; absent = the suggested default. */
  private readonly linkChoices = signal<ReadonlyMap<string, boolean>>(new Map());
  /** Group expanded/collapsed overrides, by group key. */
  private readonly groupOpen = signal<ReadonlyMap<string, boolean>>(new Map());

  private readonly sections = computed(() => linkSections(this.orig, this.draft(), this.store.actionMap()));
  protected readonly linkedWrites = computed(() => linkWrites(this.sections(), (k, d) => this.isLinked(k, d)));

  /** Sections for the template, with labels, outcomes and conflict warnings resolved. */
  protected readonly links = computed(() => {
    const choices = this.linkChoices();
    const open = this.groupOpen();
    const actions = actionsWithDraft(this.store.actions(), this.orig, this.draft());
    return this.sections().map((section) => ({
      slot: section.slot,
      after: section.after,
      groups: section.groups.map((g, gi) => {
        const key = `${section.slot}|${gi}|${g.kind}`;
        const items = g.items.map((item) => {
          const k = linkKey(section.slot, item);
          const clash = section.after ? conflictsFor(actions, this.view.meta, item.code, item.slot, section.after) : [];
          return {
            ...item,
            key: k,
            on: choices.get(k) ?? item.checked,
            name: this.catalog.action(item.code).longName,
            mode: this.modeOf(item.code),
            outcome: this.outcome(g.kind === 'shared' ? g.relation : 'equivalent', item.slot, section.after, item.replaces),
            clash: clash.map((u) => this.catalog.action(u.code).longName),
          };
        });
        const title =
          g.kind === 'equivalent'
            ? `Equivalent commands (${g.family.label})`
            : g.relation === 'replacing'
              ? `Also using ${this.catalog.inputLabel(g.via)}: move them too`
              : `Also using ${this.catalog.inputLabel(g.via)}: give them the same ${SLOT_LABELS[section.slot].toLowerCase()}`;
        const defaultOpen = items.some((i) => i.checked) || items.length <= 6;
        return { key, title, items, open: open.get(key) ?? defaultOpen, checked: items.filter((i) => i.on).length };
      }),
    }));
  });

  protected isLinked(key: string, suggested: boolean): boolean {
    return this.linkChoices().get(key) ?? suggested;
  }

  protected setLinked(key: string, on: boolean): void {
    this.linkChoices.update((m) => new Map(m).set(key, on));
  }

  protected setGroupLinked(items: readonly { key: string }[], on: boolean): void {
    this.linkChoices.update((m) => {
      const next = new Map(m);
      for (const i of items) next.set(i.key, on);
      return next;
    });
  }

  protected toggleGroup(key: string, open: boolean): void {
    this.groupOpen.update((m) => new Map(m).set(key, !open));
  }

  private modeOf(code: string): string {
    const ctx = this.catalog.action(code).contexts ?? [];
    return ctx.map((c) => CONTEXT_LABELS[c as GameContext] ?? c).join(', ');
  }

  private outcome(
    relation: 'replacing' | 'alongside' | 'equivalent',
    slot: SlotName,
    after: SlotBinding | null,
    replaces: SlotBinding | null,
  ): string {
    const slotLabel = SLOT_LABELS[slot].toLowerCase();
    if (!after) return `clears its ${slotLabel}`;
    const to = this.catalog.inputLabel(after);
    if (replaces) return `replaces ${this.catalog.inputLabel(replaces)} with ${to}`;
    return relation === 'replacing' ? `moves its ${slotLabel} to ${to}` : `sets its ${slotLabel} to ${to}`;
  }

  protected readonly held = computed(() => (this.capturing() ? this.liveInput.held() : []));
  protected readonly pctLabel = (v: number) => `${v}%`;
  protected readonly deadzonePct = computed(() => Math.round((this.draft().deadzone ?? 0) * 100));

  constructor() {
    this.liveInput.start();
    this.ref.disableClose = true;
    this.ref.keydownEvents().subscribe((e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (this.capturing()) this.cancelCapture();
      else if (this.picking()) this.picking.set(null);
      else this.ref.close(false);
    });
    this.ref.backdropClick().subscribe(() => {
      if (!this.capturing()) this.ref.close(false);
    });
  }

  ngOnDestroy(): void {
    this.cancelCapture();
    this.liveInput.stop();
  }

  // ------------------------------------------------------------ slot selection

  protected selectSlot(slot: SlotName): void {
    if (slot === this.active()) return;
    this.cancelCapture();
    this.picking.set(null);
    this.suggestInverted.set(false);
    this.fullAxis.set(null);
    this.active.set(slot);
  }

  protected slotOf(name: SlotName): SlotBinding | null {
    const b = this.draft().slots[name];
    return b && isBound(b) ? b : null;
  }

  protected slotDirty(name: SlotName): boolean {
    return !slotsEqual(this.orig.slots[name], this.draft().slots[name]);
  }

  private setActive(binding: SlotBinding | null): void {
    const slot = this.active();
    this.draft.update((d) => ({ ...d, slots: { ...d.slots, [slot]: binding } }));
  }

  // ------------------------------------------------------------ capture

  protected async startCapture(target: PickTarget): Promise<void> {
    this.cancelCapture();
    this.picking.set(null);
    this.captureError.set(null);
    const ac = new AbortController();
    this.abort = ac;
    this.capturing.set(target);
    setTimeout(() => this.waitPanel()?.nativeElement.focus());
    try {
      const result = await this.liveInput.capture({
        accept: acceptFor(this.traits, target),
        modifiers: target === 'binding',
        signal: ac.signal,
      });
      if (this.abort === ac) this.useCapture(target, result);
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError' && this.abort === ac) {
        this.captureError.set(`Couldn't read input: ${(e as Error)?.message ?? e}`);
      }
    } finally {
      if (this.abort === ac) {
        this.abort = null;
        this.capturing.set(null);
        setTimeout(() => this.bindButton()?.nativeElement.focus());
      }
    }
  }

  protected cancelCapture(): void {
    const ac = this.abort;
    this.abort = null;
    this.capturing.set(null);
    ac?.abort();
  }

  private useCapture(target: PickTarget, result: CaptureResult): void {
    if (target === 'modifier') {
      const cur = this.currentBound();
      if (cur) this.setActive(addModifier(cur, result.ref));
      return;
    }
    const out = captureToSlot(result, this.traits, this.currentBound());
    this.setActive(out.binding);
    this.suggestInverted.set(out.suggestInverted && !this.draft().inverted);
    this.fullAxis.set(out.fullAxis);
  }

  /** WebHID needs a user gesture to grant a device; capture keeps waiting meanwhile. */
  protected allowController(): void {
    void this.liveInput.requestHidDevices().catch(() => undefined);
  }

  // ------------------------------------------------------------ manual picking

  protected openPicker(target: PickTarget): void {
    this.cancelCapture();
    this.picking.set(this.picking() === target ? null : target);
  }

  protected picked(ref: InputRef): void {
    const target = this.picking();
    this.picking.set(null);
    this.suggestInverted.set(false);
    this.fullAxis.set(null);
    if (target === 'modifier') {
      const cur = this.currentBound();
      if (cur) this.setActive(addModifier(cur, ref));
    } else {
      this.setActive(withInput(this.currentBound(), ref));
    }
    setTimeout(() => this.bindButton()?.nativeElement.focus());
  }

  // ------------------------------------------------------------ edits

  protected clearSlot(): void {
    this.cancelCapture();
    this.suggestInverted.set(false);
    this.fullAxis.set(null);
    this.setActive(null);
  }

  protected restoreSlot(): void {
    this.setActive(this.orig.slots[this.active()] ?? null);
  }

  protected removeMod(index: number): void {
    const cur = this.currentBound();
    if (cur) this.setActive(removeModifier(cur, index));
  }

  protected setHold(hold: boolean): void {
    const cur = this.currentBound();
    if (cur) this.setActive({ ...cur, hold });
  }

  protected useFullAxis(): void {
    const f = this.fullAxis();
    if (f) this.setActive(f);
    this.fullAxis.set(null);
  }

  protected setInverted(v: boolean): void {
    this.draft.update((d) => ({ ...d, inverted: v }));
    this.suggestInverted.set(false);
  }

  protected setDeadzone(pct: number): void {
    this.draft.update((d) => ({ ...d, deadzone: Math.max(0, Math.min(100, pct)) / 100 }));
  }

  protected setToggleOn(v: boolean): void {
    this.draft.update((d) => ({ ...d, toggleOn: v }));
  }

  protected clearOther(code: string, slot: SlotName): void {
    this.draft.update((d) => ({ ...d, clearOthers: [...d.clearOthers, { code, slot }] }));
  }

  protected undoClearOther(index: number): void {
    this.draft.update((d) => ({ ...d, clearOthers: d.clearOthers.filter((_, i) => i !== index) }));
  }

  protected actionName(code: string): string {
    return this.catalog.action(code).longName;
  }

  protected apply(): void {
    this.cancelCapture();
    const draft = this.draft();
    if (this.edits().length) {
      const writes = this.linkedWrites();
      const actions = this.store.actionMap();
      const label = writes.length ? `Edit ${this.info.longName} (+${writes.length} linked)` : `Edit ${this.info.longName}`;
      this.store.mutate(label, (doc) => {
        applyDraft(doc, this.orig, draft);
        applyLinks(doc, writes, actions, this.orig, draft);
      });
    }
    this.ref.close(true);
  }

  protected cancel(): void {
    this.ref.close(false);
  }
}
