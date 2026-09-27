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
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { filter } from 'rxjs';
import { Box, ImagePoint } from '../../../core/data/catalog.types';
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
import { insertElbow, leaderPath, pathData, removeLeaderPoint, roundPoint, withAnchor } from '../../../core/devices/leader';
import { InputService } from '../../../core/input/input.service';
import { canvasOutputSize, canvasPaddingFor, contentOn } from './canvas';
import { BACKGROUND_SWATCHES, BackgroundSetting, canvasRect, contentExtent, hasPadding, unionRect, workspaceRect } from './canvas-padding';
import { groupDividers, groupLayout } from '../../../core/devices/group-layout';
import { markerSymbol, markerTransform } from '../../../core/devices/markers';
import { DraftControl, PlaceItem, partFor, partLabel } from './draft';
import { openGroupDialog } from './group-dialog';
import { memberName } from './groups';
import { MarkerIcon } from './marker-icon';
import { EditorStore } from './editor-store';
import { specForKey } from './inventory';

type Gesture =
  | { kind: 'pan'; x: number; y: number; sl: number; st: number }
  | { kind: 'draw'; start: Point; uid: string; targets: SnapLines }
  | { kind: 'move'; start: Point; boxes: Map<string, Box>; primary: string; moved: boolean; targets: SnapLines }
  | { kind: 'resize'; start: Point; uid: string; box: Box; handle: Handle; moved: boolean; targets: SnapLines }
  | { kind: 'leader'; start: Point; uid: string; index: number; orig: ImagePoint[]; moved: boolean };

type Placed = PlaceItem & { box: Box };

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;

@Component({
  selector: 'app-step-place',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatButtonToggleModule, MatDividerModule, MatIconModule, MatMenuModule, MatSlideToggleModule, MatTooltipModule, MarkerIcon],
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
  private readonly dialog = inject(MatDialog);

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
  /** "Draw line": the next click on the image sets the selected box's leader anchor. */
  protected readonly lineMode = signal(false);
  /** Selected leader point (elbow or anchor) of the line being edited. */
  protected readonly selPoint = signal<{ uid: string; index: number } | null>(null);
  /** The canvas popover (background, margin, 16:9) is open. */
  protected readonly canvasOpen = signal(false);
  protected readonly swatches = BACKGROUND_SWATCHES;
  /** Workspace kept still while a gesture runs (it grows afterwards). */
  private readonly frozenView = signal<Box | null>(null);
  private gesture: Gesture | null = null;
  private spaceDown = false;

  protected readonly image = computed(() => this.store.draft().images[this.store.imageIndex()] ?? null);
  protected readonly imageUrl = computed(() => this.store.urlFor(this.image()?.blob));
  /** Space the exported image adds around the photo to hold boxes beside it. */
  protected readonly canvasPad = computed(() => canvasPaddingFor(this.store.draft(), this.store.imageIndex()));
  /** The exported image's area, in image pixels (the photo is at 0,0). */
  protected readonly canvasBounds = computed(() => {
    const img = this.image();
    return img ? canvasRect(img, this.canvasPad()) : null;
  });
  protected readonly canvasGrows = computed(() => hasPadding(this.canvasPad()));
  protected readonly outputSize = computed(() => (this.image() ? canvasOutputSize(this.store.draft(), this.store.imageIndex()) : null));
  /** Workspace: the photo, everything drawn and the canvas, with room to draw into on every side. */
  private readonly liveView = computed<Box | null>(() => {
    const img = this.image();
    if (!img) return null;
    const { boxes, points } = contentOn(this.store.draft(), this.store.imageIndex());
    return workspaceRect(img, unionRect(contentExtent(img, boxes, points), this.canvasBounds()!));
  });
  protected readonly view = computed(() => this.frozenView() ?? this.liveView());
  protected readonly viewBox = computed(() => {
    const v = this.view();
    return v ? `${v.x} ${v.y} ${v.w} ${v.h}` : '0 0 1 1';
  });
  protected readonly detected = computed(() => {
    const img = this.image();
    return img ? (this.store.detected().get(img.uid) ?? null) : null;
  });
  /** Fill of the area around the photo, as the exported image will have it. */
  protected readonly backdrop = computed(() => {
    const bg = this.store.canvas().background;
    if (bg.kind === 'color') return bg.color;
    if (bg.kind === 'auto' && this.detected()?.color) return this.detected()!.color!;
    return bg.kind === 'auto' && !this.detected() ? '#ffffff' : 'url(#edb-checker)';
  });
  /** Everything in the workspace outside the exported canvas (shaded). */
  protected readonly outsidePath = computed(() => {
    const v = this.view();
    const c = this.canvasBounds();
    if (!v || !c) return '';
    return `M${v.x} ${v.y}H${v.x + v.w}V${v.y + v.h}H${v.x}Z M${c.x} ${c.y}V${c.y + c.h}H${c.x + c.w}V${c.y}Z`;
  });
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
  /** Box whose leader line is edited: the one selected box, else the active control's box on this image. */
  protected readonly lineTarget = computed<Placed | null>(() => {
    const hb = this.handleBox();
    if (hb) return hb;
    const uid = this.store.activeUid();
    return (uid && this.boxes().find((b) => b.uid === uid)) || null;
  });
  /** Leader lines on this image, drawn under the boxes. */
  protected readonly leaders = computed(() =>
    this.boxes()
      .filter((b) => b.leader?.length)
      .map((b) => ({ uid: b.uid, d: pathData(leaderPath(b.box, b.leader)), anchor: b.leader!.at(-1)! })),
  );
  /** Points of the edited line: start on the box edge, elbows, anchor. */
  protected readonly targetPath = computed(() => {
    const t = this.lineTarget();
    return t ? leaderPath(t.box, t.leader) : [];
  });
  protected readonly targetPathD = computed(() => pathData(this.targetPath()));
  /** Groups on this image drawn subdivided: label column, markers, member names. */
  protected readonly groupShapes = computed(() => {
    const d = this.store.draft();
    const out = new Map<string, ReturnType<typeof this.groupShape>>();
    for (const b of this.boxes()) if (b.group) out.set(b.uid, this.groupShape(d.controls, b));
    return out;
  });
  protected readonly selectedPlaced = computed(() => this.boxes().filter((b) => this.store.selected().has(b.uid)));
  protected readonly stroke = computed(() => 2 / this.zoom());
  protected readonly handleSize = computed(() => 10 / this.zoom());
  protected readonly dotRadius = computed(() => 3.5 / this.zoom());
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

    // When the workspace grows or shrinks on the left/top, scroll so the photo stays put.
    let prev: { uid: string; x: number; y: number } | null = null;
    effect(() => {
      const v = this.view();
      const img = this.image();
      if (!v || !img) return;
      const last = prev;
      prev = { uid: img.uid, x: v.x, y: v.y };
      if (!last || last.uid !== img.uid || (last.x === v.x && last.y === v.y)) return;
      const z = untracked(this.zoom);
      afterNextRender(
        {
          write: () => {
            const vp = this.viewport()?.nativeElement;
            if (!vp) return;
            vp.scrollLeft += (last.x - v.x) * z;
            vp.scrollTop += (last.y - v.y) * z;
          },
        },
        { injector: this.injector },
      );
    });
    // Background colour of the photo, for the area around it.
    effect(() => {
      const img = this.image();
      if (img) void this.store.detectFor(img);
    });

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

  /** Zoom to the exported canvas plus some of the room around it, centred. */
  protected fit(): void {
    const vp = this.viewport()?.nativeElement;
    const img = this.image();
    const c = this.canvasBounds();
    const v = this.view();
    if (!vp || !img || !c || !v) return;
    const target = { x: c.x - img.width * 0.2, y: c.y - img.height * 0.2, w: c.w + img.width * 0.4, h: c.h + img.height * 0.4 };
    // The viewport's height follows its content up to max-height, so fit to that.
    const maxH = parseFloat(getComputedStyle(vp).maxHeight) || vp.clientHeight;
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((vp.clientWidth - 4) / target.w, (maxH - 4) / target.h)));
    this.zoom.set(z);
    afterNextRender(
      {
        write: () => {
          vp.scrollLeft = (target.x + target.w / 2 - v.x) * z - vp.clientWidth / 2;
          vp.scrollTop = (target.y + target.h / 2 - v.y) * z - vp.clientHeight / 2;
        },
      },
      { injector: this.injector },
    );
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
    this.frozenView.set(this.view());
    const p = this.toImage(e);
    const t = e.target as Element;
    const lt = this.lineTarget();
    this.selPoint.set(null);
    // Leader line: drag its anchor or an elbow.
    const pointAttr = t.closest('[data-leader-point]')?.getAttribute('data-leader-point');
    if (pointAttr != null && lt?.leader) {
      const index = Number(pointAttr);
      this.selPoint.set({ uid: lt.uid, index });
      this.gesture = { kind: 'leader', start: p, uid: lt.uid, index, orig: lt.leader.map((q) => ({ ...q })), moved: false };
      return;
    }
    // "Draw line" mode or Alt-click: set the anchor.
    if ((this.lineMode() || e.altKey) && lt) {
      this.setAnchor(lt, p);
      return;
    }
    this.lineMode.set(false);
    const handle = t.closest('[data-handle]')?.getAttribute('data-handle') as Handle | undefined;
    const hb = this.handleBox();
    if (handle && hb) {
      this.gesture = { kind: 'resize', start: p, uid: hb.uid, box: { ...hb.box }, handle, moved: false, targets: this.targets(new Set([hb.uid])) };
      return;
    }
    // Click on the line: add an elbow there and drag it.
    if (t.closest('[data-leader-seg]') && lt?.leader) {
      this.store.checkpoint();
      const { leader, index } = insertElbow(this.targetPath(), lt.leader, roundPoint(p));
      this.store.setLeader(lt.uid, leader, { undo: false });
      this.selPoint.set({ uid: lt.uid, index });
      this.gesture = { kind: 'leader', start: p, uid: lt.uid, index, orig: leader, moved: true };
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
    if (g.kind === 'leader') {
      if (!g.moved) {
        if (Math.hypot(dx, dy) * this.zoom() < 3) return;
        g.moved = true;
        this.store.checkpoint();
      }
      const next = g.orig.map((q, i) => (i === g.index ? this.clampToView({ x: q.x + dx, y: q.y + dy }) : q));
      this.store.setLeader(g.uid, next, { undo: false });
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
    this.frozenView.set(null);
    if (!g) return;
    if (g.kind === 'draw') {
      const r = this.drawRect();
      const c = this.store.draft().controls.find((x) => x.uid === g.uid);
      if (r && r.w * this.zoom() >= 6 && r.h * this.zoom() >= 6) this.finishDraw(g.uid, r);
      else if (c && !c.box) this.finishDraw(g.uid, this.defaultBoxAt(g.start));
      else this.store.selected.set(new Set());
    } else if (g.kind === 'leader' && g.moved) {
      const c = this.store.draft().controls.find((x) => x.uid === g.uid);
      if (c?.leader) this.store.setLeader(g.uid, c.leader.map(roundPoint), { undo: false });
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

  // ------------------------------------------------------------ leader lines

  private clampToView(p: Point): Point {
    const v = this.view()!;
    return { x: Math.min(v.x + v.w, Math.max(v.x, p.x)), y: Math.min(v.y + v.h, Math.max(v.y, p.y)) };
  }

  private setAnchor(target: Placed, p: Point): void {
    const anchor = roundPoint(this.clampToView(p));
    this.store.setLeader(target.uid, withAnchor(target.leader, anchor));
    this.store.selected.set(new Set([target.uid]));
    this.lineMode.set(false);
  }

  protected selectOnly(uid: string): ReadonlySet<string> {
    return new Set([uid]);
  }

  protected toggleLineMode(): void {
    this.lineMode.set(!this.lineMode() && !!this.lineTarget());
  }

  protected removeLine(uid: string): void {
    this.store.setLeader(uid, null);
    this.selPoint.set(null);
    this.lineMode.set(false);
  }

  private deleteSelectedPoint(): boolean {
    const sp = this.selPoint();
    const lt = this.lineTarget();
    if (!sp || !lt?.leader || lt.uid !== sp.uid || sp.index >= lt.leader.length) return false;
    this.store.setLeader(lt.uid, removeLeaderPoint(lt.leader, sp.index) ?? null);
    this.selPoint.set(null);
    return true;
  }

  // ------------------------------------------------------------ canvas

  protected setBackground(kind: BackgroundSetting['kind'], color?: string): void {
    const cur = this.store.canvas().background;
    const bg: BackgroundSetting =
      kind === 'color' ? { kind, color: (color ?? (cur.kind === 'color' ? cur.color : this.detected()?.color) ?? '#ffffff').toLowerCase() } : { kind };
    this.store.setCanvas({ background: bg }, color && cur.kind === 'color' ? 'canvas-colour' : undefined);
  }

  protected pickedColour(): string {
    const bg = this.store.canvas().background;
    return bg.kind === 'color' ? bg.color : (this.detected()?.color ?? '#ffffff');
  }

  protected setMargin(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    if (Number.isFinite(v) && v >= 0) this.store.setCanvas({ margin: Math.round(v) }, 'canvas-margin');
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
    const label = (e.target as HTMLInputElement).value;
    if (this.store.draft().groups?.some((g) => g.uid === uid)) this.store.updateGroup(uid, { label }, `label:${uid}`);
    else this.store.updateControl(uid, { label }, `label:${uid}`);
  }

  protected editGroup(uid: string): void {
    void openGroupDialog(this.dialog, this.store, { group: uid });
  }

  private groupShape(controls: DraftControl[], b: Placed) {
    const g = b.group!;
    const members = g.members.map((m) => ({ key: controls.find((c) => c.uid === m.control)?.key ?? '', marker: m.marker, control: m.control }));
    const geo = groupLayout({ box: b.box, layout: g.layout, showLabel: g.showLabel, members });
    const l = geo.labelRect;
    return {
      labelRect: l,
      labelSize: l ? Math.min(l.w * 0.62, (l.h * 0.9) / Math.max(1, b.label.length * 0.6)) : 0,
      dividers: groupDividers(geo, g.layout),
      members: geo.members.map((cell) => {
        const c = controls.find((x) => x.uid === members[cell.index].control);
        const symbol = markerSymbol(cell.marker);
        const name = c && c.label !== memberName(g.label, cell.marker) ? c.label : (c?.key ?? '');
        return { ...cell, symbol, transform: symbol ? markerTransform(cell.markerRect, 0.62) : '', name };
      }),
    };
  }

  protected setBoxField(uid: string, field: keyof Box, e: Event): void {
    const d = this.store.draft();
    const c = d.controls.find((x) => x.uid === uid) ?? d.groups?.find((x) => x.uid === uid);
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
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && this.selPoint()) {
      e.preventDefault();
      this.deleteSelectedPoint();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && (sel.length || this.store.activeControl()?.box)) {
      e.preventDefault();
      this.deleteSelected();
    } else if (e.key === 'Escape' && this.canvasOpen()) {
      this.canvasOpen.set(false);
    } else if (e.key === 'Escape' && (this.lineMode() || this.selPoint())) {
      this.lineMode.set(false);
      this.selPoint.set(null);
    } else if (e.key === 'l' || e.key === 'L') {
      this.toggleLineMode();
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
