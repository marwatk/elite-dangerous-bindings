import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { CatalogService } from '../core/data/catalog.service';
import { Box, DeviceControl, DeviceDefinition, ImagePoint } from '../core/data/catalog.types';
import { GroupCell, groupDividers, groupLayout } from '../core/devices/group-layout';
import { leaderPath, pathData } from '../core/devices/leader';
import { MarkerSymbol, markerSymbol, markerTransform } from '../core/devices/markers';

interface DiagramMember extends GroupCell {
  control: DeviceControl | undefined;
  ckey: string;
  symbol: MarkerSymbol | null;
  symbolTransform: string;
  /** The control's own name, unless it is just "<group> <marker>". */
  name: string;
}

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
        @for (l of leaders(); track $index) {
          <g class="leader" [class.hl]="l.keys.some(inHighlight)" [class.dim]="dimUnlabelled() && !l.keys.some(hasLabel)">
            <path [attr.d]="l.d" />
            <circle [attr.cx]="l.anchor.x" [attr.cy]="l.anchor.y" [attr.r]="dotRadius()" />
          </g>
        }
        @for (g of groups(); track g.id) {
          <g class="group" [attr.data-group]="g.id">
            <rect class="group-box" [attr.x]="g.box.x" [attr.y]="g.box.y" [attr.width]="g.box.w" [attr.height]="g.box.h" rx="6" />
            @for (m of g.members; track m.index) {
              <g
                class="control member"
                [attr.data-key]="m.key"
                [class.hl]="highlight().has(m.ckey)"
                [class.dim]="dimUnlabelled() && !labels()?.get(m.ckey)"
                [class.clickable]="clickable()"
                (click)="m.control && controlClick.emit(m.control)"
              >
                <title>{{ g.label }} {{ m.marker }}{{ m.control ? ' (' + m.key + ')' : '' }}</title>
                <rect [attr.x]="m.rect.x" [attr.y]="m.rect.y" [attr.width]="m.rect.w" [attr.height]="m.rect.h" />
                @if (m.symbol; as sym) {
                  <g [attr.transform]="m.symbolTransform">
                    <path class="marker" [class.filled]="sym.fill" [attr.d]="sym.d" [attr.transform]="sym.transform ?? null" />
                  </g>
                } @else {
                  <foreignObject [attr.x]="m.markerRect.x" [attr.y]="m.markerRect.y" [attr.width]="m.markerRect.w" [attr.height]="m.markerRect.h">
                    <div class="txt marker-txt" [style.font-size.px]="m.markerRect.h * 0.5">{{ m.marker }}</div>
                  </foreignObject>
                }
                @if (showText()) {
                  <foreignObject [attr.x]="m.textRect.x" [attr.y]="m.textRect.y" [attr.width]="m.textRect.w" [attr.height]="m.textRect.h">
                    <div class="txt" [style.font-size.px]="fontSizeFor(m.textRect)">{{ labels() ? (labels()!.get(m.ckey) ?? '') : m.name }}</div>
                  </foreignObject>
                }
              </g>
            }
            <path class="dividers" [attr.d]="g.dividers" />
            @if (g.labelRect; as l) {
              <text class="group-label" [attr.transform]="'translate(' + (l.x + l.w / 2) + ' ' + (l.y + l.h / 2) + ') rotate(-90)'" [attr.font-size]="g.labelSize">
                {{ g.label }}
              </text>
            }
          </g>
        }
        @for (c of boxed(); track $index) {
          <g
            class="control"
            [class.outlined]="device().drawBoxes"
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
    .leader {
      pointer-events: none;
      path {
        fill: none;
        stroke: var(--edb-accent);
        stroke-width: 2;
        stroke-linejoin: round;
        stroke-linecap: round;
        vector-effect: non-scaling-stroke;
        opacity: 0.85;
      }
      circle {
        fill: var(--edb-accent);
        stroke: #fff;
        stroke-width: 1.5;
        vector-effect: non-scaling-stroke;
      }
      &.dim {
        opacity: 0.35;
      }
      &.hl path {
        stroke-width: 3.5;
        opacity: 1;
      }
    }
    .control rect {
      fill: rgba(255, 140, 13, 0.08);
      stroke: rgba(255, 140, 13, 0.55);
      stroke-width: 3;
      transition: fill 80ms;
    }
    .control.outlined rect,
    .group-box {
      fill: rgba(255, 255, 255, 0.78);
      stroke: #2b2b2b;
      stroke-width: 2.5;
    }
    .group .member rect {
      fill: transparent;
      stroke: none;
    }
    .group .member.hl rect {
      fill: rgba(255, 140, 13, 0.85);
    }
    .group .member.clickable:hover rect {
      fill: rgba(255, 140, 13, 0.35);
    }
    .dividers {
      fill: none;
      stroke: rgba(43, 43, 43, 0.55);
      stroke-width: 1.5;
      pointer-events: none;
    }
    .marker {
      fill: none;
      stroke: #111;
      stroke-width: 2.4;
      stroke-linecap: round;
      stroke-linejoin: round;
      &.filled {
        fill: #111;
        stroke: none;
      }
    }
    .marker-txt {
      justify-content: center;
      padding: 0;
      font-weight: 700;
    }
    .group-label {
      fill: #111;
      font-family: 'Exo 2', Roboto, sans-serif;
      font-weight: 700;
      text-anchor: middle;
      dominant-baseline: central;
      pointer-events: none;
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

  /** Leader lines, one per box position (any control sharing the box may carry it). */
  protected readonly leaders = computed(() => {
    const idx = this.imageIndex();
    const byPos = new Map<string, { box: DeviceControl['box']; leader?: ImagePoint[]; keys: string[] }>();
    for (const c of this.device().controls) {
      if (!c.box || (c.image ?? 0) !== idx) continue;
      const pos = `${c.box.x},${c.box.y},${c.box.w},${c.box.h}`;
      const e = byPos.get(pos) ?? { box: c.box, keys: [] };
      e.leader ??= c.leader?.length ? c.leader : undefined;
      e.keys.push(this.key(c));
      byPos.set(pos, e);
    }
    for (const g of this.device().groups ?? []) {
      if ((g.image ?? 0) !== idx) continue;
      const pos = `g:${g.box.x},${g.box.y},${g.box.w},${g.box.h}`;
      const e = byPos.get(pos) ?? { box: g.box, keys: [] };
      e.leader ??= g.leader?.length ? g.leader : undefined;
      e.keys.push(...g.members.map((m) => controlKey(m.bindsId, m.key)));
      byPos.set(pos, e);
    }
    return [...byPos.values()]
      .filter((e) => e.leader)
      .map((e) => ({ d: pathData(leaderPath(e.box!, e.leader)), anchor: e.leader!.at(-1)!, keys: e.keys }));
  });
  protected readonly dotRadius = computed(() => {
    const img = this.image();
    return img ? Math.max(3, Math.max(img.width, img.height) / 450) : 4;
  });
  protected readonly inHighlight = (k: string) => this.highlight().has(k);
  protected readonly hasLabel = (k: string) => !!this.labels()?.get(k);

  /** Control groups on this image, with each member's row and marker. */
  protected readonly groups = computed(() => {
    const def = this.device();
    const idx = this.imageIndex();
    const seen = new Set<string>();
    return (def.groups ?? [])
      .filter((g) => {
        const pos = `${g.box.x},${g.box.y},${g.box.w},${g.box.h}`;
        if ((g.image ?? 0) !== idx || seen.has(pos)) return false;
        seen.add(pos);
        return true;
      })
      .map((g) => {
        const geo = groupLayout(g);
        const members = geo.members.map((cell): DiagramMember => {
          const m = g.members[cell.index];
          const control = def.controls.find((c) => c.bindsId === m.bindsId && c.key === m.key && c.deviceIndex === m.deviceIndex);
          const symbol = markerSymbol(m.marker);
          const auto = `${g.label} ${m.marker}`;
          return {
            ...cell,
            control,
            ckey: controlKey(m.bindsId, m.key),
            symbol,
            symbolTransform: symbol ? markerTransform(cell.markerRect, 0.62) : '',
            name: control && control.label !== auto ? control.label : '',
          };
        });
        const l = geo.labelRect;
        const labelSize = l ? Math.min(l.w * 0.62, (l.h * 0.9) / Math.max(1, g.label.length * 0.6)) : 0;
        return { id: g.id, label: g.label, box: g.box, labelRect: l, labelSize, dividers: groupDividers(geo, g.layout), members };
      });
  });

  protected fontSizeFor(r: Box): number {
    return Math.max(10, Math.min(40, r.h * 0.62));
  }

  protected key(c: DeviceControl): string {
    return controlKey(c.bindsId, c.key);
  }

  protected fontSize(c: DeviceControl): number {
    return Math.max(14, Math.min(40, c.box!.h * 0.62));
  }
}
