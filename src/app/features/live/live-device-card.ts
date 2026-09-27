import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { InputRef } from '../../core/binds/binds-document';
import { CatalogService } from '../../core/data/catalog.service';
import { InputService } from '../../core/input/input.service';
import { LiveDevice } from '../../core/input/input.types';
import { BindingsStore } from '../../core/state/bindings-store.service';
import { DeviceDiagram, controlKey } from '../../shared/device-diagram';

const AXIS_ORDER = [
  'Joy_XAxis',
  'Joy_YAxis',
  'Joy_ZAxis',
  'Joy_RXAxis',
  'Joy_RYAxis',
  'Joy_RZAxis',
  'Joy_UAxis',
  'Joy_VAxis',
  'GamePad_LStickX',
  'GamePad_LStickY',
  'GamePad_RStickX',
  'GamePad_RStickY',
  'GamePad_LTrigger',
  'GamePad_RTrigger',
];

@Component({
  selector: 'app-live-device-card',
  imports: [MatCardModule, MatFormFieldModule, MatSelectModule, MatIconModule, MatTooltipModule, DeviceDiagram],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let d = device();
    <mat-card appearance="outlined" class="card" [class.off]="!d.connected" [attr.data-device]="d.id">
      <div class="head">
        <div class="title">
          <h3>{{ d.name }}</h3>
          <div class="meta">
            <span class="badge" [class.hid]="d.backend === 'webhid'">{{ d.backend === 'webhid' ? 'WebHID' : 'Gamepad API' }}</span>
            @if (d.usb; as u) {
              <code>{{ u.vid }}:{{ u.pid }}</code>
            }
            @if (!d.connected) {
              <span class="badge warn">disconnected</span>
            }
            <span class="muted">{{ d.buttons }} buttons · {{ d.axes }} axes · {{ d.hats }} hats</span>
          </div>
        </div>
      </div>

      <div class="ids">
        <mat-form-field subscriptSizing="dynamic" class="id-field">
          <mat-label>Elite device ID</mat-label>
          <mat-select [value]="d.bindsId" (selectionChange)="setId($event.value, d.deviceIndex)" aria-label="Elite device ID">
            <mat-select-trigger><code>{{ d.bindsId }}</code></mat-select-trigger>
            @for (c of idOptions(); track c.id) {
              <mat-option [value]="c.id">
                <code>{{ c.id }}</code>
                @if (c.note) {
                  <span class="muted"> · {{ c.note }}</span>
                }
              </mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field subscriptSizing="dynamic" class="idx-field">
          <mat-label>DeviceIndex</mat-label>
          <mat-select [value]="d.deviceIndex" (selectionChange)="setId(d.bindsId, $event.value)" aria-label="DeviceIndex">
            @for (i of [0, 1, 2, 3]; track i) {
              <mat-option [value]="i">{{ i }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <div class="def">
          @if (summary(); as s) {
            <mat-icon inline>check_circle</mat-icon> {{ s.name }}
          } @else {
            <span class="muted"><mat-icon inline>help</mat-icon> No device definition for this ID</span>
          }
          @if (usedInFile()) {
            <span class="badge ok" matTooltip="The open file has bindings for this device ID">in file</span>
          }
          @if (input.hasBindsIdOverride(d.id)) {
            <button class="linkish" type="button" (click)="input.resetBindsId(d.id)">automatic</button>
          }
        </div>
      </div>

      @for (n of d.notes ?? []; track n) {
        <p class="note"><mat-icon inline>info</mat-icon> {{ n }}</p>
      }
      @if (correction(); as c) {
        <p class="note">
          <mat-icon inline>tune</mat-icon> Numbering correction active:
          @if (c.buttonOffset) {
            buttons {{ c.buttonOffset > 0 ? '+' : '' }}{{ c.buttonOffset }}
          }
          @for (m of axisMapText(); track m) {
            <code>{{ m }}</code>
          }
          @if (input.userCorrections()[d.bindsId]) {
            <button class="linkish" type="button" (click)="input.setCorrection(d.bindsId, null)">remove</button>
          }
        </p>
      }

      <div class="body">
        @if (def(); as def) {
          <div class="diagrams">
            @for (i of imageIndexes(); track i) {
              <app-device-diagram [device]="def" [imageIndex]="i" [highlight]="highlight()" [showText]="true" />
            }
          </div>
        }
        <div class="state">
          <div class="pressed" aria-live="polite">
            <div class="label muted">Pressed</div>
            @for (h of held(); track h.key) {
              <span class="kbd on" [attr.title]="h.key">{{ h.label }} <small>{{ h.key }}</small></span>
            } @empty {
              <span class="muted">Press a button or move a hat…</span>
            }
          </div>
          <div class="axes">
            @for (a of axes(); track a.key) {
              <div class="axis" [class.moved]="a.moved">
                <span class="axis-name" [attr.title]="a.key">{{ a.label }}</span>
                <span class="bar" role="meter" [attr.aria-label]="a.key" aria-valuemin="-1" aria-valuemax="1" [attr.aria-valuenow]="a.value">
                  <span class="fill" [style.left.%]="a.left" [style.width.%]="a.width"></span>
                  <span class="zero"></span>
                </span>
                <code class="val">{{ a.value.toFixed(2) }}</code>
              </div>
            } @empty {
              @if (d.connected) {
                <span class="muted">No axis data yet: move a control.</span>
              }
            }
          </div>
        </div>
      </div>
    </mat-card>
  `,
  styles: `
    .card {
      padding: 12px 16px 16px;
    }
    .card.off {
      opacity: 0.6;
    }
    h3 {
      margin: 0 0 4px;
      font-size: 1.1rem;
      overflow-wrap: anywhere;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 10px;
      align-items: center;
      font-size: 0.85rem;
    }
    .badge {
      display: inline-block;
      padding: 1px 8px;
      border-radius: 10px;
      font-size: 0.75rem;
      background: var(--mat-sys-surface-container-highest);
      border: 1px solid var(--edb-border);
    }
    .badge.hid {
      background: var(--edb-accent-soft);
      border-color: var(--edb-accent);
    }
    .badge.warn {
      border-color: var(--edb-warning);
      color: var(--edb-warning);
    }
    .badge.ok {
      border-color: var(--edb-ok);
      color: var(--edb-ok);
    }
    .ids {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 12px;
      align-items: center;
      margin: 12px 0 4px;
    }
    .id-field {
      flex: 1 1 200px;
      max-width: 300px;
    }
    .idx-field {
      width: 120px;
    }
    .def {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
      font-size: 0.9rem;
    }
    .def mat-icon {
      color: var(--edb-ok);
    }
    .def .muted mat-icon {
      color: inherit;
    }
    .note {
      margin: 6px 0;
      font-size: 0.85rem;
      color: var(--edb-muted);
    }
    .linkish {
      background: none;
      border: none;
      padding: 0 4px;
      color: var(--edb-accent);
      cursor: pointer;
      text-decoration: underline;
      font: inherit;
    }
    .body {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 12px;
      margin-top: 8px;
    }
    @media (min-width: 900px) {
      .body:has(.diagrams) {
        grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
      }
    }
    .diagrams {
      display: grid;
      gap: 8px;
    }
    .label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
    }
    .pressed {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
      min-height: 32px;
      margin-bottom: 12px;
    }
    .pressed .label {
      flex-basis: 100%;
    }
    .kbd.on {
      background: var(--edb-accent);
      color: #111;
      border-color: var(--edb-accent);
    }
    .kbd small {
      opacity: 0.7;
    }
    .axes {
      display: grid;
      gap: 6px;
    }
    .axis {
      display: grid;
      grid-template-columns: minmax(70px, 30%) 1fr 48px;
      gap: 8px;
      align-items: center;
      font-size: 0.85rem;
    }
    .axis-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .axis.moved .axis-name {
      color: var(--edb-accent);
      font-weight: 600;
    }
    .bar {
      position: relative;
      height: 10px;
      border-radius: 5px;
      background: var(--mat-sys-surface-container-highest);
      overflow: hidden;
    }
    .fill {
      position: absolute;
      top: 0;
      bottom: 0;
      background: var(--edb-accent);
    }
    .zero {
      position: absolute;
      left: 50%;
      top: 0;
      bottom: 0;
      width: 1px;
      background: var(--edb-border);
    }
    .val {
      text-align: right;
    }
  `,
})
export class LiveDeviceCard {
  protected readonly input = inject(InputService);
  private readonly catalog = inject(CatalogService);
  private readonly store = inject(BindingsStore);

  readonly device = input.required<LiveDevice>();

  protected readonly summary = computed(() => {
    this.catalog.devices();
    const d = this.device();
    return this.catalog.deviceFor(d.bindsId, d.deviceIndex);
  });

  protected readonly def = computed(() => {
    const s = this.summary();
    if (!s || !s.images.length) return null;
    return this.catalog.definitions().get(s.id) ?? this.catalog.localDevice(s.id)?.definition ?? null;
  });

  /** Images that show this Elite ID's controls (a definition can cover a stick and a throttle). */
  protected readonly imageIndexes = computed(() => {
    const def = this.def();
    if (!def) return [];
    const id = this.device().bindsId;
    const idx = new Set(def.controls.filter((c) => c.bindsId === id && c.box).map((c) => c.image ?? 0));
    for (const g of def.groups ?? []) if (g.members.some((m) => m.bindsId === id)) idx.add(g.image ?? 0);
    return idx.size ? [...idx].sort() : def.images.map((_, i) => i);
  });

  protected readonly usedInFile = computed(() => {
    const d = this.device();
    return this.store.devicesUsed().some((u) => u.device === d.bindsId && u.deviceIndex === d.deviceIndex);
  });

  protected readonly idOptions = computed(() => {
    const d = this.device();
    const used = this.store.devicesUsed().map((u) => u.device);
    const ids = [...new Set([d.bindsId, ...d.candidates, ...used])].filter((x) => x && x !== 'Keyboard' && x !== 'Mouse');
    return ids.map((id) => {
      const notes: string[] = [];
      if (d.candidates.includes(id)) notes.push(/^[0-9A-F]{8}$/i.test(id) ? 'USB ID' : 'named ID');
      if (used.includes(id)) notes.push('in file');
      return { id, note: notes.join(', ') };
    });
  });

  protected readonly correction = computed(() => {
    this.input.userCorrections();
    this.input.devices();
    const c = this.input.correctionFor(this.device().bindsId);
    return c && (c.buttonOffset || (c.axisMap && Object.keys(c.axisMap).length)) ? c : null;
  });

  protected readonly axisMapText = computed(() =>
    Object.entries(this.correction()?.axisMap ?? {}).map(([k, v]) => `${k} → ${v}`),
  );

  private prefix(): string {
    const d = this.device();
    return `${d.bindsId}::${d.deviceIndex}::`;
  }

  private mine(ref: InputRef): boolean {
    const d = this.device();
    return ref.device === d.bindsId && (ref.deviceIndex ?? 0) === d.deviceIndex;
  }

  protected readonly held = computed(() =>
    this.input
      .held()
      .filter((r) => this.mine(r))
      .map((r) => ({ key: r.key, label: this.catalog.controlLabel(r) })),
  );

  protected readonly axes = computed(() => {
    const p = this.prefix();
    const moved = this.input.movedAxes();
    const d = this.device();
    const out: { key: string; label: string; value: number; left: number; width: number; moved: boolean }[] = [];
    for (const [id, value] of this.input.axisValues()) {
      if (!id.startsWith(p)) continue;
      const key = id.slice(p.length);
      const lo = Math.min(0, value);
      const hi = Math.max(0, value);
      out.push({
        key,
        label: this.catalog.controlLabel({ device: d.bindsId, deviceIndex: d.deviceIndex, key }),
        value,
        left: ((lo + 1) / 2) * 100,
        width: ((hi - lo) / 2) * 100,
        moved: moved.has(id),
      });
    }
    const rank = (k: string) => {
      const i = AXIS_ORDER.indexOf(k);
      return i < 0 ? 99 : i;
    };
    return out.sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
  });

  protected readonly highlight = computed(() => {
    const d = this.device();
    const set = new Set<string>();
    for (const r of this.input.held()) if (this.mine(r)) set.add(controlKey(d.bindsId, r.key));
    const p = this.prefix();
    for (const id of this.input.movedAxes()) if (id.startsWith(p)) set.add(controlKey(d.bindsId, id.slice(p.length)));
    return set;
  });

  constructor() {
    effect(() => {
      const s = this.summary();
      if (s && s.images.length) void this.catalog.loadDevice(s.id).catch(() => undefined);
    });
  }

  protected setId(bindsId: string, deviceIndex: number): void {
    this.input.setBindsId(this.device().id, bindsId, deviceIndex);
  }
}
