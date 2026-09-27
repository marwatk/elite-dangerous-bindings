import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { CatalogService } from '../../core/data/catalog.service';
import { InputCorrection } from '../../core/data/catalog.types';
import { InputService } from '../../core/input/input.service';
import { CaptureKind, LiveDevice } from '../../core/input/input.types';
import { BindingsStore } from '../../core/state/bindings-store.service';
import { CheckAnalysis, CheckResult, CheckTarget, analyzeCheck, baseKey, pickCheckTargets } from './numbering-check';

type Phase = 'idle' | 'running' | 'done';

@Component({
  selector: 'app-numbering-wizard',
  imports: [MatButtonModule, MatFormFieldModule, MatIconModule, MatSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!store.isOpen()) {
      <p class="muted">Open your bindings file first: the check compares your controller with the bindings in it.</p>
    } @else if (!eligible().length) {
      <p class="muted">
        None of the connected controllers has bindings in the open file. Connect one (or pick the right Elite device ID on
        its card) to check its numbering.
      </p>
    } @else {
      <p class="muted intro">
        Press or move a few controls that your file already binds. If the browser numbers them differently from the game,
        you can save a correction for this browser.
      </p>
      <div class="row">
        <mat-form-field subscriptSizing="dynamic" class="dev">
          <mat-label>Controller</mat-label>
          <mat-select [value]="deviceId()" (selectionChange)="pick($event.value)" [disabled]="phase() === 'running'">
            @for (d of eligible(); track d.id) {
              <mat-option [value]="d.id">{{ d.name }} ({{ d.bindsId }})</mat-option>
            }
          </mat-select>
        </mat-form-field>
        @if (phase() !== 'running') {
          <button matButton="filled" (click)="run()" [disabled]="!targets().length">
            <mat-icon>play_arrow</mat-icon> {{ phase() === 'done' ? 'Check again' : 'Start check' }}
          </button>
        } @else {
          <button matButton (click)="skip()"><mat-icon>skip_next</mat-icon> Skip</button>
          <button matButton (click)="cancel()"><mat-icon>close</mat-icon> Cancel</button>
        }
      </div>

      <ol class="steps">
        @for (t of targets(); track t.key; let i = $index) {
          <li [class.current]="phase() === 'running' && step() === i">
            <span class="what">
              {{ verb(t) }} <strong>{{ label(t.key) }}</strong>
              <span class="muted">({{ actionNames(t) }})</span>
            </span>
            <span class="res">
              @if (results()[i]; as r) {
                @if (r.got === null) {
                  <span class="muted">skipped</span>
                } @else if (r.got === t.key) {
                  <span class="ok"><mat-icon inline>check</mat-icon> {{ r.got }}</span>
                } @else {
                  <span class="bad"><mat-icon inline>error</mat-icon> got {{ r.got }}, file says {{ t.key }}</span>
                }
              } @else if (phase() === 'running' && step() === i) {
                <span class="wait">waiting…</span>
              }
            </span>
          </li>
        }
      </ol>
      @if (message()) {
        <p class="warn"><mat-icon inline>info</mat-icon> {{ message() }}</p>
      }

      @if (analysis(); as a) {
        @if (a.allMatch) {
          <p class="ok summary"><mat-icon inline>verified</mat-icon> All {{ a.matches }} controls match your file.</p>
        } @else if (a.matches + a.mismatches.length > 0) {
          <p class="bad summary"><mat-icon inline>warning</mat-icon> {{ a.mismatches.length }} of {{ a.matches + a.mismatches.length }} controls differ. {{ a.explanation }}</p>
          @if (a.suggestion; as s) {
            <p>
              Suggested correction for <code>{{ device()?.bindsId }}</code>: {{ describe(s) }}
              <button matButton="tonal" (click)="apply(s)"><mat-icon>tune</mat-icon> Save correction</button>
            </p>
          }
        }
      }
      @if (applied()) {
        <p class="ok">Correction saved in this browser and applied. Run the check again to confirm.</p>
      }
    }
  `,
  styles: `
    .intro {
      margin-top: 0;
    }
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 12px;
      align-items: center;
    }
    .dev {
      flex: 1 1 240px;
      max-width: 420px;
    }
    .steps {
      padding-left: 20px;
      margin: 12px 0;
    }
    .steps li {
      padding: 6px 4px;
      display: flex;
      flex-wrap: wrap;
      gap: 4px 12px;
      justify-content: space-between;
      border-bottom: 1px solid var(--edb-border);
    }
    .steps li.current {
      background: var(--edb-accent-soft);
    }
    .ok {
      color: var(--edb-ok);
    }
    .bad {
      color: var(--edb-danger);
    }
    .warn {
      color: var(--edb-warning);
    }
    .wait {
      color: var(--edb-accent);
    }
    .summary {
      font-weight: 500;
    }
  `,
})
export class NumberingWizard {
  protected readonly store = inject(BindingsStore);
  private readonly input = inject(InputService);
  private readonly catalog = inject(CatalogService);

  protected readonly phase = signal<Phase>('idle');
  protected readonly step = signal(0);
  protected readonly results = signal<CheckResult[]>([]);
  protected readonly message = signal('');
  protected readonly applied = signal(false);
  private readonly chosen = signal<string | null>(null);
  private abort: AbortController | null = null;
  private skipping = false;
  /** Correction active while the check ran (the suggestion is relative to it). */
  private activeCorrection: InputCorrection | undefined;

  protected readonly eligible = computed(() => {
    const used = this.store.devicesUsed();
    return this.input
      .devices()
      .filter((d) => d.connected && used.some((u) => u.device === d.bindsId && u.deviceIndex === d.deviceIndex));
  });

  protected readonly deviceId = computed(() => {
    const list = this.eligible();
    const c = this.chosen();
    return list.find((d) => d.id === c)?.id ?? list[0]?.id ?? null;
  });

  protected readonly device = computed<LiveDevice | null>(
    () => this.eligible().find((d) => d.id === this.deviceId()) ?? null,
  );

  protected readonly targets = computed<CheckTarget[]>(() => {
    const d = this.device();
    return d ? pickCheckTargets(this.store.actions(), d.bindsId, d.deviceIndex) : [];
  });

  protected readonly analysis = computed<CheckAnalysis | null>(() =>
    this.phase() === 'done' ? analyzeCheck(this.results(), this.activeCorrection) : null,
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => this.abort?.abort());
  }

  protected pick(id: string): void {
    this.chosen.set(id);
    this.reset();
  }

  private reset(): void {
    this.phase.set('idle');
    this.results.set([]);
    this.message.set('');
    this.applied.set(false);
  }

  protected verb(t: CheckTarget): string {
    return t.kind === 'axis' ? 'Move' : t.kind === 'hat' ? 'Push' : 'Press';
  }

  protected label(key: string): string {
    const d = this.device();
    return d ? this.catalog.controlLabel({ device: d.bindsId, deviceIndex: d.deviceIndex, key }) : key;
  }

  protected actionNames(t: CheckTarget): string {
    const names = t.actions.slice(0, 2).map((c) => this.catalog.action(c).longName);
    return names.join(', ') + (t.actions.length > 2 ? ` +${t.actions.length - 2}` : '');
  }

  protected async run(): Promise<void> {
    const dev = this.device();
    const targets = this.targets();
    if (!dev || !targets.length) return;
    this.reset();
    this.activeCorrection = this.input.correctionFor(dev.bindsId);
    this.phase.set('running');
    const out: CheckResult[] = [];
    for (let i = 0; i < targets.length; i++) {
      this.step.set(i);
      const t = targets[i];
      const accept: CaptureKind[] = t.kind === 'axis' ? ['axis'] : ['button', 'hat'];
      let got: string | null | undefined;
      while (got === undefined) {
        this.abort = new AbortController();
        try {
          const r = await this.input.capture({ accept, modifiers: false, signal: this.abort.signal });
          if (r.device.id !== dev.id) {
            this.message.set(`That was ${r.device.name}. Use ${dev.name} for this check.`);
            continue;
          }
          this.message.set('');
          got = baseKey(r.ref.key);
        } catch (e) {
          if (this.skipping) {
            this.skipping = false;
            got = null;
          } else {
            this.phase.set('idle');
            this.message.set('');
            return;
          }
        }
      }
      out.push({ target: t, got });
      this.results.set([...out]);
      // Let go of the control before the next step.
      await new Promise((res) => setTimeout(res, 350));
    }
    this.phase.set('done');
  }

  protected skip(): void {
    this.skipping = true;
    this.abort?.abort();
  }

  protected cancel(): void {
    this.skipping = false;
    this.abort?.abort();
  }

  protected describe(c: InputCorrection): string {
    const parts: string[] = [];
    if (c.buttonOffset) parts.push(`add ${c.buttonOffset} to button numbers`);
    for (const [k, v] of Object.entries(c.axisMap ?? {})) parts.push(`${k} → ${v}`);
    return parts.join('; ') || 'none';
  }

  protected apply(c: InputCorrection): void {
    const d = this.device();
    if (!d) return;
    this.input.setCorrection(d.bindsId, c);
    this.applied.set(true);
  }
}
