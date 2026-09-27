import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { filter } from 'rxjs';
import { DeviceControl } from '../../../core/data/catalog.types';
import { InputService } from '../../../core/input/input.service';
import { DeviceDiagram, controlKey } from '../../../shared/device-diagram';
import { partFor } from './draft';
import { EditorStore } from './editor-store';
import { Issue } from './validation';

const FILLER = [
  'Deploy Hardpoints / Silent Running',
  'Cycle Next Fire Group (Hold: Target Wingman 3)',
  'Frame Shift Drive · Supercruise',
  'Galaxy Map / System Map / Orrery',
  'Increase Engines Power + Balance',
];

@Component({
  selector: 'app-step-check',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatButtonToggleModule, MatIconModule, DeviceDiagram],
  styleUrls: ['./step-common.scss'],
  styles: `
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 2fr) minmax(280px, 1fr);
      gap: 16px;
      align-items: start;
    }
    @media (max-width: 1000px) {
      .layout {
        grid-template-columns: 1fr;
      }
    }
    .issue {
      display: flex;
      gap: 8px;
      align-items: flex-start;
      width: 100%;
      padding: 8px;
      border: 0;
      border-bottom: 1px solid var(--edb-border);
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      &:hover {
        background: var(--mat-sys-surface-container-high);
      }
      mat-icon {
        flex: none;
      }
    }
    .error mat-icon {
      color: var(--edb-danger);
    }
    .warning mat-icon {
      color: var(--edb-warning);
    }
    .ok {
      color: var(--edb-ok);
    }
    .stats {
      margin: 0 0 12px;
    }
  `,
  template: `
    <p class="intro">
      Press controls on the device to see their boxes light up. Filler text shows whether long action names still fit. Click
      a box to go back and adjust it.
    </p>
    <div class="layout">
      <div>
        <div class="row">
          <mat-button-toggle-group [value]="mode()" (change)="mode.set($event.value)" aria-label="Preview text">
            <mat-button-toggle value="labels">Labels</mat-button-toggle>
            <mat-button-toggle value="filler">Filler text</mat-button-toggle>
            <mat-button-toggle value="keys">Elite keys</mat-button-toggle>
          </mat-button-toggle-group>
          @if (store.draft().images.length > 1) {
            <mat-button-toggle-group [value]="store.imageIndex()" (change)="store.imageIndex.set($event.value)" aria-label="Image">
              @for (img of store.draft().images; track img.uid; let i = $index) {
                <mat-button-toggle [value]="i">Image {{ i + 1 }}</mat-button-toggle>
              }
            </mat-button-toggle-group>
          }
        </div>
        <app-device-diagram
          [device]="store.definition()"
          [imageIndex]="store.imageIndex()"
          [imageHref]="imageUrl()"
          [highlight]="highlight()"
          [labels]="labels()"
          [clickable]="true"
          (controlClick)="goTo($event)"
        />
      </div>
      <div class="panel">
        <h2><mat-icon>fact_check</mat-icon>Validation</h2>
        <p class="stats hint">
          {{ store.draft().ids.length }} IDs · {{ store.draft().controls.length }} controls · {{ store.placedCount() }}/{{ store.placeable().length }} placed ·
          {{ store.draft().images.length }} images
        </p>
        @for (i of store.issues(); track $index) {
          <button type="button" class="issue" [class]="i.level" (click)="fix(i)">
            <mat-icon>{{ i.level === 'error' ? 'error' : 'warning' }}</mat-icon>
            <span>{{ i.message }}</span>
          </button>
        } @empty {
          <p class="ok"><mat-icon inline>check_circle</mat-icon> Everything looks good. device.json matches the schema.</p>
        }
      </div>
    </div>
  `,
})
export class StepCheck {
  protected readonly store = inject(EditorStore);
  private readonly input = inject(InputService);
  protected readonly mode = signal<'labels' | 'filler' | 'keys'>('labels');
  private readonly recentAxes = signal<ReadonlySet<string>>(new Set());

  protected readonly imageUrl = computed(() => this.store.urlFor(this.store.draft().images[this.store.imageIndex()]?.blob));
  protected readonly highlight = computed(() => {
    const set = new Set(this.recentAxes());
    for (const r of this.input.held()) set.add(controlKey(r.device, r.key));
    return set;
  });
  protected readonly labels = computed(() => {
    const m = this.mode();
    if (m === 'labels') return null;
    const map = new Map<string, string>();
    this.store.definition().controls.forEach((c, i) => map.set(controlKey(c.bindsId, c.key), m === 'keys' ? c.key : FILLER[i % FILLER.length]));
    return map;
  });

  constructor() {
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const sub = this.input.events.pipe(filter((e) => e.kind === 'axis' && e.pressed)).subscribe((e) => {
      const k = controlKey(e.ref.device, e.ref.key);
      this.recentAxes.update((s) => new Set(s).add(k));
      clearTimeout(timers.get(k));
      timers.set(
        k,
        setTimeout(() => this.recentAxes.update((s) => new Set([...s].filter((x) => x !== k))), 700),
      );
    });
    inject(DestroyRef).onDestroy(() => {
      sub.unsubscribe();
      timers.forEach((t) => clearTimeout(t));
    });
  }

  protected goTo(c: DeviceControl): void {
    const d = this.store.draft();
    const part = partFor(d, c.bindsId, c.deviceIndex ?? 0);
    const key = c.key.replace(/^(Pos|Neg)_/, '');
    const dc = d.controls.find((x) => x.part === part && x.key === c.key && x.box) ?? d.controls.find((x) => x.part === part && x.key === key);
    if (!dc) return;
    this.store.activate(dc.uid);
    this.store.step.set('place');
  }

  protected fix(i: Issue): void {
    if (i.uids?.length) {
      this.store.activate(i.uids[0]);
      const placed = new Set(i.uids.filter((u) => this.store.draft().controls.find((c) => c.uid === u)?.box));
      if (placed.size) this.store.selected.set(placed);
    }
    if (i.step !== 'check') this.store.step.set(i.step);
  }
}
