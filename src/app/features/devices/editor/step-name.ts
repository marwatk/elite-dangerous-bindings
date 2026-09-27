import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { partLabel } from './draft';
import { EditorStore } from './editor-store';
import { ICON_TOKENS, defaultLabel, iconTokenOf, withIconToken } from './inventory';

@Component({
  selector: 'app-step-name',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatSlideToggleModule, MatTooltipModule],
  styleUrls: ['./step-common.scss'],
  styles: `
    .table-wrap {
      max-height: 70vh;
      overflow: auto;
    }
    td.key {
      white-space: nowrap;
    }
    td.label {
      width: 55%;
    }
    tr.dup .dense-field {
      border-color: var(--edb-warning);
    }
    .token {
      max-width: 160px;
    }
    .custom {
      width: 110px;
      margin-left: 4px;
    }
  `,
  template: `
    <p class="intro">
      Give each control a friendly label, as printed on the controller or describing it (“Pinky trigger”, “Hat 2 Up”). An
      optional icon token such as <code>[x52prox]</code> shows Elite's own icon in-game when you use the exported
      <code>.buttonMap</code>.
    </p>
    <div class="row">
      <mat-slide-toggle [checked]="onlyProblems()" (change)="onlyProblems.set($event.checked)">Only empty or duplicate labels</mat-slide-toggle>
      <span class="spacer"></span>
      <button matButton type="button" (click)="fillDefaults()"><mat-icon>auto_fix_high</mat-icon>Fill empty labels</button>
    </div>
    <div class="table-wrap">
      <table class="grid">
        <thead>
          <tr>
            <th>Elite key</th>
            @if (multiPart()) {
              <th>Part</th>
            }
            <th>Label</th>
            <th>Icon token</th>
          </tr>
        </thead>
        <tbody>
          @for (c of rows(); track c.uid) {
            <tr [class.dup]="dupes().has(c.uid)">
              <td class="key mono">{{ c.key }}</td>
              @if (multiPart()) {
                <td class="mono">{{ part(c.part) }}</td>
              }
              <td class="label">
                <input class="dense-field" [value]="c.label" (input)="setLabel(c.uid, $event)" [attr.aria-label]="'Label for ' + c.key" />
              </td>
              <td>
                <select class="dense-field token" [value]="tokenChoice(c.label)" (change)="setToken(c.uid, c.label, $event)" [attr.aria-label]="'Icon token for ' + c.key">
                  <option value="">None</option>
                  @for (t of tokens; track t.token) {
                    <option [value]="t.token">{{ t.token }} {{ t.label }}</option>
                  }
                  <option value="custom">Other…</option>
                </select>
                @if (tokenChoice(c.label) === 'custom') {
                  <input class="dense-field custom mono" [value]="token(c.label) ?? ''" placeholder="[token]" (change)="setCustomToken(c.uid, c.label, $event)" aria-label="Custom token" />
                }
              </td>
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class StepName {
  protected readonly store = inject(EditorStore);
  protected readonly tokens = ICON_TOKENS;
  protected readonly onlyProblems = signal(false);

  protected readonly multiPart = computed(() => this.store.primaries().length > 1);
  protected readonly dupes = computed(() => {
    const seen = new Map<string, string[]>();
    for (const c of this.store.draft().controls) {
      const k = `${c.part}::${c.label.trim().toLowerCase()}`;
      if (c.label.trim()) seen.set(k, [...(seen.get(k) ?? []), c.uid]);
    }
    return new Set([...seen.values()].filter((v) => v.length > 1).flat());
  });
  protected readonly rows = computed(() => {
    const all = this.store.draft().controls.filter((c) => this.store.primaries().some((p) => p.uid === c.part));
    return this.onlyProblems() ? all.filter((c) => !c.label.trim() || this.dupes().has(c.uid)) : all;
  });

  protected part(uid: string): string {
    return partLabel(this.store.draft(), uid);
  }

  protected token(label: string): string | null {
    return iconTokenOf(label);
  }

  protected tokenChoice(label: string): string {
    const t = iconTokenOf(label);
    if (!t) return '';
    return this.tokens.some((x) => x.token === t) ? t : 'custom';
  }

  protected setLabel(uid: string, e: Event): void {
    this.store.updateControl(uid, { label: (e.target as HTMLInputElement).value }, `label:${uid}`);
  }

  protected setToken(uid: string, label: string, e: Event): void {
    const v = (e.target as HTMLSelectElement).value;
    if (v === 'custom') {
      this.store.updateControl(uid, { label: withIconToken(label, '[icon]') });
      return;
    }
    this.store.updateControl(uid, { label: withIconToken(label, v || null) });
  }

  protected setCustomToken(uid: string, label: string, e: Event): void {
    const raw = (e.target as HTMLInputElement).value.trim().replace(/^\[?/, '[').replace(/\]?$/, ']');
    const ok = /^\[[A-Za-z0-9_]+\]$/.test(raw);
    this.store.updateControl(uid, { label: withIconToken(label, ok ? raw : null) });
  }

  protected fillDefaults(): void {
    const d = this.store.draft();
    const empty = d.controls.filter((c) => !c.label.trim());
    if (!empty.length) return;
    this.store.update((dd) => ({ ...dd, controls: dd.controls.map((c) => (c.label.trim() ? c : { ...c, label: defaultLabel(c.key) })) }));
  }
}
