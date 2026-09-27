import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Subscription, filter } from 'rxjs';
import { BUILTIN_DEVICES, CatalogService } from '../../../core/data/catalog.service';
import { bindsIdError, formatUsb, isValidDeviceId, normalizeBindsId, usbFromBindsId } from '../../../core/devices/device-files';
import { InputService } from '../../../core/input/input.service';
import { LiveDevice } from '../../../core/input/input.types';
import { BindingsStore } from '../../../core/state/bindings-store.service';
import { DraftId, isPrimary } from './draft';
import { EditorStore } from './editor-store';

@Component({
  selector: 'app-step-identify',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatChipsModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, MatTooltipModule],
  styleUrls: ['./step-common.scss'],
  styles: `
    .name-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
      gap: 0 16px;
      margin-bottom: 8px;
    }
    .index {
      width: 64px;
    }
    .live-dev {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
      border-bottom: 1px solid var(--edb-border);
    }
    .grow {
      flex: 1;
      min-width: 0;
    }
    .warn {
      color: var(--edb-warning);
      font-size: 0.8rem;
    }
    .ids-table {
      margin-top: 16px;
    }
    .ids-panel {
      margin-top: 16px;
    }
  `,
  template: `
    <p class="intro">
      Name the device and tell the editor which device ID Elite writes for it in <code>.binds</code> files. Add more IDs for
      other hardware revisions of the same controller (they share its controls), or give a multi-part device one ID per part.
    </p>

    <div class="name-row">
      <mat-form-field>
        <mat-label>Device name</mat-label>
        <input matInput [value]="d().name" (input)="store.setName(val($event))" placeholder="e.g. VKB Gladiator NXT EVO (Right)" data-testid="device-name" />
      </mat-form-field>
      <mat-form-field>
        <mat-label>Folder id</mat-label>
        <input matInput class="mono" [value]="d().id" (input)="store.setId(val($event))" data-testid="device-id" />
        <mat-hint>devices/{{ d().id || '…' }}/ — letters, digits and dashes</mat-hint>
        @if (d().id && !validId()) {
          <mat-error>Letters, digits and dashes only</mat-error>
        }
      </mat-form-field>
    </div>
    @if (idClash(); as clash) {
      <p class="warn"><mat-icon inline>warning</mat-icon> {{ clash }}</p>
    }

    <div class="cols">
      <div class="panel">
        <h2><mat-icon>stadia_controller</mat-icon>Detect it</h2>
        @if (listening()) {
          <p><span class="live-dot"></span> Press any button on the controller…</p>
          <button matButton type="button" (click)="stopListening()">Stop</button>
        } @else {
          <button matButton="filled" type="button" (click)="listen()"><mat-icon>touch_app</mat-icon>Press a button to detect</button>
        }
        @if (input.webHidSupported) {
          <button matButton type="button" (click)="connectHid()"><mat-icon>usb</mat-icon>Connect with WebHID…</button>
        }
        @for (dev of input.devices(); track dev.id) {
          <div class="live-dev">
            <mat-icon>{{ dev.connected ? 'sports_esports' : 'portable_wifi_off' }}</mat-icon>
            <div class="grow">
              <div>{{ dev.name }}</div>
              <div class="hint mono">{{ dev.bindsId }} {{ fmt(dev.usb) }} · {{ dev.buttons }} buttons, {{ dev.axes }} axes, {{ dev.hats }} hats</div>
            </div>
            <button matButton type="button" (click)="useLive(dev)">Use</button>
          </div>
        } @empty {
          <p class="hint">No controller seen yet. Plug it in and press a button{{ input.webHidSupported ? ', or connect it with WebHID' : '' }}.</p>
        }
        @if (store.liveDevice(); as live) {
          @if (extraCandidates().length) {
            <p class="hint">Elite may also write this device as:</p>
            <mat-chip-set>
              @for (c of extraCandidates(); track c) {
                <mat-chip (click)="add(c)"><mat-icon matChipAvatar>add</mat-icon>{{ c }}</mat-chip>
              }
            </mat-chip-set>
          }
        }
      </div>

      <div class="panel">
        <h2><mat-icon>description</mat-icon>From your bindings file</h2>
        @if (fromFile().length) {
          <mat-chip-set aria-label="Device IDs in your bindings file">
            @for (u of fromFile(); track u.device + u.deviceIndex) {
              <mat-chip (click)="add(u.device, u.deviceIndex || undefined)" [matTooltip]="catalog.deviceName(u.device, u.deviceIndex)">
                <mat-icon matChipAvatar>add</mat-icon>{{ u.device }}{{ u.deviceIndex ? ' #' + u.deviceIndex : '' }}
              </mat-chip>
            }
          </mat-chip-set>
        } @else {
          <p class="hint">Open your <code>.binds</code> file to pick one of the controllers it uses.</p>
        }
      </div>

      <div class="panel">
        <h2><mat-icon>keyboard</mat-icon>Type it</h2>
        <div class="row">
          <mat-form-field class="grow" subscriptSizing="dynamic">
            <mat-label>Elite device ID</mat-label>
            <input matInput class="mono" [value]="typed()" (input)="typed.set(val($event))" (keydown.enter)="addTyped()" placeholder="231D0200" data-testid="binds-id" />
            @if (typed() && typedError()) {
              <mat-hint class="warn">{{ typedError() }}</mat-hint>
            } @else {
              <mat-hint>8 hex digits (VID+PID) or a name like SaitekX56Joystick</mat-hint>
            }
          </mat-form-field>
          <button matButton="tonal" type="button" (click)="addTyped()" [disabled]="!!typedError()">Add</button>
        </div>
      </div>
    </div>

    <div class="panel ids-panel">
      <h2><mat-icon>badge</mat-icon>IDs this device handles</h2>
      @if (d().ids.length) {
        <table class="grid ids-table">
          <thead>
            <tr><th>Elite ID</th><th>USB</th><th>Index</th><th>Controls</th><th></th></tr>
          </thead>
          <tbody>
            @for (id of d().ids; track id.uid) {
              <tr>
                <td>
                  <span class="mono">{{ id.bindsId }}</span>
                  @if (overrideCount(id); as n) {
                    <div class="hint">
                      Keeps {{ n }} labels of its own
                      <button matButton type="button" (click)="store.updateId(id.uid, { labelOverrides: undefined })">Use the same labels</button>
                    </div>
                  }
                  @if (handledBy(id); as other) {
                    <div class="warn">Also handled by bundled “{{ other }}”</div>
                  }
                </td>
                <td class="mono">{{ fmt(id.usb) || '—' }}</td>
                <td>
                  <input
                    class="dense-field index"
                    type="number"
                    min="0"
                    [value]="id.deviceIndex ?? ''"
                    placeholder="any"
                    (change)="setIndex(id, $event)"
                    matTooltip="Elite DeviceIndex, only for identical devices plugged in twice"
                  />
                </td>
                <td>
                  <mat-select [value]="isPrimaryId(id) ? '' : id.aliasOf" (selectionChange)="store.setAlias(id.uid, $event.value || null)" aria-label="Controls">
                    <mat-option value="">Its own controls</mat-option>
                    @for (p of store.primaries(); track p.uid) {
                      @if (p.uid !== id.uid) {
                        <mat-option [value]="p.uid">Same as {{ p.bindsId }}</mat-option>
                      }
                    }
                  </mat-select>
                </td>
                <td>
                  <button matIconButton type="button" (click)="store.removeId(id.uid)" aria-label="Remove ID" matTooltip="Remove"><mat-icon>close</mat-icon></button>
                </td>
              </tr>
            }
          </tbody>
        </table>
      } @else {
        <p class="hint">None yet — detect, pick or type one above.</p>
      }
    </div>
  `,
})
export class StepIdentify {
  protected readonly store = inject(EditorStore);
  protected readonly input = inject(InputService);
  protected readonly catalog = inject(CatalogService);
  private readonly bindings = inject(BindingsStore);

  protected readonly d = this.store.draft;
  protected readonly listening = signal(false);
  protected readonly typed = signal('');
  protected readonly typedError = computed(() => bindsIdError(this.typed()));
  protected readonly validId = computed(() => isValidDeviceId(this.d().id));
  private sub: Subscription | null = null;

  protected readonly fromFile = computed(() =>
    this.bindings.devicesUsed().filter((u) => !(u.device in BUILTIN_DEVICES) && u.device !== '{NoDevice}'),
  );

  protected readonly extraCandidates = computed(() => {
    const live = this.store.liveDevice();
    const have = new Set(this.d().ids.map((i) => i.bindsId));
    return (live?.candidates ?? []).filter((c) => !have.has(c));
  });

  protected readonly idClash = computed(() => {
    const d = this.d();
    const other = this.catalog.deviceById(d.id);
    if (!d.id || !other || d.id === d.baseId) return null;
    return other.local
      ? `Saving will replace “${other.name}”, already saved in this browser with this id.`
      : `“${d.id}” is the id of the bundled device “${other.name}”. Choose another id.`;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.sub?.unsubscribe());
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected fmt = formatUsb;

  protected isPrimaryId(id: DraftId): boolean {
    return isPrimary(this.d(), id);
  }

  protected overrideCount(id: DraftId): number {
    return id.aliasOf ? Object.keys(id.labelOverrides ?? {}).length : 0;
  }

  protected handledBy(id: DraftId): string | null {
    const s = this.catalog.deviceFor(id.bindsId, id.deviceIndex ?? 0);
    if (!s || s.local || s.id === this.d().baseId || !s.ids.some((i) => i.bindsId === id.bindsId)) return null;
    return s.name;
  }

  protected listen(): void {
    this.listening.set(true);
    this.sub?.unsubscribe();
    this.sub = this.input.events.pipe(filter((e) => e.kind !== 'key' && e.pressed && e.device.backend !== 'keyboard')).subscribe((e) => {
      this.useLive(e.device);
      this.stopListening();
    });
  }

  protected stopListening(): void {
    this.listening.set(false);
    this.sub?.unsubscribe();
    this.sub = null;
  }

  protected async connectHid(): Promise<void> {
    const devs = await this.input.requestHidDevices();
    if (devs.length === 1) this.useLive(devs[0]);
  }

  protected useLive(dev: LiveDevice): void {
    this.store.liveDevice.set(dev);
    this.store.addId(dev.bindsId, { deviceIndex: dev.deviceIndex > 0 ? dev.deviceIndex : undefined, usb: dev.usb });
    if (!this.d().name.trim() && dev.name) this.store.setName(dev.name);
  }

  protected add(bindsId: string, deviceIndex?: number): void {
    const usb = usbFromBindsId(bindsId) ?? this.catalog.namedIds()[bindsId]?.[0];
    this.store.addId(bindsId, { deviceIndex, usb });
  }

  protected addTyped(): void {
    if (this.typedError()) return;
    this.add(normalizeBindsId(this.typed()));
    this.typed.set('');
  }

  protected setIndex(id: DraftId, e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    const n = v === '' ? undefined : Math.max(0, Math.floor(Number(v)));
    this.store.updateId(id.uid, { deviceIndex: Number.isFinite(n) ? n : undefined });
  }
}
