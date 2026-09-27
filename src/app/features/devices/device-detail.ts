import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { CatalogService } from '../../core/data/catalog.service';
import { DeviceDefinition } from '../../core/data/catalog.types';
import { DEVICE_BUTTON_MAPS_DIR, buildButtonMapExport, deviceJson, formatUsb } from '../../core/devices/device-files';
import { LocalDeviceStore } from '../../core/devices/local-device-store.service';
import { BindingsStore } from '../../core/state/bindings-store.service';
import { DeviceDiagram, controlKey } from '../../shared/device-diagram';
import { SOURCE_LABELS } from './device-list';
import { downloadBlob } from './download';

type ViewMode = 'labels' | 'keys' | 'boxes';

@Component({
  selector: 'app-device-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatTooltipModule,
    RouterLink,
    DeviceDiagram,
  ],
  templateUrl: './device-detail.html',
  styleUrl: './device-detail.scss',
})
export class DeviceDetail {
  protected readonly catalog = inject(CatalogService);
  private readonly local = inject(LocalDeviceStore);
  private readonly bindings = inject(BindingsStore);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);

  protected readonly id = toSignal(inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('id') ?? '')), { initialValue: '' });
  protected readonly definition = signal<DeviceDefinition | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly mode = signal<ViewMode>('labels');
  protected readonly imageIndex = signal(0);
  protected readonly labels = SOURCE_LABELS;
  protected readonly fmt = formatUsb;

  protected readonly summary = computed(() => this.catalog.deviceById(this.id()));
  protected readonly isLocal = computed(() => !!this.summary()?.local);
  protected readonly diagramLabels = computed(() => {
    const def = this.definition();
    if (!def || this.mode() !== 'keys') return null;
    return new Map(def.controls.map((c) => [controlKey(c.bindsId, c.key), c.key]));
  });
  protected readonly used = computed(() => new Set(this.bindings.devicesUsed().map((u) => u.device)));
  protected readonly placed = computed(() => {
    const def = this.definition();
    return (def?.controls.filter((c) => c.box).length ?? 0) + (def?.groups ?? []).reduce((n, g) => n + g.members.length, 0);
  });
  /** Group label of a grouped control ("H1 ↑"), for the controls table. */
  protected groupOf(c: { bindsId: string; key: string; deviceIndex?: number }): string {
    for (const g of this.definition()?.groups ?? []) {
      const m = g.members.find((x) => x.bindsId === c.bindsId && x.key === c.key && x.deviceIndex === c.deviceIndex);
      if (m) return `${g.label} ${m.marker}`;
    }
    return '';
  }
  protected readonly highlight = signal<ReadonlySet<string>>(new Set());

  constructor() {
    // (Re)load when the id changes or the local copy is replaced.
    effect(() => {
      const id = this.id();
      const s = this.summary();
      const local = this.catalog.localDevice(id);
      if (!this.catalog.loaded()) return;
      this.imageIndex.set(0);
      if (!s) {
        this.definition.set(null);
        this.error.set(`No device “${id}”.`);
        return;
      }
      this.error.set(null);
      if (local) {
        this.definition.set(local.definition);
        return;
      }
      this.catalog.loadDevice(id).then(
        (d) => this.definition.set(d),
        (e: Error) => this.error.set(e.message),
      );
    });
  }

  protected highlightRow(bindsId: string, key: string): void {
    this.highlight.set(new Set([controlKey(bindsId, key)]));
  }

  protected clearHighlight(): void {
    this.highlight.set(new Set());
  }

  protected async exportButtonMaps(): Promise<void> {
    const def = this.definition();
    if (!def) return;
    const out = await buildButtonMapExport(def);
    if (!out) {
      this.snack.open('This device has no labelled controls.', undefined, { duration: 3000 });
      return;
    }
    downloadBlob(out.blob, out.filename);
    const what = out.filename.endsWith('.zip') ? 'the .buttonMap files from the zip' : out.filename;
    this.snack
      .open(`To see these names in the game, copy ${what} to ${DEVICE_BUTTON_MAPS_DIR} (keep the file names) and reopen Options › Controls.`, 'Copy folder path', {
        duration: 15_000,
      })
      .onAction()
      .subscribe(() => void navigator.clipboard?.writeText(DEVICE_BUTTON_MAPS_DIR));
  }

  protected downloadJson(): void {
    const def = this.definition();
    if (def) downloadBlob(new Blob([deviceJson(def)], { type: 'application/json' }), 'device.json');
  }

  protected async exportZip(): Promise<void> {
    try {
      downloadBlob(await this.local.exportZip(this.id()), `${this.id()}.zip`);
    } catch (e) {
      this.snack.open((e as Error).message, 'OK', { duration: 6000 });
    }
  }

  protected async remove(): Promise<void> {
    const def = this.definition();
    if (!def || !confirm(`Delete “${def.name}” from this browser? Export it as a .zip first if you want to keep it.`)) return;
    await this.local.delete(def.id);
    this.snack.open(`Deleted “${def.name}”.`, undefined, { duration: 3000 });
    if (!this.catalog.deviceById(def.id)) await this.router.navigate(['/devices']);
  }
}
