import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { CatalogService } from '../../../core/data/catalog.service';
import { Box, ImagePoint } from '../../../core/data/catalog.types';
import { normalizeBindsId, readDeviceZip, slugifyDeviceId, usbFromBindsId } from '../../../core/devices/device-files';
import { LocalDeviceStore } from '../../../core/devices/local-device-store.service';
import { LiveDevice } from '../../../core/input/input.types';
import {
  DraftControl,
  DraftId,
  DraftImage,
  EditorDraft,
  PlaceItem,
  definitionToDraft,
  draftToDefinition,
  emptyDraft,
  groupItem,
  groupOfControl,
  imageFileNames,
  newUid,
  placeableControls,
  primaryIds,
} from './draft';
import { applyCanvas, canvasAdjustment, canvasPaddingFor, canvasSettings } from './canvas';
import { BorderColour, CanvasSettings, hasPadding, resolveBackground } from './canvas-padding';
import { GroupSpec, cleanGroups, createGroup, updateGroup, ungroup } from './groups';
import { adjustImage, detectImageBackground } from './image-tools';
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

  /** The draft as exported: images grown to their canvas, boxes moved to match (geometry only). */
  readonly exportDraft = computed(() => applyCanvas(this.draft()));
  readonly definition = computed(() => draftToDefinition(this.exportDraft()));
  readonly fileNames = computed(() => imageFileNames(this.exportDraft()));
  readonly canvas = computed(() => canvasSettings(this.draft()));
  /** Background colour detected from each image's border, by image uid. */
  readonly detected = signal<ReadonlyMap<string, BorderColour>>(new Map());
  private readonly detecting = new Map<string, Promise<BorderColour>>();
  private readonly renders = new Map<string, Promise<DraftImage>>();
  readonly placeable = computed(() => placeableControls(this.draft()));
  readonly primaries = computed(() => primaryIds(this.draft()));
  /** The control or group being placed/edited. */
  readonly activeControl = computed<PlaceItem | null>(() => {
    const d = this.draft();
    const uid = this.activeUid();
    const g = d.groups?.find((x) => x.uid === uid);
    return g ? groupItem(d, g) : (d.controls.find((c) => c.uid === uid) ?? null);
  });
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
    this.draft.set({ ...cleanGroups(next), updated: Date.now() });
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

  /** Add uploaded images. New artwork (a photo) has no printed boxes, so cards draw them. */
  addImages(images: DraftImage[]): void {
    this.update((d) => ({ ...d, images: [...d.images, ...images], drawBoxes: true }));
  }

  setDrawBoxes(on: boolean): void {
    this.update((d) => ({ ...d, drawBoxes: on }));
  }

  /** Swap an image (after an adjustment), moving its boxes and leader lines to match. */
  replaceImage(index: number, image: DraftImage, boxes?: Map<string, Box>, leaders?: Map<string, ImagePoint[]>): void {
    const move = <T extends { uid: string; box?: Box; leader?: ImagePoint[] }>(c: T): T => {
      let out = c;
      if (boxes?.has(c.uid)) out = { ...out, box: boxes.get(c.uid) };
      if (leaders?.has(c.uid)) out = { ...out, leader: leaders.get(c.uid) };
      return out;
    };
    this.update((d) => ({
      ...d,
      images: d.images.map((img, i) => (i === index ? image : img)),
      controls: d.controls.map(move),
      ...(d.groups ? { groups: d.groups.map(move) } : {}),
    }));
  }

  removeImage(index: number): void {
    this.update((d) => ({
      ...d,
      images: d.images.filter((_, i) => i !== index),
      ...(d.groups
        ? {
            groups: d.groups.map((g) => {
              const img = g.image ?? 0;
              if (!g.box) return g;
              if (img === index) {
                const { box: _b, image: _i, leader: _l, ...rest } = g;
                return rest;
              }
              return img > index ? { ...g, image: img - 1 } : g;
            }),
          }
        : {}),
      controls: d.controls.map((c) => {
        const img = c.image ?? 0;
        if (!c.box) return c;
        if (img === index) {
          const { box: _b, image: _i, leader: _l, ...rest } = c;
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
      return {
        ...d,
        images,
        controls: d.controls.map((c) => (c.box ? { ...c, image: swap(c.image ?? 0) } : c)),
        ...(d.groups ? { groups: d.groups.map((g) => (g.box ? { ...g, image: swap(g.image ?? 0) } : g)) } : {}),
      };
    });
  }

  // ------------------------------------------------------------ canvas

  setCanvas(patch: Partial<CanvasSettings>, coalesce?: string): void {
    this.update((d) => ({ ...d, canvas: { ...canvasSettings(d), ...patch } }), { coalesce });
  }

  /** Detect (once per image) the background colour of its border. */
  detectFor(img: DraftImage): Promise<BorderColour> {
    let p = this.detecting.get(img.uid);
    if (!p) {
      p = detectImageBackground(img).catch(() => ({ color: null, share: 0, busy: false }));
      this.detecting.set(img.uid, p);
      void p.then((r) => this.detected.update((m) => new Map(m).set(img.uid, r)));
    }
    return p;
  }

  /** Image `index` drawn on its canvas (the original when nothing lies beside it). */
  async renderCanvas(index: number, d: EditorDraft = this.draft()): Promise<DraftImage> {
    const img = d.images[index];
    const pad = canvasPaddingFor(d, index);
    if (!hasPadding(pad)) return img;
    const setting = canvasSettings(d).background;
    const detected = setting.kind === 'auto' ? (await this.detectFor(img)).color : null;
    const adj = canvasAdjustment(pad, resolveBackground(setting, detected));
    const key = `${img.uid}|${JSON.stringify(adj)}`;
    let p = this.renders.get(key);
    if (!p) {
      if (this.renders.size > 12) this.renders.clear();
      p = adjustImage(img, adj);
      this.renders.set(key, p);
      p.catch(() => this.renders.delete(key));
    }
    return p;
  }

  /** The draft with every image drawn on its canvas: what the .zip and "Save to this browser" contain. */
  async materialize(): Promise<EditorDraft> {
    const d = this.draft();
    const rendered = new Map<number, DraftImage>();
    for (let i = 0; i < d.images.length; i++) {
      const out = await this.renderCanvas(i, d);
      if (out !== d.images[i]) rendered.set(i, out);
    }
    return applyCanvas(d, rendered);
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

  /** Set boxes of controls or groups, by uid (gesture steps pass undo: false after checkpoint()). */
  setBoxes(boxes: Map<string, Box>, opts: { undo?: boolean; image?: number; coalesce?: string } = {}): void {
    const put = <T extends { uid: string; box?: Box; image?: number }>(c: T): T =>
      boxes.has(c.uid) ? { ...c, box: boxes.get(c.uid)!, image: opts.image ?? (c.box ? (c.image ?? 0) : this.imageIndex()) } : c;
    this.update(
      (d) => ({ ...d, controls: d.controls.map(put), ...(d.groups ? { groups: d.groups.map(put) } : {}) }),
      { undo: opts.undo, coalesce: opts.coalesce },
    );
  }

  removeBoxes(uids: Iterable<string>): void {
    const set = new Set(uids);
    const drop = <T extends { uid: string; box?: Box; image?: number; leader?: ImagePoint[] }>(c: T): T => {
      if (!set.has(c.uid) || !c.box) return c;
      const { box: _b, image: _i, leader: _l, ...rest } = c;
      return rest as T;
    };
    this.update((d) => ({ ...d, controls: d.controls.map(drop), ...(d.groups ? { groups: d.groups.map(drop) } : {}) }));
    this.selected.set(new Set());
  }

  // ------------------------------------------------------------ groups

  /** Group controls (one box for all of them). Returns the group's uid. */
  groupControls(spec: GroupSpec): string {
    const uid = newUid();
    this.update((d) => createGroup(d, spec, uid));
    return uid;
  }

  updateGroup(uid: string, spec: Partial<GroupSpec>, coalesce?: string): void {
    this.update((d) => updateGroup(d, uid, spec), { coalesce });
  }

  ungroup(uid: string): void {
    this.update((d) => ungroup(d, uid));
    if (this.activeUid() === uid) this.activeUid.set(null);
    this.selected.update((s) => new Set([...s].filter((u) => u !== uid)));
  }

  /** Set or (null) remove a box's leader line (gesture steps pass undo: false after checkpoint()). */
  setLeader(uid: string, leader: ImagePoint[] | null, opts: { undo?: boolean; coalesce?: string } = {}): void {
    const put = <T extends { uid: string; leader?: ImagePoint[] }>(x: T): T => {
      if (x.uid !== uid) return x;
      if (leader?.length) return { ...x, leader: leader.map((p) => ({ x: p.x, y: p.y })) };
      const { leader: _l, ...rest } = x;
      return rest as T;
    };
    this.update(
      (d) => {
        const c = d.controls.find((x) => x.uid === uid) ?? d.groups?.find((x) => x.uid === uid);
        if (!c?.box || (!leader?.length && !c.leader)) return d;
        return { ...d, controls: d.controls.map(put), ...(d.groups ? { groups: d.groups.map(put) } : {}) };
      },
      { undo: opts.undo, coalesce: opts.coalesce },
    );
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

  /** Select a control (a grouped one selects its group); with a box on another image, switch to it. */
  activate(uid: string | null, opts: { addToSelection?: boolean } = {}): void {
    const d = this.draft();
    if (uid) uid = groupOfControl(d, uid)?.uid ?? uid;
    this.activeUid.set(uid);
    const g = uid ? d.groups?.find((x) => x.uid === uid) : undefined;
    const c = uid ? (g ?? d.controls.find((x) => x.uid === uid)) : null;
    if (c?.box) {
      if ((c.image ?? 0) !== this.imageIndex()) this.imageIndex.set(c.image ?? 0);
      this.selected.update((s) => (opts.addToSelection ? new Set([...s, c.uid]) : new Set([c.uid])));
    } else if (!opts.addToSelection) {
      this.selected.set(new Set());
    }
  }
}
