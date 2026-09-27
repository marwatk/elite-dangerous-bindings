import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { filter } from 'rxjs';
import { CatalogService } from '../../../core/data/catalog.service';
import { ControlKind } from '../../../core/data/catalog.types';
import { kindForKey, parseButtonMap } from '../../../core/devices/device-files';
import { InputService } from '../../../core/input/input.service';
import { DraftGroup, partFor, partLabel } from './draft';
import { EditorStore } from './editor-store';
import { openGroupDialog } from './group-dialog';
import { ControlSpec, controlsFromCounts, specForKey } from './inventory';
import { MarkerIcon } from './marker-icon';

@Component({
  selector: 'app-step-inventory',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatButtonToggleModule, MatIconModule, MatSlideToggleModule, MatTooltipModule, MarkerIcon],
  styleUrls: ['./step-common.scss'],
  styles: `
    .counts input {
      width: 64px;
    }
    .counts label {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .list {
      margin-top: 16px;
    }
    .list-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .table-wrap {
      max-height: 60vh;
      overflow: auto;
    }
    td.key {
      white-space: nowrap;
    }
    select.dense-field {
      width: auto;
    }
    tr.picked td {
      background: var(--edb-accent-soft);
    }
    /* Held or moved on the controller right now. */
    tr.live td {
      background: color-mix(in srgb, var(--edb-accent) 45%, transparent);
    }
    tr.live td:first-child {
      box-shadow: inset 4px 0 0 var(--edb-accent);
    }
    .groups {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 8px;
    }
    .group-chip {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 2px 4px 2px 10px;
      border: 1px solid var(--edb-border);
      border-radius: 18px;
      background: var(--mat-sys-surface-container-high);
      .markers {
        display: inline-flex;
        gap: 2px;
        color: var(--edb-muted);
      }
    }
    .in-group {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      white-space: nowrap;
    }
    .add-row {
      margin-top: 8px;
    }
    .add-row .dense-field {
      width: 180px;
    }
  `,
  template: `
    <p class="intro">
      List every button, axis and hat. Start from the connected controller, an existing definition or EDCD button map, or the
      generic template — then add or remove controls. With the controller connected, controls you press are added as you go.
    </p>

    @if (store.primaries().length > 1) {
      <div class="row">
        <span class="hint">Part:</span>
        <mat-button-toggle-group [value]="store.currentPart()" (change)="store.currentPart.set($event.value)" aria-label="Part">
          @for (p of store.primaries(); track p.uid) {
            <mat-button-toggle [value]="p.uid">{{ p.bindsId }}</mat-button-toggle>
          }
        </mat-button-toggle-group>
      </div>
    }
    @if (!store.currentPart()) {
      <p class="hint"><mat-icon inline>info</mat-icon> Add an Elite device ID in step 2 first.</p>
    } @else {
      <div class="cols">
        <div class="panel">
          <h2><mat-icon>stadia_controller</mat-icon>From the controller</h2>
          @if (store.liveDevice(); as live) {
            <p>{{ live.name }}: {{ live.buttons }} buttons, {{ live.axes }} axes, {{ live.hats }} hats.</p>
            <button matButton="filled" type="button" (click)="fromCounts(live.buttons, live.axes, live.hats)">Add all</button>
          } @else {
            <p class="hint">Detect the controller in step 2 to read its buttons, axes and hats.</p>
          }
          <mat-slide-toggle [checked]="addAsPressed()" (change)="addAsPressed.set($event.checked)">Add controls as I press them</mat-slide-toggle>
          @if (lastPressed(); as lp) {
            <p class="hint">Last pressed: <span class="mono">{{ lp }}</span></p>
          }
        </div>

        <div class="panel">
          <h2><mat-icon>content_copy</mat-icon>From existing data</h2>
          @if (existing(); as ex) {
            <p>{{ ex.name }} already describes <span class="mono">{{ partBindsId() }}</span>.</p>
            <button matButton="filled" type="button" (click)="copyExisting(ex.id)">Copy its {{ ex.controlCount }} controls</button>
          }
          <div class="row">
            <button matButton="tonal" type="button" (click)="generic()">Generic template</button>
            <button matButton="tonal" type="button" (click)="mapInput.click()">Import .buttonMap…</button>
            <input #mapInput type="file" accept=".buttonMap,.xml" hidden (change)="importButtonMap($event)" />
          </div>
        </div>

        <div class="panel counts">
          <h2><mat-icon>calculate</mat-icon>By count</h2>
          <div class="row">
            <label>Buttons <input class="dense-field" type="number" min="0" max="128" [value]="nButtons()" (input)="nButtons.set(num($event))" /></label>
            <label>Axes <input class="dense-field" type="number" min="0" max="8" [value]="nAxes()" (input)="nAxes.set(num($event))" /></label>
            <label>Hats <input class="dense-field" type="number" min="0" max="4" [value]="nHats()" (input)="nHats.set(num($event))" /></label>
            <button matButton="tonal" type="button" (click)="fromCounts(nButtons(), nAxes(), nHats())" data-testid="add-counts">Add</button>
          </div>
          <p class="hint">Axes in browser order: X, Y, Z, RX, RY, RZ, U, V.</p>
        </div>
      </div>

      <div class="panel list">
        <div class="list-head">
          <h2>{{ controls().length }} controls{{ store.primaries().length > 1 ? ' on ' + partName() : '' }}</h2>
          <span class="spacer"></span>
          <button
            matButton="tonal"
            type="button"
            (click)="groupSelected()"
            [disabled]="picked().size < 2"
            matTooltip="Put the ticked controls in one box: a hat, rocker, encoder, ministick…"
            data-testid="group-selected"
          >
            <mat-icon>table_rows</mat-icon>Group…
          </button>
          <button matButton type="button" (click)="store.sortControls()"><mat-icon>sort</mat-icon>Sort</button>
          <button matButton type="button" (click)="clear()" [disabled]="!controls().length"><mat-icon>delete_sweep</mat-icon>Remove all</button>
        </div>
        @if (groups().length) {
          <div class="groups" aria-label="Groups">
            @for (g of groups(); track g.uid) {
              <div class="group-chip" [attr.data-group]="g.label">
                <mat-icon>{{ g.layout === 'row' ? 'view_column' : 'table_rows' }}</mat-icon>
                <strong>{{ g.label || 'Unnamed group' }}</strong>
                <span class="markers">
                  @for (m of g.members; track m.control) {
                    <app-marker-icon [marker]="m.marker" />
                  }
                </span>
                <button matButton type="button" (click)="editGroup(g.uid)" [attr.data-testid]="'edit-group-' + g.label"><mat-icon>edit</mat-icon>Edit</button>
                <button matIconButton type="button" (click)="store.ungroup(g.uid)" matTooltip="Ungroup" aria-label="Ungroup"><mat-icon>call_split</mat-icon></button>
              </div>
            }
          </div>
        }
        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr>
                <th><input type="checkbox" [checked]="allPicked()" (change)="pickAll($any($event.target).checked)" aria-label="Select all" /></th>
                <th>Elite key</th><th>Label</th><th>Kind</th><th>Box / group</th><th></th>
              </tr>
            </thead>
            <tbody>
              @for (c of controls(); track c.uid) {
                <tr [class.live]="liveKeys().has(c.key)" [class.picked]="picked().has(c.uid)" [attr.data-row-key]="c.key">
                  <td>
                    <input type="checkbox" [checked]="picked().has(c.uid)" (change)="pick(c.uid, $any($event.target).checked)" [attr.aria-label]="'Select ' + c.key" [attr.data-key]="c.key" />
                  </td>
                  <td class="key mono">{{ c.key }}</td>
                  <td>{{ c.label }}</td>
                  <td>
                    <select class="dense-field" [value]="c.kind" (change)="setKind(c.uid, $event)" aria-label="Kind">
                      <option value="button">button</option>
                      <option value="axis">axis</option>
                      <option value="hat">hat</option>
                    </select>
                  </td>
                  <td>
                    @if (groupOf().get(c.uid); as g) {
                      <span class="in-group">{{ g.group.label }} <app-marker-icon [marker]="g.marker" /></span>
                    } @else {
                      {{ c.box ? '✓' : '' }}
                    }
                  </td>
                  <td>
                    <button matIconButton type="button" (click)="store.removeControls([c.uid])" aria-label="Remove control" matTooltip="Remove">
                      <mat-icon>close</mat-icon>
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="row add-row">
          <input class="dense-field mono" placeholder="Joy_33, Joy_POV2Up…" [value]="newKey()" (input)="newKey.set(val($event))" (keydown.enter)="addKey()" aria-label="Elite key" data-testid="new-key" />
          <button matButton="tonal" type="button" (click)="addKey()" [disabled]="!validNewKey()">Add control</button>
        </div>
      </div>
    }
  `,
})
export class StepInventory {
  protected readonly store = inject(EditorStore);
  private readonly catalog = inject(CatalogService);
  private readonly input = inject(InputService);
  private readonly snack = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);

  protected readonly nButtons = signal(32);
  protected readonly nAxes = signal(8);
  protected readonly nHats = signal(1);
  protected readonly newKey = signal('');
  protected readonly addAsPressed = signal(true);
  protected readonly lastPressed = signal<string | null>(null);

  /** Keys on the current part that are held (buttons, hats) or moved (axes) right now. */
  protected readonly liveKeys = computed(() => {
    const d = this.store.draft();
    const part = this.store.currentPart();
    const keys = new Set<string>();
    const add = (device: string, index: number, key: string) => {
      if (partFor(d, device, index) === part) keys.add(key.replace(/^(Pos|Neg)_/, ''));
    };
    for (const r of this.input.held()) add(r.device, r.deviceIndex ?? 0, r.key);
    for (const id of this.input.movedAxes()) {
      const [device, index, key] = id.split('::');
      add(device, Number(index) || 0, key);
    }
    return keys;
  });

  protected readonly controls = computed(() => this.store.draft().controls.filter((c) => c.part === this.store.currentPart()));
  /** Controls ticked for grouping. */
  protected readonly picked = signal<ReadonlySet<string>>(new Set());
  protected readonly allPicked = computed(() => this.controls().length > 0 && this.controls().every((c) => this.picked().has(c.uid)));
  protected readonly groups = computed(() => (this.store.draft().groups ?? []).filter((g) => g.part === this.store.currentPart()));
  protected readonly groupOf = computed(() => {
    const m = new Map<string, { group: DraftGroup; marker: string }>();
    for (const g of this.store.draft().groups ?? []) for (const x of g.members) m.set(x.control, { group: g, marker: x.marker });
    return m;
  });
  protected readonly partName = computed(() => partLabel(this.store.draft(), this.store.currentPart() ?? ''));
  protected readonly partBindsId = computed(() => this.store.draft().ids.find((i) => i.uid === this.store.currentPart())?.bindsId ?? '');
  protected readonly existing = computed(() => {
    const id = this.store.draft().ids.find((i) => i.uid === this.store.currentPart());
    if (!id) return null;
    const s = this.catalog.deviceFor(id.bindsId, id.deviceIndex ?? 0);
    return s && s.id !== this.store.draft().baseId ? s : null;
  });
  protected readonly validNewKey = computed(() => /^[A-Za-z][A-Za-z0-9_]*$/.test(this.newKey().trim()));

  constructor() {
    const sub = this.input.events.pipe(filter((e) => e.pressed && e.kind !== 'key')).subscribe((e) => {
      const key = e.ref.key.replace(/^(Pos|Neg)_/, '');
      const part = partFor(this.store.draft(), e.ref.device, e.ref.deviceIndex ?? 0);
      if (!part) return;
      this.lastPressed.set(key);
      if (this.addAsPressed()) this.store.addControls([specForKey(key)], part);
      // Show the part the control belongs to, then bring its row into view and flash it.
      if (part !== this.store.currentPart()) this.store.currentPart.set(part);
      setTimeout(() => this.flashRow(key));
    });
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
  }

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Scroll a control's row into view and flash it (restarts on every press). */
  private flashRow(key: string): void {
    const row = this.host.nativeElement.querySelector<HTMLTableRowElement>(`tr[data-row-key="${CSS.escape(key)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const accent = getComputedStyle(row).getPropertyValue('--edb-accent').trim() || '#ff8c0d';
    for (const cell of Array.from(row.cells)) {
      cell.animate(
        [{ backgroundColor: accent }, { backgroundColor: 'transparent' }],
        { duration: reduce ? 1 : 1200, easing: 'ease-out' },
      );
    }
  }

  protected pick(uid: string, on: boolean): void {
    this.picked.update((s) => {
      const out = new Set(s);
      if (on) out.add(uid);
      else out.delete(uid);
      return out;
    });
  }

  protected pickAll(on: boolean): void {
    this.picked.set(on ? new Set(this.controls().map((c) => c.uid)) : new Set());
  }

  protected async groupSelected(): Promise<void> {
    // In list order.
    const uids = this.controls().filter((c) => this.picked().has(c.uid)).map((c) => c.uid);
    if (uids.length < 2) return;
    if (await openGroupDialog(this.dialog, this.store, { uids })) this.picked.set(new Set());
  }

  protected editGroup(uid: string): void {
    void openGroupDialog(this.dialog, this.store, { group: uid });
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected num(e: Event): number {
    return Math.max(0, Math.floor(Number((e.target as HTMLInputElement).value) || 0));
  }

  private report(r: { added: number; relabelled?: number }): void {
    const parts = [`Added ${r.added} control${r.added === 1 ? '' : 's'}`];
    if (r.relabelled) parts.push(`relabelled ${r.relabelled}`);
    this.snack.open(parts.join(', ') + '.', undefined, { duration: 2500 });
  }

  protected fromCounts(b: number, a: number, h: number): void {
    this.report(this.store.addControls(controlsFromCounts(b, a, h)));
  }

  protected generic(): void {
    const specs = this.catalog
      .genericControls()
      .filter((g) => !/^(Pos|Neg)_/.test(g.key))
      .map((g): ControlSpec => ({ key: g.key, label: g.label.replace(/^Stick /, ''), kind: g.kind }));
    this.report(this.store.addControls(specs));
  }

  protected async copyExisting(id: string): Promise<void> {
    const def = await this.catalog.loadDevice(id);
    const bindsId = this.partBindsId();
    const seen = new Set<string>();
    const specs = def.controls
      .filter((c) => c.bindsId === bindsId && !seen.has(c.key) && (seen.add(c.key), true))
      .map((c): ControlSpec => ({ key: c.key, label: c.label, kind: c.kind }));
    this.report(this.store.addControls(specs, undefined, true));
  }

  protected async importButtonMap(e: Event): Promise<void> {
    const el = e.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    try {
      const map = parseButtonMap(await file.text());
      const specs = map.labels.map((l): ControlSpec => ({ key: l.key, label: l.label, kind: kindForKey(l.key) }));
      this.report(this.store.addControls(specs, undefined, true));
      if (map.name && !this.store.draft().name.trim()) this.store.setName(map.name);
    } catch (err) {
      this.snack.open((err as Error).message, 'OK', { duration: 6000 });
    }
  }

  protected addKey(): void {
    if (!this.validNewKey()) return;
    const r = this.store.addControls([specForKey(this.newKey().trim())]);
    if (!r.added) this.snack.open('That control is already listed.', undefined, { duration: 2500 });
    this.newKey.set('');
  }

  protected setKind(uid: string, e: Event): void {
    this.store.updateControl(uid, { kind: (e.target as HTMLSelectElement).value as ControlKind });
  }

  protected clear(): void {
    if (!confirm(`Remove all ${this.controls().length} controls (and their boxes)?`)) return;
    this.store.removeControls(this.controls().map((c) => c.uid));
  }
}
