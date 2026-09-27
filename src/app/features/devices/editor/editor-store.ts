import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { CatalogService } from '../../../core/data/catalog.service';
import { Box } from '../../../core/data/catalog.types';
import { normalizeBindsId, readDeviceZip, slugifyDeviceId, usbFromBindsId } from '../../../core/devices/device-files';
import { LocalDeviceStore } from '../../../core/devices/local-device-store.service';
import { LiveDevice } from '../../../core/input/input.types';
import {
  DraftControl,
  DraftId,
  DraftImage,
  EditorDraft,
  definitionToDraft,
  draftToDefinition,
  emptyDraft,
  imageFileNames,
  newUid,
  placeableControls,
  primaryIds,
} from './draft';
import { ControlSpec, compareControls, mergeControls } from './inventory';
import { StepId, ValidationContext, validateDraft } from './validation';

const MAX_UNDO = 200;

/** State of one layout editor session. Provided by the LayoutEditor component. */
@Injectable()
export class EditorStore implements OnDestroy {
  private readonly catalog = inject(CatalogService);
  private readonly local = inject(LocalDeviceStore);

  readonly draft = signal<EditorDraft>(emptyDraft());
  readonly ready = signal(false);
  readonly loadError = signal<string | null>(null);
  /** The draft came from autosave. */
  readonly restored = signal(false);
  readonly step = signal<StepId>('image');

  /** Control being placed/edited. */
  readonly activeUid = signal<string | null>(null);
  /** Boxes selected on the canvas (multi-select with shift). */
  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly imageIndex = signal(0);
  /** Part new controls are added to. */
  readonly currentPart = signal<string | null>(null);
  /** Controller detected in the Identify step (for its button/axis counts). */
  readonly liveDevice = signal<LiveDevice | null>(null);
  /** Size of the last box drawn or resized ("same size as last"). */
  readonly lastSize = signal<{ w: number; h: number } | null>(null);

  private key = 'new';
  private undoStack: EditorDraft[] = [];
  private redoStack: EditorDraft[] = [];
  private lastCoalesce: { key: string; at: number } | null = null;
  private readonly historyRev = signal(0);
  readonly canUndo = computed(() => (this.historyRev(), this.undoStack.length > 0));
  readonly canRedo = computed(() => (this.historyRev(), this.redoStack.length > 0));

  readonly definition = computed(() => draftToDefinition(this.draft()));
  readonly fileNames = computed(() => imageFileNames(this.draft()));
  readonly placeable = computed(() => placeableControls(this.draft()));
  readonly primaries = computed(() => primaryIds(this.draft()));
  readonly activeControl = computed(() => this.draft().controls.find((c) => c.uid === this.activeUid()) ?? null);
  readonly placedCount = computed(() => this.placeable().filter((c) => c.box).length);

  private readonly validationContext: ValidationContext = {
    bundledIds: new Set(),
    localIds: new Set(),
    handledBy: (bindsId, deviceIndex) => {
      const d = this.catalog.deviceFor(bindsId, deviceIndex ?? 0);
      return d && !d.local && d.ids.some((i) => i.bindsId === bindsId) ? d.id : undefined;
    },
  };
  readonly issues = computed(() => {
    const devices = this.catalog.devices();
    const ctx: ValidationContext = {
      ...this.validationContext,
      bundledIds: new Set(devices.filter((d) => !d.local).map((d) => d.id)),
      localIds: new Set(devices.filter((d) => d.local).map((d) => d.id)),
    };
    return validateDraft(this.draft(), ctx);
  });

  private readonly urls = new WeakMap<Blob, string>();
  private readonly allUrls: string[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnDestroy(): void {
    this.flushSave();
    for (const u of this.allUrls) URL.revokeObjectURL(u);
  }

  // ------------------------------------------------------------ loading

  /** Open the editor for a new device (baseId null) or an existing one. Restores autosaved work. */
  async open(baseId: string | null, prefill?: { bindsId?: string }): Promise<void> {
    this.ready.set(false);
    this.key = baseId ? `edit:${baseId}` : 'new';
    try {
      const saved = await this.local.loadDraft<EditorDraft>(this.key);
      if (saved?.version === 1 && Array.isArray(saved.controls)) {
        this.draft.set(saved);
        this.restored.set(true);
      } else {
        this.draft.set(baseId ? await this.loadExisting(baseId) : this.fresh(prefill?.bindsId));
      }
    } catch (e) {
      this.loadError.set((e as Error).message);
      this.draft.set(this.fresh(prefill?.bindsId));
    }
    this.afterLoad();
  }

  private fresh(bindsId?: string): EditorDraft {
    const d = emptyDraft();
    if (bindsId) {
      const b = normalizeBindsId(bindsId);
      d.ids = [{ uid: newUid(), bindsId: b, usb: usbFromBindsId(b) }];
    }
    return d;
  }

  private async loadExisting(id: string): Promise<EditorDraft> {
    const stored = this.local.get(id);
    if (stored) return definitionToDraft(stored.definition, stored.images);
    await this.catalog.whenReady();
    const def = await this.catalog.loadDevice(id);
    const images = await Promise.all(
      def.images.map(async (_, i) => {
        const res = await fetch(this.catalog.imageUrl(def, i)!);
        if (!res.ok) throw new Error(`Could not load ${def.images[i].file}`);
        return res.blob();
      }),
    );
    return definitionToDraft(def, images);
  }

  private afterLoad(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.historyRev.update((n) => n + 1);
    this.activeUid.set(null);
    this.selected.set(new Set());
    this.imageIndex.set(0);
    this.currentPart.set(this.primaries()[0]?.uid ?? null);
    this.ready.set(true);
  }

  /** Throw away autosaved work and start again from the saved device (or blank). */
  async discard(): Promise<void> {
    await this.local.deleteDraft(this.key);
    const baseId = this.draft().baseId;
    this.restored.set(false);
    this.loadError.set(null);
    await this.open(baseId && this.key !== 'new' ? baseId : null);
  }

  /** Forget the autosaved draft (after saving the device). */
  async clearDraft(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await this.local.deleteDraft(this.key);
  }

  /** Replace the draft with a device .zip (undoable). */
  async importZip(file: Blob): Promise<void> {
    const { definition, images } = await readDeviceZip(file);
    const d = definitionToDraft(definition, images);
    this.update(() => ({ ...d, baseId: this.draft().baseId, baseSource: this.draft().baseSource }));
    this.currentPart.set(primaryIds(d)[0]?.uid ?? null);
    this.imageIndex.set(0);
  }

  // ------------------------------------------------------------ history

  /** Apply a change. `coalesce` merges rapid edits of the same thing (typing) into one undo step. */
  update(fn: (d: EditorDraft) => EditorDraft, opts: { undo?: boolean; coalesce?: string } = {}): void {
    const prev = this.draft();
    const next = fn(prev);
    if (next === prev) return;
    if (opts.undo !== false) {
      const now = Date.now();
      const merge = opts.coalesce && this.lastCoalesce?.key === opts.coalesce && now - this.lastCoalesce.at < 1500;
      if (!merge) this.pushUndo(prev);
      this.lastCoalesce = opts.coalesce ? { key: opts.coalesce, at: now } : null;
    }
    this.draft.set({ ...next, updated: Date.now() });
    this.scheduleSave();
  }

  /** Record the current state before a gesture whose steps use update(..., { undo: false }). */
  checkpoint(): void {
    this.pushUndo(this.draft());
    this.lastCoalesce = null;
  }

  private pushUndo(d: EditorDraft): void {
    this.undoStack.push(d);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this.historyRev.update((n) => n + 1);
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.draft());
    this.restore(prev);
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.draft());
    this.restore(next);
  }

  private restore(d: EditorDraft): void {
    this.lastCoalesce = null;
    this.draft.set(d);
    this.historyRev.update((n) => n + 1);
    if (this.imageIndex() >= d.images.length) this.imageIndex.set(Math.max(0, d.images.length - 1));
    this.scheduleSave();
  }

  // ------------------------------------------------------------ autosave

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), 600);
  }

  private flushSave(): void {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    void this.local.saveDraft(this.key, this.draft());
  }

  // ------------------------------------------------------------ images

  urlFor(blob: Blob | undefined): string | null {
    if (!blob) return null;
    let u = this.urls.get(blob);
    if (!u) {
      u = URL.createObjectURL(blob);
      this.urls.set(blob, u);
      this.allUrls.push(u);
    }
    return u;
  }

  addImages(images: DraftImage[]): void {
    this.update((d) => ({ ...d, images: [...d.images, ...images] }));
  }

  replaceImage(index: number, image: DraftImage, boxes?: Map<string, Box>): void {
    this.update((d) => ({
      ...d,
      images: d.images.map((img, i) => (i === index ? image : img)),
      controls: boxes ? d.controls.map((c) => (boxes.has(c.uid) ? { ...c, box: boxes.get(c.uid) } : c)) : d.controls,
    }));
  }

  removeImage(index: number): void {
    this.update((d) => ({
      ...d,
      images: d.images.filter((_, i) => i !== index),
      controls: d.controls.map((c) => {
        const img = c.image ?? 0;
        if (!c.box) return c;
        if (img === index) {
          const { box: _b, image: _i, ...rest } = c;
          return rest;
        }
        return img > index ? { ...c, image: img - 1 } : c;
      }),
    }));
    if (this.imageIndex() >= this.draft().images.length) this.imageIndex.set(Math.max(0, this.draft().images.length - 1));
  }

  moveImage(index: number, delta: -1 | 1): void {
    const j = index + delta;
    this.update((d) => {
      if (j < 0 || j >= d.images.length) return d;
      const images = [...d.images];
      [images[index], images[j]] = [images[j], images[index]];
      const swap = (n: number) => (n === index ? j : n === j ? index : n);
      return { ...d, images, controls: d.controls.map((c) => (c.box ? { ...c, image: swap(c.image ?? 0) } : c)) };
    });
  }

  // ------------------------------------------------------------ identity

  setName(name: string): void {
    this.update((d) => ({ ...d, name, id: d.idEdited ? d.id : slugifyDeviceId(name) }), { coalesce: 'name' });
  }

  setId(id: string): void {
    this.update((d) => ({ ...d, id: id.trim(), idEdited: true }), { coalesce: 'id' });
  }

  /** Add an Elite ID. Returns false if already present. The first ID becomes a part; later ones alias it by default. */
  addId(raw: string, opts: { deviceIndex?: number; usb?: DraftId['usb']; ownPart?: boolean } = {}): boolean {
    const bindsId = normalizeBindsId(raw);
    const d = this.draft();
    if (d.ids.some((i) => i.bindsId === bindsId && i.deviceIndex === opts.deviceIndex)) return false;
    const first = primaryIds(d)[0];
    const id: DraftId = { uid: newUid(), bindsId };
    if (opts.deviceIndex !== undefined) id.deviceIndex = opts.deviceIndex;
    const usb = opts.usb ?? usbFromBindsId(bindsId);
    if (usb) id.usb = usb;
    if (first && !opts.ownPart) id.aliasOf = first.uid;
    this.update((dd) => ({ ...dd, ids: [...dd.ids, id] }));
    if (!this.currentPart()) this.currentPart.set(id.uid);
    return true;
  }

  updateId(uid: string, patch: Partial<Omit<DraftId, 'uid'>>): void {
    this.update((d) => ({
      ...d,
      ids: d.ids.map((i) => {
        if (i.uid !== uid) return i;
        const next: DraftId = { ...i, ...patch };
        for (const [k, v] of Object.entries(patch)) if (v === undefined) delete (next as unknown as Record<string, unknown>)[k];
        return next;
      }),
    }));
  }

  /** Make an ID share another's controls, or (null) have its own. */
  setAlias(uid: string, aliasOf: string | null): void {
    this.update((d) => {
      const self = d.ids.find((i) => i.uid === uid);
      const formerPrimary = self?.aliasOf;
      const ids = d.ids.map((i) => {
        if (i.uid === uid) {
          const { aliasOf: _a, labelOverrides: _l, ...rest } = i;
          return aliasOf ? { ...rest, aliasOf } : rest;
        }
        // Anything aliasing this one follows it.
        return i.aliasOf === uid && aliasOf ? { ...i, aliasOf } : i;
      });
      // Controls of a part that becomes an alias move to its new primary (merged by key).
      let controls = d.controls;
      if (aliasOf) {
        const moving = controls.filter((c) => c.part === uid);
        const keys = new Set(controls.filter((c) => c.part === aliasOf).map((c) => c.key));
        controls = controls.filter((c) => c.part !== uid).concat(moving.filter((c) => !keys.has(c.key)).map((c) => ({ ...c, part: aliasOf })));
      } else if (formerPrimary && self) {
        // Becoming its own part: start from a copy of the controls it shared.
        const copy = controls
          .filter((c) => c.part === formerPrimary)
          .map((c) => ({ ...c, uid: newUid(), part: uid, label: self.labelOverrides?.[c.key] ?? c.label }));
        controls = [...controls, ...copy];
      }
      return { ...d, ids, controls };
    });
    if (aliasOf && this.currentPart() === uid) this.currentPart.set(aliasOf);
    if (!aliasOf && !this.currentPart()) this.currentPart.set(uid);
  }

  removeId(uid: string): void {
    this.update((d) => {
      const aliases = d.ids.filter((i) => i.aliasOf === uid);
      const heir = aliases[0];
      const ids = d.ids
        .filter((i) => i.uid !== uid)
        .map((i) => {
          if (heir && i.uid === heir.uid) {
            const { aliasOf: _a, ...rest } = i;
            return rest;
          }
          return i.aliasOf === uid && heir ? { ...i, aliasOf: heir.uid } : i;
        });
      // Controls pass to the first alias, or go with the ID.
      const controls = heir ? d.controls.map((c) => (c.part === uid ? { ...c, part: heir.uid } : c)) : d.controls.filter((c) => c.part !== uid);
      return { ...d, ids, controls };
    });
    if (this.currentPart() === uid) this.currentPart.set(this.primaries()[0]?.uid ?? null);
  }

  // ------------------------------------------------------------ controls

  /** Add controls to a part (skipping keys it already has). */
  addControls(specs: ControlSpec[], part = this.currentPart(), relabel = false): { added: number; relabelled: number } {
    if (!part) return { added: 0, relabelled: 0 };
    let result = { added: 0, relabelled: 0 };
    this.update((d) => {
      const r = mergeControls(d.controls, specs, part, relabel);
      result = r;
      return r.added || r.relabelled ? { ...d, controls: r.controls } : d;
    });
    return result;
  }

  updateControl(uid: string, patch: Partial<Omit<DraftControl, 'uid'>>, coalesce?: string): void {
    this.update((d) => ({ ...d, controls: d.controls.map((c) => (c.uid === uid ? { ...c, ...patch } : c)) }), { coalesce });
  }

  removeControls(uids: Iterable<string>): void {
    const set = new Set(uids);
    this.update((d) => ({ ...d, controls: d.controls.filter((c) => !set.has(c.uid)) }));
    if (this.activeUid() && set.has(this.activeUid()!)) this.activeUid.set(null);
    this.selected.update((s) => new Set([...s].filter((u) => !set.has(u))));
  }

  sortControls(): void {
    this.update((d) => ({ ...d, controls: [...d.controls].sort(compareControls) }));
  }

  /** Set boxes (gesture steps pass undo: false after checkpoint()). */
  setBoxes(boxes: Map<string, Box>, opts: { undo?: boolean; image?: number; coalesce?: string } = {}): void {
    this.update(
      (d) => ({
        ...d,
        controls: d.controls.map((c) =>
          boxes.has(c.uid) ? { ...c, box: boxes.get(c.uid)!, image: opts.image ?? (c.box ? (c.image ?? 0) : this.imageIndex()) } : c,
        ),
      }),
      { undo: opts.undo, coalesce: opts.coalesce },
    );
  }

  removeBoxes(uids: Iterable<string>): void {
    const set = new Set(uids);
    this.update((d) => ({
      ...d,
      controls: d.controls.map((c) => {
        if (!set.has(c.uid) || !c.box) return c;
        const { box: _b, image: _i, ...rest } = c;
        return rest;
      }),
    }));
    this.selected.set(new Set());
  }

  /** Next control without a box, after the given one (wrapping). */
  nextUnplaced(after: string | null): DraftControl | null {
    const list = this.placeable();
    const start = after ? list.findIndex((c) => c.uid === after) : -1;
    for (let k = 1; k <= list.length; k++) {
      const c = list[(start + k) % list.length];
      if (!c.box) return c;
    }
    return null;
  }

  /** Select a control; with a box on another image, switch to it. */
  activate(uid: string | null, opts: { addToSelection?: boolean } = {}): void {
    this.activeUid.set(uid);
    const c = uid ? this.draft().controls.find((x) => x.uid === uid) : null;
    if (c?.box) {
      if ((c.image ?? 0) !== this.imageIndex()) this.imageIndex.set(c.image ?? 0);
      this.selected.update((s) => (opts.addToSelection ? new Set([...s, c.uid]) : new Set([c.uid])));
    } else if (!opts.addToSelection) {
      this.selected.set(new Set());
    }
  }
}
