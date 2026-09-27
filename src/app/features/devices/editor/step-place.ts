import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { filter } from 'rxjs';
import { Box } from '../../../core/data/catalog.types';
import {
  HANDLES,
  Handle,
  Point,
  SnapLines,
  alignBoxes,
  edgesForHandle,
  nudge,
  rectFromPoints,
  resizeBox,
  roundBox,
  snapEdges,
  snapMove,
  snapTargets,
} from '../../../core/devices/geometry';
import { InputService } from '../../../core/input/input.service';
import { DraftControl, partFor, partLabel } from './draft';
import { EditorStore } from './editor-store';
import { specForKey } from './inventory';

type Gesture =
  | { kind: 'pan'; x: number; y: number; sl: number; st: number }
  | { kind: 'draw'; start: Point; uid: string; targets: SnapLines }
  | { kind: 'move'; start: Point; boxes: Map<string, Box>; primary: string; moved: boolean; targets: SnapLines }
  | { kind: 'resize'; start: Point; uid: string; box: Box; handle: Handle; moved: boolean; targets: SnapLines };

type Placed = DraftControl & { box: Box };

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;

@Component({
  selector: 'app-step-place',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatButtonToggleModule, MatDividerModule, MatIconModule, MatMenuModule, MatSlideToggleModule, MatTooltipModule],
  templateUrl: './step-place.html',
  styleUrl: './step-place.scss',
  host: {
    '(document:keydown)': 'onKey($event)',
    '(document:keyup)': 'onKeyUp($event)',
  },
})
export class StepPlace {
  protected readonly store = inject(EditorStore);
  private readonly input = inject(InputService);
  private readonly injector = inject(Injector);

  private readonly viewport = viewChild<ElementRef<HTMLDivElement>>('viewport');
  private readonly svg = viewChild<ElementRef<SVGSVGElement>>('svg');

  protected readonly handles = HANDLES;
  protected readonly zoom = signal(0.25);
  protected readonly snapOn = signal(true);
  protected readonly gridOn = signal(false);
  protected readonly gridSize = signal(10);
  protected readonly panMode = signal(false);
  protected readonly autoAdvance = signal(true);
  protected readonly onlyUnplaced = signal(false);
  /** Multi-part devices: show only this part's controls (null = all). */
  protected readonly partFilter = signal<string | null>(null);
  protected readonly drawRect = signal<Box | null>(null);
  protected readonly guides = signal<SnapLines>({ x: [], y: [] });
  private gesture: Gesture | null = null;
  private spaceDown = false;

  protected readonly image = computed(() => this.store.draft().images[this.store.imageIndex()] ?? null);
  protected readonly imageUrl = computed(() => this.store.urlFor(this.image()?.blob));
  protected readonly multiPart = computed(() => this.store.primaries().length > 1);
  private readonly visiblePlaceable = computed(() => {
    const f = this.partFilter();
    return f ? this.store.placeable().filter((c) => c.part === f) : this.store.placeable();
  });
  protected readonly checklist = computed(() => {
    const all = this.visiblePlaceable();
    return this.onlyUnplaced() ? all.filter((c) => !c.box || c.uid === this.store.activeUid()) : all;
  });
  /** Boxes on the current image. */
  protected readonly boxes = computed<Placed[]>(() => {
    const idx = this.store.imageIndex();
    return this.visiblePlaceable().filter((c): c is Placed => !!c.box && (c.image ?? 0) === idx);
  });
  /** The one selected box that shows resize handles. */
  protected readonly handleBox = computed(() => {
    const sel = this.store.selected();
    if (sel.size !== 1) return null;
    return this.boxes().find((b) => sel.has(b.uid)) ?? null;
  });
  protected readonly selectedPlaced = computed(() => this.boxes().filter((b) => this.store.selected().has(b.uid)));
  protected readonly stroke = computed(() => 2 / this.zoom());
  protected readonly handleSize = computed(() => 10 / this.zoom());
  protected readonly showGrid = computed(() => this.gridOn() && this.gridSize() * this.zoom() >= 5);
  protected readonly previous = computed(() => {
    const list = this.store.placeable();
    const i = list.findIndex((c) => c.uid === this.store.activeUid());
    return i > 0 ? list[i - 1] : null;
  });

  constructor() {
    // Fit the image when it changes.
    effect(() => {
      const img = this.image();
      if (!img) return;
      untracked(() => afterNextRender({ write: () => this.fit() }, { injector: this.injector }));
    });
    // Keep the active control visible in the checklist.
    effect(() => {
      const uid = this.store.activeUid();
      if (!uid) return;
      untracked(() =>
        afterNextRender(
          { write: () => document.querySelector(`.checklist [data-uid="${uid}"]`)?.scrollIntoView({ block: 'nearest' }) },
          { injector: this.injector },
        ),
      );
    });
    if (!this.store.activeUid()) this.store.activeUid.set(this.store.nextUnplaced(null)?.uid ?? null);

    // Pressing a control on the device selects it (adding it if it isn't listed).
    const sub = this.input.events.pipe(filter((e) => e.pressed && e.kind !== 'key')).subscribe((e) => {
      const d = this.store.draft();
      const part = partFor(d, e.ref.device, e.ref.deviceIndex ?? 0);
      if (!part) return;
      const key = e.ref.key.replace(/^(Pos|Neg)_/, '');
      let c = d.controls.find((x) => x.part === part && x.key === key);
      if (!c) {
        this.store.addControls([specForKey(key)], part);
        c = this.store.draft().controls.find((x) => x.part === part && x.key === key);
      }
      if (c) this.store.activate(c.uid);
    });
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }

  protected partName(part: string): string {
    return partLabel(this.store.draft(), part);
  }

  protected fontSize(b: Box): number {
    return Math.max(4, Math.min(b.h * 0.58, 48));
  }

  // ------------------------------------------------------------ zoom

  protected fit(): void {
    const vp = this.viewport()?.nativeElement;
    const img = this.image();
    if (!vp || !img) return;
    const z = (vp.clientWidth - 4) / img.width;
    this.zoom.set(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)));
  }

  protected zoomBy(factor: number, clientX?: number, clientY?: number): void {
    const vp = this.viewport()?.nativeElement;
    const svg = this.svg()?.nativeElement;
    if (!vp || !svg) return;
    const vr = vp.getBoundingClientRect();
    const cx = clientX ?? vr.left + vr.width / 2;
    const cy = clientY ?? vr.top + vr.height / 2;
    const sr = svg.getBoundingClientRect();
    const old = this.zoom();
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, old * factor));
    const ix = (cx - sr.left) / old;
    const iy = (cy - sr.top) / old;
    this.zoom.set(z);
    afterNextRender(
      {
        write: () => {
          const nr = svg.getBoundingClientRect();
          vp.scrollLeft += nr.left + ix * z - cx;
          vp.scrollTop += nr.top + iy * z - cy;
        },
      },
      { injector: this.injector },
    );
  }

  protected onWheel(e: WheelEvent): void {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    this.zoomBy(Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
  }

  // ------------------------------------------------------------ pointer

  private toImage(e: PointerEvent | MouseEvent): Point {
    const svg = this.svg()!.nativeElement;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  }

  private targets(exclude: Set<string>): SnapLines {
    const img = this.image()!;
    return snapTargets(
      this.boxes()
        .filter((b) => !exclude.has(b.uid))
        .map((b) => b.box),
      { width: img.width, height: img.height },
    );
  }

  private snapOpts() {
    return { threshold: this.snapOn() ? 6 / this.zoom() : 0, grid: this.gridOn() ? this.gridSize() : 0 };
  }

  protected down(e: PointerEvent): void {
    if (e.button === 2 || !this.image()) return;
    const svg = this.svg()!.nativeElement;
    svg.setPointerCapture?.(e.pointerId);
    const vp = this.viewport()!.nativeElement;
    if (e.button === 1 || this.panMode() || this.spaceDown) {
      e.preventDefault();
      this.gesture = { kind: 'pan', x: e.clientX, y: e.clientY, sl: vp.scrollLeft, st: vp.scrollTop };
      return;
    }
    svg.focus({ preventScroll: true });
    const p = this.toImage(e);
    const t = e.target as Element;
    const handle = t.closest('[data-handle]')?.getAttribute('data-handle') as Handle | undefined;
    const hb = this.handleBox();
    if (handle && hb) {
      this.gesture = { kind: 'resize', start: p, uid: hb.uid, box: { ...hb.box }, handle, moved: false, targets: this.targets(new Set([hb.uid])) };
      return;
    }
    const uid = t.closest('[data-uid]')?.getAttribute('data-uid');
    if (uid) {
      const sel = new Set(this.store.selected());
      if (e.shiftKey) {
        if (sel.has(uid)) sel.delete(uid);
        else sel.add(uid);
      } else if (!sel.has(uid)) {
        sel.clear();
        sel.add(uid);
      }
      this.store.selected.set(sel);
      this.store.activeUid.set(uid);
      if (!sel.has(uid)) return;
      const boxes = new Map(this.boxes().filter((b) => sel.has(b.uid)).map((b) => [b.uid, { ...b.box }]));
      this.gesture = { kind: 'move', start: p, boxes, primary: uid, moved: false, targets: this.targets(sel) };
      return;
    }
    const active = this.store.activeControl();
    if (active) {
      this.gesture = { kind: 'draw', start: p, uid: active.uid, targets: this.targets(new Set([active.uid])) };
    } else {
      this.store.selected.set(new Set());
    }
  }

  protected move(e: PointerEvent): void {
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'pan') {
      const vp = this.viewport()!.nativeElement;
      vp.scrollLeft = g.sl - (e.clientX - g.x);
      vp.scrollTop = g.st - (e.clientY - g.y);
      return;
    }
    const p = this.toImage(e);
    const dx = p.x - g.start.x;
    const dy = p.y - g.start.y;
    if (g.kind === 'draw') {
      const r = snapEdges(
        rectFromPoints(g.start, p),
        { left: p.x < g.start.x, right: p.x >= g.start.x, top: p.y < g.start.y, bottom: p.y >= g.start.y },
        g.targets,
        this.snapOpts(),
      );
      this.drawRect.set(r.box);
      this.guides.set(r.guides);
      return;
    }
    if (!g.moved) {
      if (Math.hypot(dx, dy) * this.zoom() < 3) return;
      g.moved = true;
      this.store.checkpoint();
    }
    if (g.kind === 'move') {
      const start = g.boxes.get(g.primary)!;
      const r = snapMove(nudge(start, dx, dy), g.targets, this.snapOpts());
      const ax = r.box.x - start.x;
      const ay = r.box.y - start.y;
      const next = new Map<string, Box>();
      for (const [uid, b] of g.boxes) next.set(uid, nudge(b, ax, ay));
      this.store.setBoxes(next, { undo: false });
      this.guides.set(r.guides);
    } else {
      const r = snapEdges(resizeBox(g.box, g.handle, dx, dy, 2), edgesForHandle(g.handle), g.targets, this.snapOpts());
      this.store.setBoxes(new Map([[g.uid, r.box]]), { undo: false });
      this.guides.set(r.guides);
    }
  }

  protected up(e: PointerEvent): void {
    const g = this.gesture;
    this.gesture = null;
    if (!g) return;
    if (g.kind === 'draw') {
      const r = this.drawRect();
      const c = this.store.draft().controls.find((x) => x.uid === g.uid);
      if (r && r.w * this.zoom() >= 6 && r.h * this.zoom() >= 6) this.finishDraw(g.uid, r);
      else if (c && !c.box) this.finishDraw(g.uid, this.defaultBoxAt(g.start));
      else this.store.selected.set(new Set());
    } else if ((g.kind === 'move' || g.kind === 'resize') && g.moved) {
      const d = this.store.draft();
      const uids = g.kind === 'move' ? [...g.boxes.keys()] : [g.uid];
      const rounded = new Map(uids.map((u) => [u, roundBox(d.controls.find((c) => c.uid === u)!.box!)]));
      this.store.setBoxes(rounded, { undo: false });
      if (g.kind === 'resize') this.store.lastSize.set({ w: rounded.get(g.uid)!.w, h: rounded.get(g.uid)!.h });
    }
    this.drawRect.set(null);
    this.guides.set({ x: [], y: [] });
    void e;
  }

  private defaultBoxAt(p: Point): Box {
    const img = this.image()!;
    const size = this.store.lastSize() ?? { w: Math.round(img.width * 0.15), h: Math.max(8, Math.round(img.height * 0.03)) };
    return { x: p.x, y: p.y - size.h / 2, w: size.w, h: size.h };
  }

  private finishDraw(uid: string, box: Box): void {
    const b = roundBox(box);
    this.store.setBoxes(new Map([[uid, b]]), { image: this.store.imageIndex() });
    this.store.lastSize.set({ w: b.w, h: b.h });
    this.store.selected.set(new Set([uid]));
    if (this.autoAdvance()) {
      const next = this.store.nextUnplaced(uid);
      this.store.activeUid.set(next?.uid ?? uid);
    }
  }

  // ------------------------------------------------------------ commands

  protected pick(c: DraftControl, e: MouseEvent): void {
    this.store.activate(c.uid, { addToSelection: e.shiftKey });
  }

  protected nextUnplaced(): void {
    const n = this.store.nextUnplaced(this.store.activeUid());
    if (n) this.store.activate(n.uid);
  }

  protected deleteSelected(): void {
    const sel = this.store.selected();
    if (sel.size) this.store.removeBoxes(sel);
    else if (this.store.activeControl()?.box) this.store.removeBoxes([this.store.activeUid()!]);
  }

  protected sameSizeAsLast(): void {
    const size = this.store.lastSize();
    if (!size) return;
    const m = new Map(this.selectedPlaced().map((b) => [b.uid, { ...b.box, w: size.w, h: size.h }]));
    if (m.size) this.store.setBoxes(m);
  }

  protected align(edge: 'left' | 'top' | 'right' | 'bottom'): void {
    const sel = [...this.store.selected()];
    const placed = sel.map((u) => this.boxes().find((b) => b.uid === u)).filter((b): b is Placed => !!b);
    if (placed.length < 2) return;
    const out = alignBoxes(
      placed.map((b) => b.box),
      edge,
    );
    this.store.setBoxes(new Map(placed.map((b, i) => [b.uid, out[i]])));
  }

  protected shareWithPrevious(): void {
    const prev = this.previous();
    const active = this.store.activeControl();
    if (!prev?.box || !active) return;
    this.store.setBoxes(new Map([[active.uid, { ...prev.box }]]), { image: prev.image ?? 0 });
    if (this.autoAdvance()) this.nextUnplaced();
  }

  protected setLabel(uid: string, e: Event): void {
    this.store.updateControl(uid, { label: (e.target as HTMLInputElement).value }, `label:${uid}`);
  }

  protected setBoxField(uid: string, field: keyof Box, e: Event): void {
    const c = this.store.draft().controls.find((x) => x.uid === uid);
    const v = Number((e.target as HTMLInputElement).value);
    if (!c?.box || !Number.isFinite(v) || ((field === 'w' || field === 'h') && v <= 0)) return;
    this.store.setBoxes(new Map([[uid, { ...c.box, [field]: v }]]), { coalesce: `box:${uid}` });
  }

  // ------------------------------------------------------------ keyboard

  protected onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t?.closest('input, textarea, select, [contenteditable="true"], .cdk-overlay-container')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const sel = this.selectedPlaced();
    const step = e.shiftKey ? 10 : 1;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (arrows[e.key] && sel.length) {
      e.preventDefault();
      const [dx, dy] = arrows[e.key];
      this.store.setBoxes(new Map(sel.map((b) => [b.uid, nudge(b.box, dx, dy)])), { coalesce: 'nudge' });
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && (sel.length || this.store.activeControl()?.box)) {
      e.preventDefault();
      this.deleteSelected();
    } else if (e.key === 'Escape') {
      this.gesture = null;
      this.drawRect.set(null);
      this.store.selected.set(new Set());
    } else if (e.key === 'n' || e.key === 'N') {
      this.nextUnplaced();
    } else if (e.key === ' ' && t?.closest('.viewport, body') && !t.closest('button')) {
      e.preventDefault();
      this.spaceDown = true;
    } else if (e.key === '+' || e.key === '=') {
      this.zoomBy(1.25);
    } else if (e.key === '-') {
      this.zoomBy(0.8);
    }
  }

  protected onKeyUp(e: KeyboardEvent): void {
    if (e.key === ' ') this.spaceDown = false;
  }
}
