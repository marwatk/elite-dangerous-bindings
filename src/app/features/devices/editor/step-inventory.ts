import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { filter } from 'rxjs';
import { CatalogService } from '../../../core/data/catalog.service';
import { ControlKind } from '../../../core/data/catalog.types';
import { kindForKey, parseButtonMap } from '../../../core/devices/device-files';
import { InputService } from '../../../core/input/input.service';
import { partFor, partLabel } from './draft';
import { EditorStore } from './editor-store';
import { ControlSpec, controlsFromCounts, specForKey } from './inventory';

@Component({
  selector: 'app-step-inventory',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatButtonToggleModule, MatIconModule, MatSlideToggleModule, MatTooltipModule],
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
    tr.flash td {
      background: var(--edb-accent-soft);
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
          <button matButton type="button" (click)="store.sortControls()"><mat-icon>sort</mat-icon>Sort</button>
          <button matButton type="button" (click)="clear()" [disabled]="!controls().length"><mat-icon>delete_sweep</mat-icon>Remove all</button>
        </div>
        <div class="table-wrap">
          <table class="grid">
            <thead>
              <tr><th>Elite key</th><th>Label</th><th>Kind</th><th>Box</th><th></th></tr>
            </thead>
            <tbody>
              @for (c of controls(); track c.uid) {
                <tr [class.flash]="c.key === lastPressed()">
                  <td class="key mono">{{ c.key }}</td>
                  <td>{{ c.label }}</td>
                  <td>
                    <select class="dense-field" [value]="c.kind" (change)="setKind(c.uid, $event)" aria-label="Kind">
                      <option value="button">button</option>
                      <option value="axis">axis</option>
                      <option value="hat">hat</option>
                    </select>
                  </td>
                  <td>{{ c.box ? '✓' : '' }}</td>
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

  protected readonly nButtons = signal(32);
  protected readonly nAxes = signal(8);
  protected readonly nHats = signal(1);
  protected readonly newKey = signal('');
  protected readonly addAsPressed = signal(true);
  protected readonly lastPressed = signal<string | null>(null);

  protected readonly controls = computed(() => this.store.draft().controls.filter((c) => c.part === this.store.currentPart()));
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
    });
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
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
