import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Box } from '../../../core/data/catalog.types';
import { EditorStore } from './editor-store';
import { ImageAdjust } from './image-adjust';
import { ACCEPTED_IMAGES, Adjustment, adjustBox, adjustImage, loadImageFile } from './image-tools';

@Component({
  selector: 'app-step-image',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, MatProgressSpinnerModule, ImageAdjust],
  styleUrls: ['./step-common.scss'],
  styles: `
    .drop {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 32px 16px;
      border: 2px dashed var(--edb-border);
      border-radius: 12px;
      text-align: center;
      transition: background 120ms, border-color 120ms;
      mat-icon {
        font-size: 40px;
        width: 40px;
        height: 40px;
        color: var(--edb-accent);
      }
      &.over {
        border-color: var(--edb-accent);
        background: var(--edb-accent-soft);
      }
    }
    .images {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
      gap: 16px;
      margin-top: 16px;
    }
    .img-card {
      border: 1px solid var(--edb-border);
      border-radius: 12px;
      overflow: hidden;
      background: var(--mat-sys-surface-container-low);
      img {
        display: block;
        width: 100%;
        aspect-ratio: 16 / 9;
        object-fit: contain;
        background: #fff;
      }
      .meta {
        padding: 8px 12px 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .row {
        flex-wrap: nowrap;
        gap: 0;
        padding: 0 4px 4px 4px;
      }
    }
  `,
  template: `
    <p class="intro">
      Upload a photo, render or diagram of the controller. Use several images for multi-part devices (stick and throttle,
      front and back). Straighten and crop it here; images are saved as WebP, at most 3840 px on the longest side. Only use
      images you have the right to share, such as your own photo.
    </p>

    <div
      class="drop"
      data-own-drop
      [class.over]="over()"
      (dragover)="onDragOver($event)"
      (dragleave)="over.set(false)"
      (drop)="onDrop($event)"
    >
      <mat-icon>add_photo_alternate</mat-icon>
      <div>Drop images here</div>
      <button matButton="filled" type="button" (click)="fileInput.click()"><mat-icon>upload</mat-icon>Choose images…</button>
      <span class="hint">PNG, JPG, WebP or SVG</span>
      <input #fileInput type="file" multiple hidden [accept]="accept" (change)="onPick($event)" data-testid="image-input" />
      @if (busy()) {
        <mat-spinner diameter="28" />
      }
    </div>

    @if (adjusting() !== null) {
      @if (store.draft().images[adjusting()!]; as img) {
        <app-image-adjust [image]="img" [url]="store.urlFor(img.blob)!" (apply)="applyAdjust(adjusting()!, $event)" (cancel)="adjusting.set(null)" />
      }
    }

    <div class="images">
      @for (img of store.draft().images; track img.uid; let i = $index; let first = $first; let last = $last) {
        <div class="img-card">
          <img [src]="store.urlFor(img.blob)" [alt]="img.name" />
          <div class="meta">
            <strong>{{ i + 1 }}.</strong> {{ store.fileNames()[i] }}
            <div class="hint">{{ img.width }} × {{ img.height }} px · {{ img.type.toUpperCase() }} · {{ boxCount(i) }} boxes</div>
          </div>
          <div class="row">
            <button matButton type="button" (click)="adjusting.set(i)"><mat-icon>crop_rotate</mat-icon>Rotate / crop</button>
            <span class="spacer"></span>
            <button matIconButton type="button" [disabled]="first" (click)="store.moveImage(i, -1)" matTooltip="Move earlier" aria-label="Move earlier">
              <mat-icon>arrow_back</mat-icon>
            </button>
            <button matIconButton type="button" [disabled]="last" (click)="store.moveImage(i, 1)" matTooltip="Move later" aria-label="Move later">
              <mat-icon>arrow_forward</mat-icon>
            </button>
            <button matIconButton type="button" (click)="remove(i)" matTooltip="Remove image" aria-label="Remove image">
              <mat-icon>delete</mat-icon>
            </button>
          </div>
        </div>
      }
    </div>
  `,
})
export class StepImage {
  protected readonly store = inject(EditorStore);
  private readonly snack = inject(MatSnackBar);
  protected readonly accept = ACCEPTED_IMAGES;
  protected readonly over = signal(false);
  protected readonly busy = signal(false);
  protected readonly adjusting = signal<number | null>(null);

  protected boxCount(i: number): number {
    return this.store.draft().controls.filter((c) => c.box && (c.image ?? 0) === i).length;
  }

  protected onDragOver(e: DragEvent): void {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    this.over.set(true);
  }

  protected onDrop(e: DragEvent): void {
    e.preventDefault();
    e.stopPropagation();
    this.over.set(false);
    void this.add(Array.from(e.dataTransfer?.files ?? []));
  }

  protected onPick(e: Event): void {
    const el = e.target as HTMLInputElement;
    const files = Array.from(el.files ?? []);
    el.value = '';
    void this.add(files);
  }

  private async add(files: File[]): Promise<void> {
    if (!files.length) return;
    this.busy.set(true);
    const added = [];
    for (const f of files) {
      try {
        added.push(await loadImageFile(f));
      } catch (e) {
        this.snack.open((e as Error).message, 'OK', { duration: 6000 });
      }
    }
    this.busy.set(false);
    if (added.length) {
      const first = this.store.draft().images.length;
      this.store.addImages(added);
      this.store.imageIndex.set(first);
    }
  }

  protected remove(i: number): void {
    const n = this.boxCount(i);
    if (n && !confirm(`Remove this image and the ${n} boxes placed on it?`)) return;
    this.store.removeImage(i);
    if (this.adjusting() !== null) this.adjusting.set(null);
  }

  protected async applyAdjust(i: number, adj: Adjustment): Promise<void> {
    const img = this.store.draft().images[i];
    this.busy.set(true);
    try {
      const out = await adjustImage(img, adj);
      const boxes = new Map<string, Box>();
      for (const c of this.store.draft().controls) {
        if (c.box && (c.image ?? 0) === i) boxes.set(c.uid, adjustBox(c.box, img, adj));
      }
      this.store.replaceImage(i, out, boxes);
      this.adjusting.set(null);
    } catch (e) {
      this.snack.open((e as Error).message, 'OK', { duration: 6000 });
    } finally {
      this.busy.set(false);
    }
  }
}
