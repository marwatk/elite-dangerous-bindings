import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { InputRef, inputId, sameInput } from '../../core/binds/binds-document';
import { boundUses, usesByInput } from '../../core/binds/analysis';
import { CatalogService } from '../../core/data/catalog.service';
import { InputService } from '../../core/input/input.service';
import { InputEvent, LiveDevice } from '../../core/input/input.types';
import { BindingsStore } from '../../core/state/bindings-store.service';
import { InputLabelPipe } from '../../shared/input-label.pipe';
import { LiveDeviceCard } from './live-device-card';
import { NumberingWizard } from './numbering-wizard';

interface LogEntry {
  n: number;
  time: string;
  device: string;
  key: string;
  kind: string;
  text: string;
}

interface LastPress {
  ref: InputRef;
  device: LiveDevice;
  axis: boolean;
  /** Other controls held at the moment of the press. */
  held: InputRef[];
}

@Component({
  selector: 'app-live-page',
  imports: [
    MatButtonModule,
    MatCardModule,
    MatExpansionModule,
    MatIconModule,
    MatTooltipModule,
    RouterLink,
    InputLabelPipe,
    LiveDeviceCard,
    NumberingWizard,
  ],
  templateUrl: './live-page.html',
  styleUrl: './live-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LivePage implements OnInit {
  protected readonly input = inject(InputService);
  protected readonly store = inject(BindingsStore);
  private readonly catalog = inject(CatalogService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly secure = typeof window === 'undefined' || window.isSecureContext;
  protected readonly requesting = signal(false);
  protected readonly requestError = signal('');
  protected readonly log = signal<LogEntry[]>([]);
  protected readonly lastPress = signal<LastPress | null>(null);
  private logCount = 0;
  private readonly axisState = new Map<string, boolean>();

  protected readonly devices = computed(() => this.input.devices());
  protected readonly connected = computed(() => this.devices().filter((d) => d.connected));

  /** Devices the open file binds that aren't connected (keyboard and mouse aside). */
  protected readonly missing = computed(() => {
    const live = this.devices().filter((d) => d.connected);
    return this.store
      .devicesUsed()
      .filter((u) => u.device !== 'Keyboard' && u.device !== 'Mouse')
      .filter((u) => !live.some((d) => d.bindsId === u.device && d.deviceIndex === u.deviceIndex))
      .map((u) => ({ ...u, name: this.catalog.deviceName(u.device, u.deviceIndex) }));
  });

  protected readonly diagnostics = computed(() => {
    const diag = this.input.diagnostics();
    return this.devices().map((d) => ({ device: d, diag: diag.get(d.id) }));
  });

  /** "What does this do?" for the last pressed control. */
  protected readonly what = computed(() => {
    const lp = this.lastPress();
    if (!lp || !this.store.isOpen()) return null;
    const actions = this.store.actions();
    const byInput = usesByInput(actions);
    const keys = lp.axis ? [lp.ref.key, `Pos_${lp.ref.key}`, `Neg_${lp.ref.key}`] : [lp.ref.key];
    const heldIds = new Set(lp.held.map(inputId));
    const direct = keys
      .flatMap((key) => byInput.get(inputId({ ...lp.ref, key })) ?? [])
      .map((u) => {
        const info = this.catalog.action(u.code);
        const active = u.binding.modifiers.every((m) => heldIds.has(inputId(m)));
        return {
          code: u.code,
          name: info.longName,
          group: info.group,
          slot: u.slot,
          key: u.binding.key,
          modifiers: u.binding.modifiers,
          active,
          hold: u.binding.hold,
        };
      })
      .sort((a, b) => Number(b.active) - Number(a.active) || a.modifiers.length - b.modifiers.length);
    const asModifier = boundUses(actions)
      .filter((u) => u.binding.modifiers.some((m) => sameInput(m, lp.ref)))
      .map((u) => ({ code: u.code, name: this.catalog.action(u.code).longName, binding: u.binding }));
    return { direct, asModifier };
  });

  ngOnInit(): void {
    this.input.start();
    const sub = this.input.events.subscribe((e) => this.onEvent(e));
    this.destroyRef.onDestroy(() => {
      sub.unsubscribe();
      this.input.stop();
    });
  }

  protected async addControllers(): Promise<void> {
    this.requesting.set(true);
    this.requestError.set('');
    try {
      await this.input.requestHidDevices();
    } catch (e) {
      const err = e as DOMException;
      if (err?.name !== 'NotFoundError' && err?.name !== 'AbortError') this.requestError.set(err?.message ?? String(e));
    } finally {
      this.requesting.set(false);
    }
  }

  protected clearLog(): void {
    this.log.set([]);
  }

  protected modifierText(mods: InputRef[]): string {
    return mods.map((m) => this.catalog.inputLabel(m)).join(' + ');
  }

  private onEvent(e: InputEvent): void {
    const id = inputId(e.ref);
    if (e.kind === 'axis') {
      const was = this.axisState.get(id) ?? false;
      if (was === e.pressed) return;
      this.axisState.set(id, e.pressed);
      if (!e.pressed) return;
    }
    if (e.pressed) {
      const held = this.input.heldNow().filter((r) => inputId(r) !== id);
      this.lastPress.set({ ref: e.ref, device: e.device, axis: e.kind === 'axis', held });
    }
    const t = new Date();
    const time = `${t.toLocaleTimeString([], { hour12: false })}.${String(t.getMilliseconds()).padStart(3, '0')}`;
    const text =
      e.kind === 'axis'
        ? `moved ${e.value >= 0 ? '+' : ''}${e.value.toFixed(2)}`
        : e.pressed
          ? 'pressed'
          : 'released';
    const entry: LogEntry = {
      n: ++this.logCount,
      time,
      device: e.device.backend === 'keyboard' ? 'Keyboard' : `${e.device.name} (${e.ref.device}${e.ref.deviceIndex ? ` #${e.ref.deviceIndex}` : ''})`,
      key: e.ref.key,
      kind: e.kind,
      text,
    };
    this.log.update((l) => [entry, ...l].slice(0, 50));
  }
}
