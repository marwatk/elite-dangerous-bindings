import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CatalogService } from '../../core/data/catalog.service';
import { InputService } from '../../core/input/input.service';
import { BindingsStore } from '../../core/state/bindings-store.service';
import { BindingsView } from './bindings-view.service';
import { countDeviceUse } from './bulk-model';

export type BulkMode = 'clear' | 'move';

@Component({
  selector: 'app-bulk-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
    MatAutocompleteModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ mode() === 'clear' ? 'Clear a device' : 'Move bindings to another device' }}</h2>
    <mat-dialog-content>
      <mat-button-toggle-group class="modes" [value]="mode()" (change)="mode.set($event.value)" aria-label="Bulk action" hideSingleSelectionIndicator>
        <mat-button-toggle value="clear"><mat-icon>delete_sweep</mat-icon> Clear device</mat-button-toggle>
        <mat-button-toggle value="move"><mat-icon>move_down</mat-icon> Move device</mat-button-toggle>
      </mat-button-toggle-group>
      @if (!view.deviceOptions().length) {
        <p class="muted">This file has no bindings on any device.</p>
      } @else {
        <mat-form-field appearance="outline" class="full">
          <mat-label>{{ mode() === 'clear' ? 'Device to clear' : 'Move bindings from' }}</mat-label>
          <mat-select [value]="source()" (valueChange)="source.set($event)">
            @for (d of view.deviceOptions(); track d.key) {
              <mat-option [value]="d.key">
                {{ d.label }}
                @if (d.label !== d.device) {
                  <span class="muted">({{ d.device }}{{ d.deviceIndex ? ' #' + (d.deviceIndex + 1) : '' }})</span>
                }
              </mat-option>
            }
          </mat-select>
        </mat-form-field>

        @if (mode() === 'clear') {
          @if (counts(); as c) {
            <p>
              This clears <strong>{{ c.slots }}</strong> binding{{ c.slots === 1 ? '' : 's' }} on
              <strong>{{ sourceLabel() }}</strong>.
              @if (c.refs > c.slots) {
                <span class="muted">{{ c.refs - c.slots }} other binding(s) use it only as a modifier and are left alone.</span>
              }
              You can undo this.
            </p>
          }
        } @else {
          <div class="row">
            <mat-form-field appearance="outline" class="grow" subscriptSizing="dynamic">
              <mat-label>To device ID</mat-label>
              <input
                matInput
                [value]="target()"
                (input)="target.set($any($event.target).value.trim())"
                [matAutocomplete]="auto"
                spellcheck="false"
                autocomplete="off"
              />
              <mat-autocomplete #auto="matAutocomplete" (optionSelected)="target.set($event.option.value)">
                @for (o of targetOptions(); track o.id) {
                  <mat-option [value]="o.id">{{ o.id }} <span class="muted">– {{ o.label }}</span></mat-option>
                }
              </mat-autocomplete>
              <mat-hint>Pick a supported or connected device, or type the ID from another file</mat-hint>
            </mat-form-field>
            <mat-form-field appearance="outline" class="idx" subscriptSizing="dynamic">
              <mat-label>Index</mat-label>
              <input matInput type="number" min="0" max="15" [value]="targetIndex() ?? ''" (input)="setIndex($any($event.target).value)" placeholder="keep" />
              <mat-hint>optional</mat-hint>
            </mat-form-field>
          </div>
          @if (counts(); as c) {
            <p>
              <strong>{{ c.refs }}</strong> binding{{ c.refs === 1 ? '' : 's' }} (including modifiers) will move from
              <code>{{ sourceRef()?.device }}</code> to <code>{{ target() || '…' }}</code>.
              @if (targetLabel(); as tl) {
                <span class="muted">({{ tl }})</span>
              }
            </p>
          }
          @if (sameAsSource()) {
            <p class="warn">The target is the same as the source.</p>
          }
        }
      }
      <p class="muted note">
        Copying commands between contexts (for example Ship → SRV) isn't offered: the game's commands don't map one to one
        between contexts, and a wrong guess would silently create broken bindings.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions>
      <button matButton type="button" mat-dialog-close>Cancel</button>
      @if (mode() === 'clear') {
        <button matButton="filled" type="button" class="danger" [disabled]="!counts()?.slots" (click)="clear()">
          Clear {{ counts()?.slots ?? 0 }} binding{{ counts()?.slots === 1 ? '' : 's' }}
        </button>
      } @else {
        <button matButton="filled" type="button" [disabled]="!canMove()" (click)="move()">Move {{ counts()?.refs ?? 0 }}</button>
      }
    </mat-dialog-actions>
  `,
  styles: `
    .modes {
      display: flex;
      width: 100%;
      gap: 8px;
      margin-bottom: 16px;
    }
    .modes mat-button-toggle {
      flex: 1 1 0;
    }
    .modes mat-icon {
      vertical-align: middle;
    }
    .full {
      width: 100%;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .grow {
      flex: 1 1 240px;
    }
    .idx {
      width: 110px;
    }
    .warn {
      color: var(--edb-warning);
    }
    .note {
      font-size: 0.85em;
      margin-top: 16px;
    }
    .danger {
      --mat-button-filled-container-color: var(--edb-danger);
    }
  `,
})
export class BulkDialog {
  private readonly store = inject(BindingsStore);
  private readonly catalog = inject(CatalogService);
  private readonly liveInput = inject(InputService);
  private readonly snack = inject(MatSnackBar);
  private readonly ref = inject(MatDialogRef<BulkDialog>);
  protected readonly view = inject(BindingsView);

  protected readonly mode = signal<BulkMode>(inject<{ mode?: BulkMode }>(MAT_DIALOG_DATA, { optional: true })?.mode ?? 'clear');
  protected readonly source = signal<string>(this.view.deviceOptions().find((d) => !['Keyboard', 'Mouse', 'GamePad'].includes(d.device))?.key ?? this.view.deviceOptions()[0]?.key ?? '');
  protected readonly target = signal('');
  protected readonly targetIndex = signal<number | null>(null);

  protected readonly sourceRef = computed(() => this.view.deviceOptions().find((d) => d.key === this.source()) ?? null);
  protected readonly sourceLabel = computed(() => this.sourceRef()?.label ?? '');
  protected readonly counts = computed(() => {
    const s = this.sourceRef();
    return s ? countDeviceUse(this.store.actions(), s.device, s.deviceIndex) : null;
  });

  protected readonly targetOptions = computed(() => {
    const out = new Map<string, string>();
    for (const d of this.liveInput.devices()) out.set(d.bindsId, `${d.name} (connected)`);
    for (const d of this.catalog.devices()) for (const id of d.ids) if (!out.has(id.bindsId)) out.set(id.bindsId, d.name);
    const q = this.target().toLowerCase();
    return [...out]
      .map(([id, label]) => ({ id, label }))
      .filter((o) => !q || o.id.toLowerCase().includes(q) || o.label.toLowerCase().includes(q))
      .slice(0, 100);
  });
  protected readonly targetLabel = computed(() => {
    const t = this.target();
    return t ? (this.catalog.deviceFor(t)?.name ?? null) : null;
  });
  protected readonly sameAsSource = computed(() => {
    const s = this.sourceRef();
    return !!s && s.device === this.target() && (this.targetIndex() ?? s.deviceIndex) === s.deviceIndex;
  });
  protected readonly canMove = computed(
    () => !!this.sourceRef() && !!this.target() && !/\s{2,}|^\{/.test(this.target()) && !this.sameAsSource() && !!this.counts()?.refs,
  );

  protected setIndex(v: string): void {
    this.targetIndex.set(v === '' ? null : Math.max(0, Math.min(15, Math.floor(Number(v) || 0))));
  }

  protected clear(): void {
    const s = this.sourceRef();
    if (!s) return;
    let n = 0;
    this.store.mutate(`Clear ${s.label}`, (d) => (n = d.clearDevice(s.device, s.deviceIndex)));
    this.snack.open(`Cleared ${n} binding${n === 1 ? '' : 's'} on ${s.label}`, undefined, { duration: 4000 });
    this.ref.close(true);
  }

  protected move(): void {
    const s = this.sourceRef();
    const to = this.target();
    if (!s || !to || !this.canMove()) return;
    let n = 0;
    const idx = this.targetIndex();
    this.store.mutate(`Move ${s.label} to ${to}`, (d) => (n = d.replaceDevice(s.device, to, s.deviceIndex, idx ?? undefined)));
    void this.catalog.loadDevicesFor([{ device: to, deviceIndex: idx ?? s.deviceIndex }]);
    this.snack.open(`Moved ${n} binding${n === 1 ? '' : 's'} to ${to}`, undefined, { duration: 4000 });
    this.ref.close(true);
  }

}
