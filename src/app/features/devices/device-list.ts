import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { CatalogService } from '../../core/data/catalog.service';
import { DeviceSummary } from '../../core/data/catalog.types';
import { formatUsb } from '../../core/devices/device-files';
import { LocalDeviceStore } from '../../core/devices/local-device-store.service';
import { BindingsStore } from '../../core/state/bindings-store.service';

export type SourceFilter = 'edrefcard2' | 'edcd' | 'mine';

export const SOURCE_LABELS: Record<string, string> = { edrefcard2: 'EDRefCard 2', edcd: 'EDCD', user: 'Community', mine: 'Mine' };

export function sourceOf(d: DeviceSummary): SourceFilter {
  return d.local ? 'mine' : d.source === 'user' ? 'mine' : d.source;
}

const MAX_IDS = 4;

@Component({
  selector: 'app-device-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule,
    RouterLink,
  ],
  templateUrl: './device-list.html',
  styleUrl: './device-list.scss',
})
export class DeviceList {
  protected readonly catalog = inject(CatalogService);
  private readonly bindings = inject(BindingsStore);
  private readonly local = inject(LocalDeviceStore);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);

  protected readonly maxIds = MAX_IDS;
  protected readonly sourceFilters: SourceFilter[] = ['edrefcard2', 'edcd', 'mine'];
  protected readonly q = signal(readPref('q', ''));
  protected readonly sources = signal<ReadonlySet<SourceFilter>>(new Set());
  protected readonly inFileOnly = signal(false);
  protected readonly artOnly = signal(false);
  protected readonly labels = SOURCE_LABELS;
  protected readonly fmt = formatUsb;

  /** Device ids that handle an ID used in the open bindings file. */
  protected readonly usedIds = computed(() => {
    const out = new Set<string>();
    for (const u of this.bindings.devicesUsed()) {
      const d = this.catalog.deviceFor(u.device, u.deviceIndex);
      if (d) out.add(d.id);
    }
    return out;
  });

  private readonly indexed = computed(() =>
    this.catalog.devices().map((d) => ({
      d,
      source: sourceOf(d),
      text: [d.name, d.id, ...d.ids.flatMap((i) => [i.bindsId, i.usb ? `${i.usb.vid}:${i.usb.pid} ${i.usb.vid}${i.usb.pid}` : ''])]
        .join(' ')
        .toLowerCase(),
    })),
  );

  protected readonly filtered = computed(() => {
    const terms = this.q().toLowerCase().split(/\s+/).filter(Boolean);
    const src = this.sources();
    const used = this.usedIds();
    return this.indexed()
      .filter(
        (x) =>
          (!src.size || src.has(x.source)) &&
          (!this.inFileOnly() || used.has(x.d.id)) &&
          (!this.artOnly() || x.d.images.length > 0) &&
          terms.every((t) => x.text.includes(t)),
      )
      .map((x) => x.d);
  });

  protected readonly counts = computed(() => {
    const c: Record<SourceFilter, number> = { edrefcard2: 0, edcd: 0, mine: 0 };
    for (const x of this.indexed()) c[x.source]++;
    return c;
  });

  protected setQuery(v: string): void {
    this.q.set(v);
    writePref('q', v);
  }

  protected toggleSource(s: SourceFilter): void {
    this.sources.update((set) => {
      const next = new Set(set);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  protected thumb(d: DeviceSummary): string | null {
    return d.images.length ? this.catalog.imageUrl(d, 0) : null;
  }

  protected val(e: Event): string {
    return (e.target as HTMLInputElement).value;
  }

  protected async importZip(e: Event): Promise<void> {
    const el = e.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    try {
      const saved = await this.local.importZip(file);
      this.snack
        .open(`Imported “${saved.definition.name}” into this browser.`, 'Open', { duration: 6000 })
        .onAction()
        .subscribe(() => void this.router.navigate(['/devices', saved.id]));
    } catch (err) {
      this.snack.open((err as Error).message, 'OK', { duration: 8000 });
    }
  }
}

function readPref(key: string, fallback: string): string {
  try {
    return sessionStorage.getItem(`edb.devices.${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string): void {
  try {
    sessionStorage.setItem(`edb.devices.${key}`, value);
  } catch {
    // Not remembered.
  }
}
