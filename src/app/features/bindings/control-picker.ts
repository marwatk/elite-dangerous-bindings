import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { InputRef } from '../../core/binds/binds-document';
import { BUILTIN_DEVICES, CatalogService } from '../../core/data/catalog.service';
import { InputService } from '../../core/input/input.service';
import { BindingsStore } from '../../core/state/bindings-store.service';
import { ActionTraits, PickTarget, controlsForDevice, filterPickItems } from './editor-model';

const OTHER = '__other__';
const MAX_ITEMS = 250;

interface DeviceChoice {
  value: string;
  device: string;
  deviceIndex: number;
  label: string;
}

/** Choose a device and then one of its controls, by name. */
@Component({
  selector: 'app-control-picker',
  imports: [MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="device">
        <mat-label>Device</mat-label>
        <mat-select [value]="deviceValue()" (valueChange)="chooseDevice($event)">
          <mat-optgroup label="Built in">
            @for (d of builtin; track d.value) {
              <mat-option [value]="d.value">{{ d.label }}</mat-option>
            }
          </mat-optgroup>
          @if (inFile().length) {
            <mat-optgroup label="In this file">
              @for (d of inFile(); track d.value) {
                <mat-option [value]="d.value">{{ d.label }}</mat-option>
              }
            </mat-optgroup>
          }
          @if (connected().length) {
            <mat-optgroup label="Connected">
              @for (d of connected(); track d.value) {
                <mat-option [value]="d.value">{{ d.label }}</mat-option>
              }
            </mat-optgroup>
          }
          <mat-optgroup label="All supported devices">
            @for (d of supported(); track d.value) {
              <mat-option [value]="d.value">{{ d.label }}</mat-option>
            }
          </mat-optgroup>
          <mat-option [value]="OTHER">Other device ID…</mat-option>
        </mat-select>
      </mat-form-field>
      @if (other()) {
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="custom">
          <mat-label>Device ID</mat-label>
          <input
            matInput
            [value]="device()"
            (input)="setCustom($any($event.target).value)"
            placeholder="e.g. 231D0200"
            spellcheck="false"
            autocomplete="off"
          />
        </mat-form-field>
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="index">
          <mat-label>Index</mat-label>
          <input matInput type="number" min="0" max="15" [value]="deviceIndex()" (input)="setIndex($any($event.target).value)" />
        </mat-form-field>
      }
    </div>
    <mat-form-field appearance="outline" subscriptSizing="dynamic" class="search">
      <mat-icon matPrefix>search</mat-icon>
      <mat-label>Find a control</mat-label>
      <input
        #searchBox
        matInput
        [value]="search()"
        (input)="search.set($any($event.target).value)"
        (keydown.arrowdown)="focusFirst($event)"
        autocomplete="off"
      />
    </mat-form-field>
    <p class="muted hint">
      {{ hint() }}
      @if (items().length > shown().length) {
        Showing {{ shown().length }} of {{ items().length }}; type to narrow.
      }
    </p>
    <div class="list" role="group" [attr.aria-label]="'Controls on ' + deviceLabel()" #list>
      @for (i of shown(); track i.key) {
        <button
          type="button"
          class="item"
          (click)="pick(i.key)"
          (keydown.arrowdown)="move($event, 1)"
          (keydown.arrowup)="move($event, -1)"
        >
          <span class="lbl">{{ i.label }}</span>
          <code class="muted">{{ i.key }}</code>
          <span class="cls">{{ i.cls }}</span>
        </button>
      } @empty {
        <p class="muted empty">No matching controls on this device.</p>
      }
    </div>
    <div class="foot">
      <button matButton type="button" (click)="cancelled.emit()">Close list</button>
    </div>
  `,
  styles: `
    :host {
      display: block;
      padding: 12px;
      border: 1px solid var(--edb-border);
      border-radius: 12px;
      background: var(--mat-sys-surface-container-low);
    }
    .head {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .device {
      flex: 1 1 240px;
    }
    .custom {
      flex: 1 1 160px;
    }
    .index {
      width: 90px;
    }
    .search {
      width: 100%;
      margin-top: 8px;
    }
    .hint {
      margin: 4px 0;
      font-size: 0.85em;
    }
    .list {
      max-height: 240px;
      overflow: auto;
      border: 1px solid var(--edb-border);
      border-radius: 8px;
    }
    .item {
      display: flex;
      align-items: baseline;
      gap: 8px;
      width: 100%;
      padding: 8px 12px;
      border: 0;
      border-bottom: 1px solid var(--edb-border);
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .item:hover,
    .item:focus-visible {
      background: var(--edb-accent-soft);
      outline: none;
    }
    .lbl {
      flex: 1 1 auto;
    }
    .cls {
      font-size: 0.75em;
      color: var(--edb-muted);
      text-transform: uppercase;
    }
    .empty {
      padding: 12px;
      margin: 0;
    }
    .foot {
      display: flex;
      justify-content: flex-end;
      margin-top: 4px;
    }
  `,
})
export class ControlPicker implements OnInit {
  private readonly catalog = inject(CatalogService);
  private readonly store = inject(BindingsStore);
  private readonly liveInput = inject(InputService);

  readonly action = input.required<ActionTraits>();
  readonly target = input<PickTarget>('binding');
  /** Device to start on. */
  readonly initial = input<InputRef | null>(null);
  readonly picked = output<InputRef>();
  readonly cancelled = output<void>();

  protected readonly OTHER = OTHER;
  protected readonly device = signal('Keyboard');
  protected readonly deviceIndex = signal(0);
  protected readonly other = signal(false);
  protected readonly search = signal('');
  private readonly searchBox = viewChild<ElementRef<HTMLInputElement>>('searchBox');
  private readonly listEl = viewChild<ElementRef<HTMLElement>>('list');

  protected readonly builtin: DeviceChoice[] = Object.entries(BUILTIN_DEVICES).map(([id, label]) => ({
    value: `${id}::0`,
    device: id,
    deviceIndex: 0,
    label,
  }));

  protected readonly inFile = computed<DeviceChoice[]>(() =>
    this.store
      .devicesUsed()
      .filter((d) => !(d.device in BUILTIN_DEVICES))
      .map((d) => this.choice(d.device, d.deviceIndex)),
  );

  protected readonly connected = computed<DeviceChoice[]>(() =>
    this.liveInput
      .devices()
      .filter((d) => d.backend !== 'keyboard')
      .map((d) => ({ ...this.choice(d.bindsId, d.deviceIndex), label: `${d.name} (${d.bindsId})` })),
  );

  protected readonly supported = computed<DeviceChoice[]>(() => {
    const out = new Map<string, DeviceChoice>();
    for (const d of this.catalog.devices()) {
      for (const id of d.ids) {
        if (id.bindsId in BUILTIN_DEVICES) continue;
        const idx = id.deviceIndex ?? 0;
        const value = `${id.bindsId}::${idx}`;
        if (!out.has(value)) out.set(value, { value, device: id.bindsId, deviceIndex: idx, label: `${d.name} (${id.bindsId})` });
      }
    }
    return [...out.values()].sort((a, b) => a.label.localeCompare(b.label));
  });

  protected readonly deviceValue = computed(() => (this.other() ? OTHER : `${this.device()}::${this.deviceIndex()}`));
  protected readonly deviceLabel = computed(() => this.catalog.deviceName(this.device(), this.deviceIndex()));

  protected readonly items = computed(() => {
    const device = this.device();
    const idx = this.deviceIndex();
    const summary = this.catalog.deviceFor(device, idx);
    const def = summary
      ? (this.catalog.definitions().get(summary.id) ?? this.catalog.localDevice(summary.id)?.definition)
      : undefined;
    const all = controlsForDevice(device, idx, def, this.catalog.keys().values(), this.catalog.genericControls());
    return filterPickItems(all, this.action(), this.target(), this.search());
  });
  protected readonly shown = computed(() => this.items().slice(0, MAX_ITEMS));

  protected readonly hint = computed(() => {
    const a = this.action();
    if (this.target() === 'modifier') return 'Modifiers are buttons, keys or hat directions that must be held.';
    if (a.kind === 'axis') return 'Only axes are listed: this is an analogue command.';
    return a.hasAnalogue
      ? 'Buttons, keys, hat directions, axis halves and whole axes.'
      : 'Buttons, keys, hat directions and axis halves (+ / −).';
  });

  constructor() {
    // Fetch the device definition so real control names are listed.
    effect(() => {
      const s = this.catalog.deviceFor(this.device(), this.deviceIndex());
      if (s) void this.catalog.loadDevice(s.id).catch(() => undefined);
    });
  }

  ngOnInit(): void {
    const init = this.initial();
    if (init && init.device && init.device !== '{NoDevice}') {
      this.setDevice(init.device, init.deviceIndex ?? 0);
    } else if (this.action().kind === 'axis') {
      const joy = this.inFile()[0] ?? this.connected()[0];
      if (joy) this.setDevice(joy.device, joy.deviceIndex);
      else this.setDevice('GamePad', 0);
    }
    setTimeout(() => this.searchBox()?.nativeElement.focus());
  }

  private choice(device: string, deviceIndex: number): DeviceChoice {
    const name = this.catalog.deviceName(device, deviceIndex);
    return {
      value: `${device}::${deviceIndex}`,
      device,
      deviceIndex,
      label: name === device ? device : `${name} (${device})`,
    };
  }

  private setDevice(device: string, deviceIndex: number): void {
    this.device.set(device);
    this.deviceIndex.set(deviceIndex);
    const known =
      device in BUILTIN_DEVICES ||
      [...this.inFile(), ...this.connected(), ...this.supported()].some((c) => c.value === `${device}::${deviceIndex}`);
    this.other.set(!known);
  }

  protected chooseDevice(value: string): void {
    if (value === OTHER) {
      this.other.set(true);
      this.device.set('');
      this.deviceIndex.set(0);
      return;
    }
    const i = value.lastIndexOf('::');
    this.other.set(false);
    this.device.set(value.slice(0, i));
    this.deviceIndex.set(Number(value.slice(i + 2)) || 0);
  }

  protected setCustom(v: string): void {
    this.device.set(v.trim());
  }

  protected setIndex(v: string): void {
    const n = Math.max(0, Math.min(15, Math.floor(Number(v) || 0)));
    this.deviceIndex.set(n);
  }

  protected pick(key: string): void {
    const device = this.device();
    if (!device) return;
    const ref: InputRef = { device, key };
    if (this.deviceIndex() > 0) ref.deviceIndex = this.deviceIndex();
    this.picked.emit(ref);
  }

  protected focusFirst(e: Event): void {
    const first = this.listEl()?.nativeElement.querySelector<HTMLElement>('.item');
    if (first) {
      e.preventDefault();
      first.focus();
    }
  }

  protected move(e: Event, dir: 1 | -1): void {
    e.preventDefault();
    const el = e.target as HTMLElement;
    const next = (dir === 1 ? el.nextElementSibling : el.previousElementSibling) as HTMLElement | null;
    if (next?.classList.contains('item')) next.focus();
    else if (dir === -1) this.searchBox()?.nativeElement.focus();
  }
}
