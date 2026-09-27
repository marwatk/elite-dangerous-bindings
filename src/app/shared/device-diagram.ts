import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { CatalogService } from '../core/data/catalog.service';
import { DeviceControl, DeviceDefinition } from '../core/data/catalog.types';

/** Key used to address a control: `bindsId::key` (axis halves map to their axis). */
export function controlKey(bindsId: string, key: string): string {
  return `${bindsId}::${key.replace(/^(Pos|Neg)_/, '')}`;
}

/**
 * A device image with its control boxes drawn on top, as scalable SVG.
 * Used by live input (highlighting), device browser (layout check) and others.
 */
@Component({
  selector: 'app-device-diagram',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (image(); as img) {
      <svg
        [attr.viewBox]="'0 0 ' + img.width + ' ' + img.height"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        [attr.aria-label]="device().name"
      >
        @if (url(); as href) {
          <image [attr.href]="href" x="0" y="0" [attr.width]="img.width" [attr.height]="img.height" />
        }
        @for (c of boxed(); track $index) {
          <g
            class="control"
            [class.hl]="highlight().has(key(c))"
            [class.dim]="dimUnlabelled() && !labels()?.get(key(c))"
            [class.clickable]="clickable()"
            (click)="controlClick.emit(c)"
          >
            <title>{{ c.label }} ({{ c.key }})</title>
            <rect [attr.x]="c.box!.x" [attr.y]="c.box!.y" [attr.width]="c.box!.w" [attr.height]="c.box!.h" rx="6" />
            @if (showText()) {
              <foreignObject [attr.x]="c.box!.x" [attr.y]="c.box!.y" [attr.width]="c.box!.w" [attr.height]="c.box!.h">
                <div class="txt" [style.font-size.px]="fontSize(c)">{{ labels()?.get(key(c)) ?? c.label }}</div>
              </foreignObject>
            }
          </g>
        }
      </svg>
    } @else {
      <div class="noimg muted">No artwork for {{ device().name }}</div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    svg {
      display: block;
      width: 100%;
      height: auto;
      background: #fff;
      border-radius: 8px;
    }
    .control rect {
      fill: rgba(255, 140, 13, 0.08);
      stroke: rgba(255, 140, 13, 0.55);
      stroke-width: 3;
      transition: fill 80ms;
    }
    .control.dim rect {
      fill: none;
      stroke: rgba(0, 0, 0, 0.12);
    }
    .control.hl rect {
      fill: rgba(255, 140, 13, 0.85);
      stroke: #b35400;
    }
    .control.clickable {
      cursor: pointer;
    }
    .control.clickable:hover rect {
      fill: rgba(255, 140, 13, 0.35);
    }
    .txt {
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      padding: 0 8px;
      display: flex;
      align-items: center;
      overflow: hidden;
      color: #111;
      font-family: 'Exo 2', Roboto, sans-serif;
      line-height: 1.05;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .noimg {
      padding: 24px;
      text-align: center;
      border: 1px dashed var(--edb-border);
      border-radius: 8px;
    }
  `,
})
export class DeviceDiagram {
  private readonly catalog = inject(CatalogService);

  readonly device = input.required<DeviceDefinition>();
  readonly imageIndex = input(0);
  /** controlKey()s to highlight. */
  readonly highlight = input<ReadonlySet<string>>(new Set());
  /** Text to show per controlKey(); defaults to the control's label. */
  readonly labels = input<ReadonlyMap<string, string> | null>(null);
  readonly showText = input(true);
  readonly clickable = input(false);
  /** Fade boxes that have no entry in `labels`. */
  readonly dimUnlabelled = input(false);
  /** Image URL override (e.g. an unsaved draft's object URL); defaults to the catalogue's. */
  readonly imageHref = input<string | null>(null);
  readonly controlClick = output<DeviceControl>();

  protected readonly image = computed(() => this.device().images[this.imageIndex()] ?? null);
  protected readonly url = computed(() => this.imageHref() ?? this.catalog.imageUrl(this.device(), this.imageIndex()));
  protected readonly boxed = computed(() => {
    const idx = this.imageIndex();
    // One box per position: hide axis halves that share their axis's box.
    const seen = new Set<string>();
    return this.device().controls.filter((c) => {
      if (!c.box || (c.image ?? 0) !== idx) return false;
      const pos = `${c.box.x},${c.box.y},${c.box.w},${c.box.h}`;
      if (seen.has(pos)) return false;
      seen.add(pos);
      return true;
    });
  });

  protected key(c: DeviceControl): string {
    return controlKey(c.bindsId, c.key);
  }

  protected fontSize(c: DeviceControl): number {
    return Math.max(14, Math.min(40, c.box!.h * 0.62));
  }
}
