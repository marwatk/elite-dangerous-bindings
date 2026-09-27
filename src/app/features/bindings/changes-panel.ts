import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { CatalogService } from '../../core/data/catalog.service';
import { BindingsStore, SlotChange } from '../../core/state/bindings-store.service';
import { flagValueText, isSlotChange, parseDescribedSlot } from './changes-model';
import { SlotView } from './slot-view';

/** Result: the action code to open in the editor, if the user asked to. */
export type ChangesPanelResult = { edit: string } | undefined;

@Component({
  selector: 'app-changes-panel',
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatTooltipModule, SlotView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Changes <span class="muted count">({{ items().length }})</span></h2>
    <mat-dialog-content>
      <p class="muted intro">Every difference from the file as you opened (or last saved) it.</p>
      @for (c of items(); track c.key) {
        <div class="change">
          <div class="what">
            <button type="button" class="link" (click)="edit(c.change.code)">{{ c.name }}</button>
            <span class="muted slot">{{ c.change.slot }}</span>
          </div>
          <div class="diff">
            @if (c.slot) {
              <span class="before"><app-slot-view [binding]="c.before" emptyText="not bound" /></span>
              <mat-icon class="arrow" aria-hidden="false" aria-label="changed to">arrow_forward</mat-icon>
              <span class="after"><app-slot-view [binding]="c.after" emptyText="not bound" /></span>
            } @else {
              <span class="before">{{ c.beforeText }}</span>
              <mat-icon class="arrow" aria-hidden="false" aria-label="changed to">arrow_forward</mat-icon>
              <span class="after">{{ c.afterText }}</span>
            }
          </div>
          <button matButton type="button" class="revert" (click)="store.revertChange(c.change)" [attr.aria-label]="'Revert ' + c.name + ' ' + c.change.slot">
            <mat-icon>undo</mat-icon>Revert
          </button>
        </div>
      } @empty {
        <p class="empty">No changes yet. Edit a command in the table to get started.</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions>
      <button matButton type="button" (click)="revertAll()" [disabled]="!items().length" class="danger">
        <mat-icon>restore</mat-icon>Revert all
      </button>
      <span class="spacer"></span>
      <button matButton="filled" type="button" mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: `
    .count {
      font-size: 0.8em;
    }
    .intro {
      margin-top: 0;
    }
    .change {
      display: grid;
      grid-template-columns: minmax(0, 14rem) minmax(0, 1fr) auto;
      align-items: center;
      gap: 4px 12px;
      padding: 8px 0;
      border-bottom: 1px solid var(--edb-border);
    }
    .what {
      display: flex;
      flex-direction: column;
    }
    .link {
      border: 0;
      background: none;
      padding: 0;
      color: var(--edb-accent);
      font: inherit;
      font-weight: 500;
      text-align: left;
      cursor: pointer;
    }
    .link:hover {
      text-decoration: underline;
    }
    .slot {
      font-size: 0.85em;
    }
    .diff {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 8px;
    }
    .before {
      opacity: 0.75;
    }
    .arrow {
      color: var(--edb-muted);
      font-size: 18px;
      width: 18px;
      height: 18px;
    }
    .danger {
      color: var(--edb-danger);
    }
    .empty {
      padding: 24px 0;
      text-align: center;
      color: var(--edb-muted);
    }
    @media (max-width: 600px) {
      .change {
        grid-template-columns: minmax(0, 1fr) auto;
      }
      .diff {
        grid-column: 1 / -1;
        grid-row: 2;
      }
    }
  `,
})
export class ChangesPanel {
  protected readonly store = inject(BindingsStore);
  private readonly catalog = inject(CatalogService);
  private readonly ref = inject<MatDialogRef<ChangesPanel, ChangesPanelResult>>(MatDialogRef);

  protected readonly items = computed(() =>
    this.store.changes().map((change: SlotChange) => {
      const slot = isSlotChange(change);
      return {
        key: `${change.code}|${change.slot}`,
        change,
        name: this.catalog.action(change.code).longName,
        slot,
        before: slot ? parseDescribedSlot(change.before) : null,
        after: slot ? parseDescribedSlot(change.after) : null,
        beforeText: slot ? '' : flagValueText(change, change.before),
        afterText: slot ? '' : flagValueText(change, change.after),
      };
    }),
  );

  protected edit(code: string): void {
    this.ref.close({ edit: code });
  }

  protected revertAll(): void {
    const n = this.items().length;
    if (confirm(`Revert all ${n} change${n === 1 ? '' : 's'}? You can undo this.`)) this.store.revertAll();
  }
}
