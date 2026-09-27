import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSliderModule } from '@angular/material/slider';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Box } from '../../../core/data/catalog.types';
import { MAX_IMAGE_SIDE } from '../../../core/devices/device-files';
import { Point, rectFromPoints } from '../../../core/devices/geometry';
import { DraftImage } from './draft';
import { Adjustment, drawAdjusted, loadHtmlImage, rotatedSize } from './image-tools';

const PREVIEW_SIDE = 1100;

/** Rotate, straighten and crop one image. */
@Component({
  selector: 'app-image-adjust',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatSliderModule, MatTooltipModule],
  styleUrls: ['./step-common.scss'],
  styles: `
    .panel {
      margin-top: 16px;
    }
    .stage {
      position: relative;
      max-width: 100%;
      margin: 8px auto;
      width: fit-content;
      background: repeating-conic-gradient(var(--mat-sys-surface-container-high) 0 25%, transparent 0 50%) 0 0 / 16px 16px;
    }
    canvas {
      display: block;
      max-width: 100%;
      max-height: 60vh;
    }
    svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      cursor: crosshair;
      touch-action: none;
    }
    .shade {
      fill: rgba(0, 0, 0, 0.5);
      fill-rule: evenodd;
    }
    .crop {
      fill: none;
      stroke: var(--edb-accent);
      stroke-dasharray: 6 4;
    }
    mat-slider {
      width: 220px;
    }
  `,
  template: `
    <div class="panel">
      <h2><mat-icon>crop_rotate</mat-icon>Rotate and crop</h2>
      <div class="row">
        <button matIconButton type="button" (click)="turn(-90)" matTooltip="Rotate left" aria-label="Rotate left"><mat-icon>rotate_left</mat-icon></button>
        <button matIconButton type="button" (click)="turn(90)" matTooltip="Rotate right" aria-label="Rotate right"><mat-icon>rotate_right</mat-icon></button>
        <span class="hint">Straighten</span>
        <mat-slider min="-10" max="10" step="0.25" discrete>
          <input matSliderThumb [value]="straighten()" (valueChange)="setStraighten($event)" aria-label="Straighten (degrees)" />
        </mat-slider>
        <span class="mono">{{ straighten() }}°</span>
        <button matButton type="button" (click)="crop.set(null)" [disabled]="!crop()">Clear crop</button>
      </div>
      <p class="hint">Drag on the image to choose the crop area. Output: {{ outSize().width }} × {{ outSize().height }} px, WebP.</p>
      <div class="stage">
        <canvas #canvas></canvas>
        <svg
          [attr.viewBox]="'0 0 ' + rot().width + ' ' + rot().height"
          preserveAspectRatio="none"
          (pointerdown)="down($event)"
          (pointermove)="move($event)"
          (pointerup)="up($event)"
          (pointercancel)="up($event)"
        >
          @if (crop(); as c) {
            <path class="shade" [attr.d]="shadePath(c)" />
            <rect class="crop" [attr.x]="c.x" [attr.y]="c.y" [attr.width]="c.w" [attr.height]="c.h" [attr.stroke-width]="strokeWidth()" />
          }
        </svg>
      </div>
      <div class="row">
        <span class="spacer"></span>
        <button matButton type="button" (click)="cancel.emit()">Cancel</button>
        <button matButton="filled" type="button" (click)="done()" [disabled]="!changed()">Apply</button>
      </div>
    </div>
  `,
})
export class ImageAdjust {
  readonly image = input.required<DraftImage>();
  readonly url = input.required<string>();
  readonly apply = output<Adjustment>();
  readonly cancel = output<void>();

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  protected readonly rotate = signal<Adjustment['rotate']>(0);
  protected readonly straighten = signal(0);
  protected readonly crop = signal<Box | null>(null);
  private readonly source = signal<HTMLImageElement | null>(null);
  private dragStart: Point | null = null;

  protected readonly rot = computed(() => rotatedSize(this.image().width, this.image().height, this.rotate() + this.straighten()));
  protected readonly outSize = computed(() => {
    const c = this.crop() ?? { w: this.rot().width, h: this.rot().height };
    const s = Math.min(1, MAX_IMAGE_SIDE / Math.max(c.w, c.h));
    return { width: Math.round(c.w * s), height: Math.round(c.h * s) };
  });
  protected readonly changed = computed(() => this.rotate() !== 0 || this.straighten() !== 0 || !!this.crop());
  protected readonly strokeWidth = computed(() => Math.max(this.rot().width, this.rot().height) / 400);

  constructor() {
    effect(() => {
      const url = this.url();
      void loadHtmlImage(url).then((img) => this.source.set(img));
    });
    effect(() => {
      const img = this.source();
      if (!img) return;
      const { width, height } = this.image();
      const preview = drawAdjusted(img, width, height, { rotate: this.rotate(), straighten: this.straighten(), crop: null }, PREVIEW_SIDE);
      const c = this.canvas().nativeElement;
      c.width = preview.width;
      c.height = preview.height;
      c.getContext('2d')!.drawImage(preview, 0, 0);
    });
  }

  protected turn(deg: number): void {
    this.rotate.update((r) => ((((r + deg) % 360) + 360) % 360) as Adjustment['rotate']);
    this.crop.set(null);
  }

  protected setStraighten(v: number): void {
    this.straighten.set(v);
    this.crop.set(null);
  }

  protected shadePath(c: Box): string {
    const { width: w, height: h } = this.rot();
    return `M0 0H${w}V${h}H0Z M${c.x} ${c.y}V${c.y + c.h}H${c.x + c.w}V${c.y}Z`;
  }

  private point(e: PointerEvent): Point {
    const svg = e.currentTarget as SVGSVGElement;
    const r = svg.getBoundingClientRect();
    const { width, height } = this.rot();
    return {
      x: Math.min(width, Math.max(0, ((e.clientX - r.left) / r.width) * width)),
      y: Math.min(height, Math.max(0, ((e.clientY - r.top) / r.height) * height)),
    };
  }

  protected down(e: PointerEvent): void {
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    this.dragStart = this.point(e);
  }

  protected move(e: PointerEvent): void {
    if (!this.dragStart) return;
    const r = rectFromPoints(this.dragStart, this.point(e));
    if (r.w > 4 && r.h > 4) this.crop.set({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });
  }

  protected up(e: PointerEvent): void {
    if (!this.dragStart) return;
    this.move(e);
    this.dragStart = null;
  }

  protected done(): void {
    this.apply.emit({ rotate: this.rotate(), straighten: this.straighten(), crop: this.crop() });
  }
}
