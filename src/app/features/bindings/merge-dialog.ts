import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActionState, BindsDocument } from '../../core/binds/binds-document';
import { CatalogService } from '../../core/data/catalog.service';
import { BindingsStore } from '../../core/state/bindings-store.service';
import { MergeCandidate, applyMerge, effectiveMerge, groupCandidates, mergeCandidates } from './merge';

/** Take bindings for chosen groups or commands from another .binds file. */
@Component({
  selector: 'app-merge-dialog',
  imports: [MatDialogModule, MatButtonModule, MatCheckboxModule, MatExpansionModule, MatIconModule, MatSlideToggleModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Merge from another file</h2>
    <mat-dialog-content>
      <p class="muted intro">
        Copy bindings (slots, modifiers and options) for the commands you choose from another <code>.binds</code> file
        into this one. Everything else stays as it is. This is one undo step.
      </p>
      <div class="pick">
        <button matButton="outlined" type="button" (click)="fileInput.click()">
          <mat-icon>upload_file</mat-icon>{{ sourceName() ? 'Choose a different file' : 'Choose a .binds file' }}
        </button>
        <input #fileInput type="file" accept=".binds,.xml" hidden (change)="load($any($event.target))" />
        @if (sourceName(); as n) {
          <span><mat-icon inline>description</mat-icon> {{ n }}</span>
        }
      </div>
      @if (error(); as e) {
        <p class="error" role="alert">{{ e }}</p>
      }

      @if (source()) {
        <mat-slide-toggle [checked]="onlyDiffering()" (change)="onlyDiffering.set($event.checked)">
          Only list commands that differ
        </mat-slide-toggle>
        <mat-accordion multi class="groups">
          @for (g of groups(); track g.name) {
            <mat-expansion-panel>
              <mat-expansion-panel-header>
                <mat-panel-title>
                  <mat-checkbox
                    [checked]="g.all"
                    [indeterminate]="g.some && !g.all"
                    (change)="toggleGroup(g.items, $event.checked)"
                    (click)="$event.stopPropagation()"
                    [aria-label]="'Take all ' + g.name + ' commands'"
                  >
                    {{ g.name }}
                  </mat-checkbox>
                </mat-panel-title>
                <mat-panel-description>{{ g.selected }} / {{ g.items.length }} · {{ g.differ }} differ</mat-panel-description>
              </mat-expansion-panel-header>
              <ng-template matExpansionPanelContent>
                <ul class="actions">
                  @for (c of g.items; track c.code) {
                    <li>
                      <mat-checkbox [checked]="selected().has(c.code)" (change)="toggle(c.code, $event.checked)">
                        {{ name(c.code) }}
                        @if (!c.differs) {
                          <span class="muted">(same)</span>
                        } @else if (!c.sourceBound) {
                          <span class="muted">(unbound there)</span>
                        }
                      </mat-checkbox>
                    </li>
                  }
                </ul>
              </ng-template>
            </mat-expansion-panel>
          }
        </mat-accordion>
        <p class="preview" aria-live="polite">
          <strong>{{ effective().length }}</strong> command{{ effective().length === 1 ? '' : 's' }} will change
          <span class="muted">({{ selected().size }} selected; {{ skipped() }} not in both files are ignored)</span>
        </p>
      }
    </mat-dialog-content>
    <mat-dialog-actions>
      <button matButton type="button" mat-dialog-close>Cancel</button>
      <button matButton="filled" type="button" [disabled]="!effective().length" (click)="apply()">
        Merge {{ effective().length }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .intro {
      margin-top: 0;
    }
    .pick {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px 16px;
      margin-bottom: 12px;
    }
    .error {
      color: var(--edb-danger);
    }
    .groups {
      display: block;
      margin: 12px 0;
    }
    .actions {
      list-style: none;
      margin: 0;
      padding: 0;
      columns: 2 280px;
    }
    .actions li {
      break-inside: avoid;
    }
    .preview {
      margin: 8px 0 0;
    }
  `,
})
export class MergeDialog {
  private readonly store = inject(BindingsStore);
  private readonly catalog = inject(CatalogService);
  private readonly snack = inject(MatSnackBar);
  private readonly ref = inject(MatDialogRef<MergeDialog>);

  protected readonly source = signal<ActionState[] | null>(null);
  protected readonly sourceName = signal('');
  protected readonly error = signal<string | null>(null);
  protected readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly onlyDiffering = signal(true);

  protected readonly candidates = computed<MergeCandidate[]>(() => {
    const src = this.source();
    return src ? mergeCandidates(this.store.actions(), src, (c) => this.catalog.action(c).group) : [];
  });
  protected readonly groups = computed(() => {
    const sel = this.selected();
    const list = this.onlyDiffering() ? this.candidates().filter((c) => c.differs) : this.candidates();
    return [...groupCandidates(list)].map(([name, items]) => {
      const n = items.filter((i) => sel.has(i.code)).length;
      return {
        name,
        items,
        selected: n,
        all: n === items.length,
        some: n > 0,
        differ: items.filter((i) => i.differs).length,
      };
    });
  });
  protected readonly effective = computed(() => effectiveMerge(this.candidates(), this.selected()));
  protected readonly skipped = computed(() => {
    const src = this.source();
    return src ? src.length - this.candidates().length : 0;
  });

  protected async load(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const doc = await BindsDocument.fromBlob(file);
      this.source.set(doc.actions());
      this.sourceName.set(file.name);
      this.selected.set(new Set());
      this.error.set(null);
    } catch (e) {
      this.error.set(`${file.name} couldn't be read: ${(e as Error).message}`);
    }
  }

  protected name(code: string): string {
    return this.catalog.action(code).longName;
  }

  protected toggle(code: string, on: boolean): void {
    this.selected.update((s) => {
      const n = new Set(s);
      if (on) n.add(code);
      else n.delete(code);
      return n;
    });
  }

  protected toggleGroup(items: MergeCandidate[], on: boolean): void {
    this.selected.update((s) => {
      const n = new Set(s);
      for (const i of items) {
        if (on) n.add(i.code);
        else n.delete(i.code);
      }
      return n;
    });
  }

  protected apply(): void {
    const src = this.source();
    const codes = this.effective();
    if (!src || !codes.length) return;
    let n = 0;
    this.store.mutate(`Merge ${codes.length} commands from ${this.sourceName()}`, (d) => (n = applyMerge(d, src, codes)));
    this.snack.open(`Merged ${n} command${n === 1 ? '' : 's'} from ${this.sourceName()}`, undefined, { duration: 4000 });
    this.ref.close(true);
  }
}
