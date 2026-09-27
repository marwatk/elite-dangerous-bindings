import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSortModule, Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { SlotName } from '../../core/binds/binds-document';
import { BindingsStore } from '../../core/state/bindings-store.service';
import { FileActions } from '../../core/state/file-actions.service';
import { BindingsDialogs } from './bindings-dialogs.service';
import { BindingsView } from './bindings-view.service';
import { SlotView } from './slot-view';
import {
  ALL_COLUMNS,
  BindingRow,
  COLUMN_LABELS,
  ColumnId,
  DEFAULT_VIEW,
  EMPTY_FILTER,
  FIXED_COLUMNS,
  StatusFilter,
  TableFilter,
  TableSort,
  ViewState,
  filterRows,
  sanitizeView,
  sortRows,
  toCsv,
} from './table-model';

const VIEW_KEY = 'edb.bindings.view';

function defaultView(): ViewState {
  // On phones start with the essential columns; the column menu brings the rest back.
  const narrow = typeof window !== 'undefined' && window.innerWidth < 700;
  return narrow ? { ...DEFAULT_VIEW, hidden: ['area', 'section', 'flags'] } : DEFAULT_VIEW;
}

function loadView(): ViewState {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    return raw ? sanitizeView(JSON.parse(raw)) : defaultView();
  } catch {
    return defaultView();
  }
}

@Component({
  selector: 'app-bindings-page',
  imports: [
    DecimalPipe,
    MatBadgeModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatPaginatorModule,
    MatSelectModule,
    MatSortModule,
    MatTableModule,
    MatTooltipModule,
    RouterLink,
    SlotView,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './bindings-page.html',
  styleUrl: './bindings-page.scss',
})
export class BindingsPage {
  protected readonly store = inject(BindingsStore);
  protected readonly files = inject(FileActions);
  protected readonly view = inject(BindingsView);
  protected readonly dialogs = inject(BindingsDialogs);
  private readonly snack = inject(MatSnackBar);

  protected readonly ALL_COLUMNS = ALL_COLUMNS;
  protected readonly COLUMN_LABELS = COLUMN_LABELS;
  protected readonly FIXED_COLUMNS = FIXED_COLUMNS;
  protected readonly STATUSES: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'bound', label: 'Bound' },
    { value: 'unbound', label: 'Unbound' },
    { value: 'conflicts', label: 'Conflicts' },
    { value: 'changed', label: 'Changed' },
  ];
  protected readonly PAGE_SIZES = [25, 50, 100, 250, 500];

  private readonly saved = loadView();
  protected readonly filter = signal<TableFilter>(this.saved.filter);
  protected readonly hidden = signal<ReadonlySet<ColumnId>>(new Set(this.saved.hidden));
  protected readonly sort = signal<TableSort>(this.saved.sort);
  protected readonly pageSize = signal(this.saved.pageSize);
  protected readonly pageIndex = signal(0);

  protected readonly columns = computed(() => ALL_COLUMNS.filter((c) => !this.hidden().has(c)));
  protected readonly filtered = computed(() => filterRows(this.view.rows(), this.filter()));
  protected readonly sorted = computed(() => sortRows(this.filtered(), this.sort()));
  protected readonly currentPageIndex = computed(() => {
    const maxIndex = Math.max(0, Math.ceil(this.sorted().length / this.pageSize()) - 1);
    return Math.min(this.pageIndex(), maxIndex);
  });
  protected readonly page = computed(() => {
    const size = this.pageSize();
    const index = this.currentPageIndex();
    return this.sorted().slice(index * size, index * size + size);
  });
  protected readonly filtering = computed(() => {
    const f = this.filter();
    return !!(f.text || f.group || f.device || f.status !== 'all');
  });
  protected readonly counts = computed(() => {
    const rows = this.view.rows();
    return {
      bound: rows.filter((r) => r.bound).length,
      conflicts: rows.filter((r) => r.conflict).length,
      changed: rows.filter((r) => r.changed).length,
    };
  });
  protected readonly fileInfo = computed(() => {
    const doc = this.store.doc();
    if (!doc) return null;
    return {
      preset: doc.presetName || 'Custom',
      version: doc.majorVersion === null ? null : `${doc.majorVersion}.${doc.minorVersion ?? 0}`,
      layout: doc.keyboardLayout,
    };
  });

  protected readonly trackRow = (_: number, r: BindingRow) => r.code;

  constructor() {
    effect(() => {
      const state: ViewState = {
        filter: this.filter(),
        hidden: [...this.hidden()],
        sort: this.sort(),
        pageSize: this.pageSize(),
      };
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify(state));
      } catch {
        // Preferences just won't persist.
      }
    });
  }

  // ------------------------------------------------------------ filters

  protected patchFilter(patch: Partial<TableFilter>): void {
    this.filter.update((f) => ({ ...f, ...patch }));
    this.pageIndex.set(0);
  }

  protected clearFilters(): void {
    this.filter.set(EMPTY_FILTER);
    this.pageIndex.set(0);
  }

  protected toggleColumn(c: ColumnId, show: boolean): void {
    this.hidden.update((h) => {
      const n = new Set(h);
      if (show) n.delete(c);
      else n.add(c);
      return n;
    });
  }

  protected onSort(s: Sort): void {
    this.sort.set({ active: (s.direction ? s.active : '') as ColumnId | '', direction: s.direction });
  }

  protected onPage(e: PageEvent): void {
    this.pageSize.set(e.pageSize);
    this.pageIndex.set(e.pageIndex);
  }

  // ------------------------------------------------------------ actions

  protected openWarnings(): void {
    this.dialogs.openWarnings().subscribe((device) => {
      if (device) this.patchFilter({ device, text: '', status: 'all', group: '' });
    });
  }

  protected edit(row: BindingRow, slot?: SlotName): void {
    this.dialogs.openEditor(row.code, slot);
  }

  /** Clicking the Secondary cell edits the secondary binding; anywhere else in the row edits the primary. */
  protected slotAt(e: Event): SlotName {
    return (e.target as Element | null)?.closest('.c-secondary') ? 'Secondary' : 'Primary';
  }

  protected rowKey(e: Event, row: BindingRow): void {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    this.edit(row);
  }

  protected copy(e: Event, text: string): void {
    e.stopPropagation();
    const done = () => this.snack.open(`Copied ${text}`, undefined, { duration: 2000 });
    if (navigator.clipboard) void navigator.clipboard.writeText(text).then(done, () => this.snack.open('Copy failed', undefined, { duration: 2000 }));
  }

  protected exportCsv(all: boolean): void {
    const rows = all ? sortRows(this.view.rows(), { active: '', direction: '' }) : this.sorted();
    const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.fileInfo()?.preset ?? 'bindings'}-bindings${all ? '' : '-filtered'}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
