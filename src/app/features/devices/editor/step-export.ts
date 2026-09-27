import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { buildButtonMapExport, buildDeviceZip, controlsForBindsId, deviceJson } from '../../../core/devices/device-files';
import { LocalDeviceStore } from '../../../core/devices/local-device-store.service';
import { downloadBlob } from '../download';
import { draftToDefinition, drawsBoxes, imageFileNames } from './draft';
import { EditorStore } from './editor-store';

@Component({
  selector: 'app-step-export',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatSlideToggleModule],
  styleUrls: ['./step-common.scss'],
  styles: `
    .tree {
      margin: 0;
      padding: 12px 16px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container);
      font-family: var(--edb-mono);
      font-size: 0.85rem;
      line-height: 1.6;
      overflow-x: auto;
      white-space: pre;
    }
    .actions {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
    }
    .blocked {
      color: var(--edb-danger);
    }
  `,
  template: `
    <p class="intro">
      Download a <code>.zip</code> laid out like the repository, ready for a pull request, or save the device in this browser
      to use it straight away (reference cards, live input, the bindings table).
    </p>
    @if (errors().length) {
      <p class="blocked">
        <mat-icon inline>error</mat-icon> Fix {{ errors().length }} error{{ errors().length === 1 ? '' : 's' }} first:
        {{ errors()[0].message }}
        <button matButton type="button" (click)="store.step.set('check')">Show all</button>
      </p>
    }
    <div class="cols">
      <div class="panel">
        <h2><mat-icon>folder_zip</mat-icon>{{ zipName() }}</h2>
        <pre class="tree">{{ tree() }}</pre>
        <mat-slide-toggle [checked]="drawBoxes()" (change)="store.setDrawBoxes($event.checked)" data-testid="draw-boxes">Draw box outlines on cards</mat-slide-toggle>
        <p class="hint">Turn off if your artwork already has boxes printed on it.</p>
        <p class="hint">
          Only include images you have the right to share (e.g. your own photo). CONTRIBUTING-DEVICE.md explains how to open the
          pull request and how to offer the <code>.buttonMap</code> to EDCD's EliteCustomButtonNames.
        </p>
      </div>
      <div class="panel actions">
        <h2><mat-icon>ios_share</mat-icon>Export</h2>
        <button matButton="filled" type="button" (click)="downloadZip()" [disabled]="busy() || errors().length > 0" data-testid="download-zip">
          <mat-icon>download</mat-icon>Download .zip
        </button>
        <button matButton="tonal" type="button" (click)="save()" [disabled]="busy() || errors().length > 0">
          <mat-icon>save</mat-icon>Save to this browser
        </button>
        @if (!local.persistent()) {
          <span class="hint">This browser can't store data permanently (private window?): saved devices last until you close it.</span>
        }
        <button matButton type="button" (click)="downloadJson()" [disabled]="busy()"><mat-icon>data_object</mat-icon>Download device.json only</button>
        <button matButton type="button" (click)="downloadButtonMaps()" [disabled]="busy()"><mat-icon>label</mat-icon>Download .buttonMap</button>
        <button matButton type="button" (click)="zipInput.click()"><mat-icon>upload_file</mat-icon>Import .zip into the editor…</button>
        <input #zipInput type="file" accept=".zip,application/zip" hidden (change)="importZip($event)" />
      </div>
    </div>
  `,
})
export class StepExport {
  protected readonly store = inject(EditorStore);
  protected readonly local = inject(LocalDeviceStore);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);
  protected readonly busy = signal(false);

  protected readonly errors = computed(() => this.store.issues().filter((i) => i.level === 'error'));
  protected readonly drawBoxes = computed(() => drawsBoxes(this.store.draft()));
  protected readonly zipName = computed(() => `${this.store.draft().id || 'device'}.zip`);
  protected readonly tree = computed(() => {
    const def = this.store.definition();
    const id = def.id || '<id>';
    const lines = ['devices/', `  ${id}/`, '    device.json'];
    for (const img of def.images) lines.push(`    ${img.file}  (${img.width}×${img.height})`);
    const maps = [...new Set(def.ids.map((i) => i.bindsId))].filter((b) => controlsForBindsId(def, b).length);
    if (maps.length) {
      lines.push('buttonmaps/');
      for (const b of maps) lines.push(`  ${b}.buttonMap`);
    }
    lines.push('CONTRIBUTING-DEVICE.md');
    return lines.join('\n');
  });

  /** device.json and images as exported: each image drawn on its canvas, boxes moved to match. */
  private async files() {
    const d = await this.store.materialize();
    const names = imageFileNames(d);
    return { def: draftToDefinition(d), images: d.images.map((img, i) => ({ file: names[i], blob: img.blob })) };
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await fn();
    } catch (e) {
      this.snack.open((e as Error).message, 'OK', { duration: 8000 });
    } finally {
      this.busy.set(false);
    }
  }

  protected downloadZip(): Promise<void> {
    return this.run(async () => {
      const { def, images } = await this.files();
      downloadBlob(await buildDeviceZip(def, images), this.zipName());
    });
  }

  protected downloadJson(): Promise<void> {
    return this.run(async () => {
      const { def } = await this.files();
      downloadBlob(new Blob([deviceJson(def)], { type: 'application/json' }), 'device.json');
    });
  }

  protected downloadButtonMaps(): Promise<void> {
    return this.run(async () => {
      const out = await buildButtonMapExport(this.store.definition());
      if (out) downloadBlob(out.blob, out.filename);
      else this.snack.open('No labelled controls to export.', undefined, { duration: 3000 });
    });
  }

  protected save(): Promise<void> {
    return this.run(async () => {
      const { def, images } = await this.files();
      await this.local.save(def, images.map((i) => i.blob));
      const isNew = !this.store.draft().baseId;
      if (isNew) {
        await this.store.clearDraft();
        this.snack.open(`Saved “${def.name}” in this browser.`, undefined, { duration: 4000 });
        await this.router.navigate(['/devices', def.id]);
      } else {
        this.snack
          .open(`Saved “${def.name}” in this browser.`, 'View', { duration: 5000 })
          .onAction()
          .subscribe(() => void this.router.navigate(['/devices', def.id]));
      }
    });
  }

  protected importZip(e: Event): Promise<void> {
    const el = e.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (!file) return Promise.resolve();
    return this.run(async () => {
      await this.store.importZip(file);
      this.snack.open(`Imported ${file.name}`, undefined, { duration: 3000 });
    });
  }
}
