import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { SlotBinding, isBound } from '../../core/binds/binds-document';
import { InputLabelPipe } from '../../shared/input-label.pipe';

/** One binding as key chips: modifiers + device › control. */
@Component({
  selector: 'app-slot-view',
  imports: [InputLabelPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (bound(); as b) {
      <span class="slot" [attr.title]="b | inputLabel">
        @for (m of b.modifiers; track $index) {
          <span class="kbd mod" [attr.title]="m | inputLabel">{{ m | inputLabel: 'control' }}</span>
          <span class="plus" aria-hidden="true">+</span>
        }
        @if (showDevice()) {
          <span class="dev">{{ b | inputLabel: 'device' }} ›</span>
        }
        <span class="kbd main">{{ b | inputLabel: 'control' }}</span>
        @if (b.hold && showHold()) {
          <span class="hold">hold</span>
        }
      </span>
    } @else {
      <span class="none">{{ emptyText() }}</span>
    }
  `,
  styles: `
    :host {
      display: inline;
      letter-spacing: normal;
    }
    .slot {
      display: inline-flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 2px 4px;
    }
    .dev {
      color: var(--edb-muted);
      font-size: 0.85em;
    }
    .plus {
      color: var(--edb-muted);
    }
    .kbd.mod {
      border-style: dashed;
    }
    .kbd.main {
      white-space: normal;
    }
    .hold {
      font-size: 0.75em;
      color: var(--edb-accent);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .none {
      color: var(--edb-muted);
    }
  `,
})
export class SlotView {
  readonly binding = input<SlotBinding | null | undefined>(null);
  readonly showDevice = input(true);
  readonly showHold = input(true);
  readonly emptyText = input('');

  protected readonly bound = computed(() => {
    const b = this.binding();
    return b && isBound(b) ? b : null;
  });
}
