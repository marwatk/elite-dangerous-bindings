import { Injectable, WritableSignal, computed, inject, signal } from '@angular/core';
import {
  ActionState,
  BindsDocument,
  SlotBinding,
  SlotName,
  inputId,
  isBound,
} from '../binds/binds-document';
import { CatalogService } from '../data/catalog.service';

export type SourceKind = 'file' | 'template' | 'share' | 'restored';

export interface BindsSource {
  /** File name as opened, e.g. `Custom.4.2.binds`. */
  name: string;
  kind: SourceKind;
  /** File System Access handle when opened with the picker (Chromium). */
  handle?: FileSystemFileHandle;
}

export interface SlotChange {
  code: string;
  slot: SlotName | 'ToggleOn' | 'Inverted' | 'Deadzone';
  before: string;
  after: string;
}

interface Snapshot {
  label: string;
  text: string;
}

interface Session {
  name: string;
  kind: SourceKind;
  original: string;
  current: string;
  savedAt: number;
}

export interface RecentFile {
  name: string;
  text: string;
  openedAt: number;
}

const SESSION_KEY = 'edb.session';
const RECENT_KEY = 'edb.recent';
const MAX_UNDO = 200;
const MAX_RECENT = 5;

/**
 * The open bindings file. All edits go through `mutate()`, which records undo
 * history, bumps `revision` (so computed views refresh) and autosaves.
 */
@Injectable({ providedIn: 'root' })
export class BindingsStore {
  private readonly catalog = inject(CatalogService);

  private readonly docSignal = signal<BindsDocument | null>(null);
  private readonly originalText = signal<string>('');
  /** Incremented on every change to the document. */
  readonly revision = signal(0);
  readonly source = signal<BindsSource | null>(null);
  private readonly undoStack = signal<Snapshot[]>([]);
  private readonly redoStack = signal<Snapshot[]>([]);

  // The document is edited in place, so the same instance must still count as
  // a change after every revision (default equality would hide edits).
  readonly doc = computed(
    () => {
      this.revision();
      return this.docSignal();
    },
    { equal: () => false },
  );
  readonly isOpen = computed(() => this.docSignal() !== null);
  readonly actions = computed<ActionState[]>(() => this.doc()?.actions() ?? []);
  readonly actionMap = computed(() => new Map(this.actions().map((a) => [a.code, a])));
  readonly text = computed(() => this.doc()?.serialize() ?? '');
  readonly dirty = computed(() => this.isOpen() && this.text() !== this.originalText());
  readonly canUndo = computed(() => this.undoStack().length > 0);
  readonly canRedo = computed(() => this.redoStack().length > 0);
  readonly undoLabel = computed(() => this.undoStack().at(-1)?.label ?? null);
  readonly redoLabel = computed(() => this.redoStack().at(-1)?.label ?? null);
  readonly devicesUsed = computed(() => this.doc()?.devicesUsed() ?? []);

  /** Differences between the file as loaded and now. */
  readonly changes = computed<SlotChange[]>(() => {
    const doc = this.doc();
    const orig = this.originalText();
    if (!doc || !this.dirty()) return [];
    let before: BindsDocument;
    try {
      before = BindsDocument.parse(orig);
    } catch {
      return [];
    }
    const prev = new Map(before.actions().map((a) => [a.code, a]));
    const out: SlotChange[] = [];
    for (const a of doc.actions()) {
      const p = prev.get(a.code);
      for (const slot of Object.keys(a.slots) as SlotName[]) {
        const x = describeSlot(p?.slots[slot]);
        const y = describeSlot(a.slots[slot]);
        if (x !== y) out.push({ code: a.code, slot, before: x, after: y });
      }
      const flags: [SlotChange['slot'], unknown, unknown][] = [
        ['ToggleOn', p?.toggleOn, a.toggleOn],
        ['Inverted', p?.inverted, a.inverted],
        ['Deadzone', p?.deadzone, a.deadzone],
      ];
      for (const [slot, x, y] of flags) {
        if ((x ?? null) !== (y ?? null)) out.push({ code: a.code, slot, before: String(x ?? ''), after: String(y ?? '') });
      }
    }
    return out;
  });

  readonly recent = signal<RecentFile[]>(readJson<RecentFile[]>(RECENT_KEY) ?? []);

  // ------------------------------------------------------------ loading

  /** Parse and open a file. Throws BindsFormatError / XmlParseError. */
  open(text: string, source: BindsSource): BindsDocument {
    const doc = BindsDocument.parse(text);
    this.docSignal.set(doc);
    this.originalText.set(doc.serialize());
    this.source.set(source);
    this.undoStack.set([]);
    this.redoStack.set([]);
    this.bump();
    if (source.kind === 'file') this.remember(source.name, text);
    void this.catalog.loadDevicesFor(doc.devicesUsed());
    return doc;
  }

  async openFile(file: File, handle?: FileSystemFileHandle): Promise<BindsDocument> {
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await file.arrayBuffer());
    return this.open(text, { name: file.name, kind: 'file', handle });
  }

  async openTemplate(name = 'Empty.4.2.binds'): Promise<BindsDocument> {
    const res = await fetch(`data/templates/${name}`);
    if (!res.ok) throw new Error(`Template ${name} not found`);
    const doc = this.open(await res.text(), { name: 'Custom.4.2.binds', kind: 'template' });
    return doc;
  }

  close(): void {
    this.docSignal.set(null);
    this.originalText.set('');
    this.source.set(null);
    this.undoStack.set([]);
    this.redoStack.set([]);
    this.bump();
    tryStorage(() => localStorage.removeItem(SESSION_KEY));
  }

  /** The autosaved session from a previous visit, if it has unsaved edits. */
  savedSession(): Session | null {
    const s = readJson<Session>(SESSION_KEY);
    return s && s.current !== s.original ? s : null;
  }

  restoreSession(): boolean {
    const s = readJson<Session>(SESSION_KEY);
    if (!s) return false;
    this.open(s.original, { name: s.name, kind: 'restored' });
    if (s.current !== s.original) {
      this.mutate('Restore unsaved changes', (doc) => {
        const next = BindsDocument.parse(s.current);
        this.docSignal.set(next);
        return doc;
      });
    }
    return true;
  }

  // ------------------------------------------------------------ editing

  /**
   * Apply an edit as one undoable step. `fn` edits the document in place.
   */
  mutate(label: string, fn: (doc: BindsDocument) => unknown): void {
    const doc = this.docSignal();
    if (!doc) throw new Error('No bindings file is open');
    const before = doc.serialize();
    fn(doc);
    const after = this.docSignal()!.serialize();
    if (after === before) return;
    this.undoStack.update((s) => [...s.slice(-MAX_UNDO + 1), { label, text: before }]);
    this.redoStack.set([]);
    this.bump();
  }

  setSlot(code: string, slot: SlotName, binding: SlotBinding | null, label?: string): void {
    this.mutate(label ?? `${binding ? 'Bind' : 'Clear'} ${this.catalog.action(code).longName}`, (d) =>
      d.setSlot(code, slot, binding),
    );
  }

  undo(): void {
    this.step(this.undoStack, this.redoStack);
  }

  redo(): void {
    this.step(this.redoStack, this.undoStack);
  }

  /** Revert one change from the change list back to the loaded value. */
  revertChange(change: SlotChange): void {
    const before = BindsDocument.parse(this.originalText()).getAction(change.code);
    if (!before) return;
    this.mutate(`Revert ${this.catalog.action(change.code).longName}`, (d) => {
      if (change.slot === 'ToggleOn') d.setToggleOn(change.code, !!before.toggleOn);
      else if (change.slot === 'Inverted') d.setInverted(change.code, !!before.inverted);
      else if (change.slot === 'Deadzone') d.setDeadzone(change.code, before.deadzone ?? 0);
      else d.setSlot(change.code, change.slot, before.slots[change.slot] ?? null);
    });
  }

  revertAll(): void {
    const orig = this.originalText();
    if (!orig) return;
    this.mutate('Revert all changes', () => this.docSignal.set(BindsDocument.parse(orig)));
  }

  /** Mark the current text as saved (after an export or save). */
  markSaved(name?: string): void {
    this.originalText.set(this.text());
    if (name) this.source.update((s) => (s ? { ...s, name } : s));
    this.persist();
  }

  // ------------------------------------------------------------ internals

  private step(from: WritableSignal<Snapshot[]>, to: WritableSignal<Snapshot[]>): void {
    const doc = this.docSignal();
    const snap = from().at(-1);
    if (!doc || !snap) return;
    from.update((s) => s.slice(0, -1));
    to.update((s) => [...s, { label: snap.label, text: doc.serialize() }]);
    this.docSignal.set(BindsDocument.parse(snap.text));
    this.bump();
  }

  private bump(): void {
    this.revision.update((r) => r + 1);
    this.persist();
  }

  private persist(): void {
    const doc = this.docSignal();
    const src = this.source();
    if (!doc || !src) return;
    const session: Session = {
      name: src.name,
      kind: src.kind,
      original: this.originalText(),
      current: doc.serialize(),
      savedAt: Date.now(),
    };
    tryStorage(() => localStorage.setItem(SESSION_KEY, JSON.stringify(session)));
  }

  private remember(name: string, text: string): void {
    const list = [{ name, text, openedAt: Date.now() }, ...this.recent().filter((r) => r.name !== name)].slice(
      0,
      MAX_RECENT,
    );
    this.recent.set(list);
    tryStorage(() => localStorage.setItem(RECENT_KEY, JSON.stringify(list)));
  }

  forgetRecent(name: string): void {
    const list = this.recent().filter((r) => r.name !== name);
    this.recent.set(list);
    tryStorage(() => localStorage.setItem(RECENT_KEY, JSON.stringify(list)));
  }
}

/** Stable text form of a slot, for change detection and display. */
export function describeSlot(slot: SlotBinding | null | undefined): string {
  if (!slot || !isBound(slot)) return '';
  const mods = slot.modifiers.map((m) => inputId(m)).join(' + ');
  return `${mods ? mods + ' + ' : ''}${inputId(slot)}${slot.hold ? ' (hold)' : ''}`;
}

function tryStorage(fn: () => void): void {
  try {
    fn();
  } catch {
    // Storage full, blocked or unavailable: autosave is a convenience only.
  }
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
