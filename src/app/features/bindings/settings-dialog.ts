import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { BindsDocument } from '../../core/binds/binds-document';
import { CatalogService, humanizeKey } from '../../core/data/catalog.service';
import { BindingsStore } from '../../core/state/bindings-store.service';
import { SettingField, describeSettings, enumLabel, formatSettingNumber } from './settings-model';

/** Global settings stored in the file (`<X Value="…"/>`). Each change is one undo step. */
@Component({
  selector: 'app-settings-dialog',
  imports: [MatDialogModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Settings in this file</h2>
    <mat-dialog-content>
      <p class="muted intro">
        Mouse, headlook, throttle and other options the game stores with the bindings. Changes apply immediately and
        can be undone.
      </p>
      <mat-form-field appearance="outline" subscriptSizing="dynamic" class="search">
        <mat-icon matPrefix>search</mat-icon>
        <mat-label>Filter settings</mat-label>
        <input matInput [value]="query()" (input)="query.set($any($event.target).value)" autocomplete="off" />
      </mat-form-field>
      <div class="list">
        @for (f of shown(); track f.code) {
          <div class="setting">
            <label class="name" [attr.for]="'s-' + f.code">
              {{ f.name }}
              <code class="muted">{{ f.code }}</code>
            </label>
            @switch (f.type) {
              @case ('enum') {
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="field">
                  <mat-select [id]="'s-' + f.code" [value]="f.value" (valueChange)="set(f, $event)" [attr.aria-label]="f.name">
                    @for (o of f.options; track o) {
                      <mat-option [value]="o">{{ enumLabel(o) }}</mat-option>
                    }
                  </mat-select>
                </mat-form-field>
              }
              @case ('text') {
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="field">
                  <input matInput [id]="'s-' + f.code" [value]="f.value" (change)="set(f, $any($event.target).value)" spellcheck="false" />
                </mat-form-field>
              }
              @default {
                <mat-form-field appearance="outline" subscriptSizing="dynamic" class="field">
                  <input
                    matInput
                    type="number"
                    [id]="'s-' + f.code"
                    [value]="f.value"
                    [step]="f.type === 'integer' ? 1 : 0.01"
                    (change)="setNumber(f, $any($event.target))"
                  />
                </mat-form-field>
              }
            }
          </div>
        } @empty {
          <p class="muted">No settings match.</p>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions>
      <button matButton="filled" type="button" mat-dialog-close>Done</button>
    </mat-dialog-actions>
  `,
  styles: `
    .intro {
      margin-top: 0;
    }
    .search {
      width: 100%;
      margin-bottom: 8px;
    }
    .setting {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 12px;
      padding: 6px 0;
      border-bottom: 1px solid var(--edb-border);
    }
    .name {
      flex: 1 1 220px;
      display: flex;
      flex-direction: column;
    }
    .name code {
      font-size: 0.75em;
    }
    .field {
      flex: 0 1 240px;
      min-width: 160px;
    }
  `,
})
export class SettingsDialog {
  private readonly store = inject(BindingsStore);
  private readonly catalog = inject(CatalogService);

  protected readonly query = signal('');
  protected readonly enumLabel = enumLabel;
  private readonly reference = signal<ReadonlyMap<string, string>>(new Map());

  protected readonly fields = computed(() => {
    const doc = this.store.doc();
    if (!doc) return [];
    return describeSettings(
      doc.settingCodes(),
      (c) => doc.getSetting(c),
      (c) => this.catalog.settings().get(c)?.name ?? humanizeKey(c),
      this.reference(),
    );
  });

  protected readonly shown = computed(() => {
    const q = this.query().toLowerCase().trim();
    return q ? this.fields().filter((f) => `${f.name} ${f.code} ${f.value}`.toLowerCase().includes(q)) : this.fields();
  });

  constructor() {
    // The empty preset's values help recognise enum-like settings that are blank in this file.
    fetch('data/templates/Empty.4.2.binds')
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((t) => {
        const d = BindsDocument.parse(t);
        this.reference.set(new Map(d.settingCodes().map((c) => [c, d.getSetting(c) ?? ''])));
      })
      .catch(() => undefined);
  }

  protected set(f: SettingField, value: string): void {
    if (value === f.value) return;
    this.store.mutate(`Set ${f.name}`, (d) => d.setSetting(f.code, value));
  }

  protected setNumber(f: SettingField, el: HTMLInputElement): void {
    if (el.value === '' || !Number.isFinite(el.valueAsNumber)) {
      el.value = f.value;
      return;
    }
    const v = formatSettingNumber(f, el.valueAsNumber);
    el.value = v;
    this.set(f, v);
  }
}
