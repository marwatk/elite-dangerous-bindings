import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { markerSymbol } from '../../../core/devices/markers';

/** A group marker: the palette symbols as vector paths (fonts may lack arrows), anything else as text. */
@Component({
  selector: 'app-marker-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (symbol(); as s) {
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path [attr.d]="s.d" [attr.transform]="s.transform ?? null" [class.filled]="s.fill" />
      </svg>
    } @else {
      <span class="txt">{{ marker() || '?' }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.4em;
      height: 1.4em;
      vertical-align: middle;
    }
    svg {
      width: 1.3em;
      height: 1.3em;
    }
    path {
      fill: none;
      stroke: currentColor;
      stroke-width: 2.4;
      stroke-linecap: round;
      stroke-linejoin: round;
      &.filled {
        fill: currentColor;
        stroke: none;
      }
    }
    .txt {
      font-weight: 700;
      font-size: 0.85em;
      white-space: nowrap;
    }
  `,
})
export class MarkerIcon {
  readonly marker = input('');
  protected readonly symbol = computed(() => markerSymbol(this.marker()));
}
