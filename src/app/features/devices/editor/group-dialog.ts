import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { GroupLayoutKind } from '../../../core/data/catalog.types';
import { groupDividers, groupLayout } from '../../../core/devices/group-layout';
import { MARKER_PALETTE, MAX_MARKER_TEXT, markerSymbol, markerTransform, normalizeMarker } from '../../../core/devices/markers';
import { firstValueFrom } from 'rxjs';
import { EditorDraft } from './draft';
import { EditorStore } from './editor-store';
import { GroupSpec, groupSpecFor, memberName } from './groups';
import { MarkerIcon } from './marker-icon';

export interface GroupDialogMember {
  control: string;
  key: string;
  label: string;
  marker: string;
}

export interface GroupDialogData {
  /** Editing an existing group (shows Ungroup). */
  existing: boolean;
  label: string;
  layout: GroupLayoutKind;
  showLabel: boolean;
  members: GroupDialogMember[];
}

export type GroupDialogResult = { action: 'save'; spec: GroupSpec } | { action: 'ungroup' };

const PREVIEW_W = 360;

/** Set up a control group: label, layout, member order and markers. */
@Component({
  selector: 'app-group-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatButtonModule, MatButtonToggleModule, MatIconModule, MatSlideToggleModule, MatTooltipModule, CdkDropList, CdkDrag, CdkDragHandle, MarkerIcon],
  styleUrls: ['./step-common.scss'],
  styles: `
    :host {
      display: block;
    }
    .top {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 16px;
      align-items: start;
    }
    label.field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font: var(--mat-sys-label-large);
    }
    .opts {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      margin-top: 12px;
    }
    .preview {
      width: 360px;
      max-width: 100%;
      border-radius: 8px;
      background: #d9d9d9;
      rect.box {
        fill: rgba(255, 255, 255, 0.85);
        stroke: #2b2b2b;
        stroke-width: 2;
      }
      rect.sel {
        fill: color-mix(in srgb, var(--edb-accent) 30%, transparent);
      }
      .div {
        fill: none;
        stroke: rgba(43, 43, 43, 0.55);
        stroke-width: 1;
      }
      .marker path {
        fill: none;
        stroke: #111;
        stroke-width: 2.4;
        stroke-linecap: round;
        stroke-linejoin: round;
      }
      .marker path.filled {
        fill: #111;
        stroke: none;
      }
      text {
        fill: #111;
        font-family: 'Exo 2', Roboto, sans-serif;
        dominant-baseline: central;
      }
      .lbl {
        font-weight: 700;
        text-anchor: middle;
      }
      .mtxt {
        font-weight: 700;
        text-anchor: middle;
      }
    }
    .members {
      margin-top: 12px;
      border: 1px solid var(--edb-border);
      border-radius: 8px;
    }
    .member {
      display: grid;
      grid-template-columns: auto 40px 90px minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      padding: 4px 8px;
      border-bottom: 1px solid var(--edb-border);
      background: var(--mat-sys-surface-container-high);
      cursor: pointer;
      &:last-child {
        border-bottom: 0;
      }
      &.sel {
        background: var(--edb-accent-soft);
        box-shadow: inset 3px 0 0 var(--edb-accent);
      }
      .handle {
        cursor: grab;
        color: var(--edb-muted);
      }
      .icon {
        font-size: 20px;
        text-align: center;
      }
      .what {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      &.missing .icon {
        color: var(--edb-danger);
      }
    }
    .cdk-drag-preview {
      box-shadow: var(--mat-sys-level3);
    }
    .cdk-drag-placeholder {
      opacity: 0.3;
    }
    .palette {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 12px;
      button {
        min-width: 40px;
        font-size: 20px;
      }
      button.on {
        background: var(--edb-accent-soft);
        color: var(--edb-accent);
      }
    }
    .err {
      color: var(--edb-danger);
    }
  `,
  template: `
    <h2 mat-dialog-title>{{ data.existing ? 'Edit group' : 'Group controls' }}</h2>
    <mat-dialog-content>
      <div class="top">
        <div>
          <label class="field">
            Label
            <input class="dense-field" [value]="label()" (input)="label.set($any($event.target).value)" placeholder="H1, Trim hat, Rocker…" data-testid="group-label" cdkFocusInitial />
          </label>
          <div class="opts">
            <mat-button-toggle-group [value]="layout()" (change)="layout.set($event.value)" aria-label="Layout" hideSingleSelectionIndicator>
              <mat-button-toggle value="stack" data-testid="layout-stack"><mat-icon>table_rows</mat-icon> Stack</mat-button-toggle>
              <mat-button-toggle value="row" data-testid="layout-row"><mat-icon>view_column</mat-icon> Row</mat-button-toggle>
            </mat-button-toggle-group>
            <mat-slide-toggle [checked]="showLabel()" (change)="showLabel.set($event.checked)">Show label</mat-slide-toggle>
          </div>
        </div>
        <svg class="preview" [attr.viewBox]="'0 0 ' + previewW + ' ' + preview().h" [attr.height]="preview().h" aria-label="Preview">
          <rect class="box" x="1" y="1" [attr.width]="previewW - 2" [attr.height]="preview().h - 2" rx="4" />
          @for (m of preview().geo.members; track m.index) {
            @if (m.index === selected()) {
              <rect class="sel" [attr.x]="m.rect.x" [attr.y]="m.rect.y" [attr.width]="m.rect.w" [attr.height]="m.rect.h" />
            }
            @if (symbol(m.marker); as s) {
              <g class="marker" [attr.transform]="transform(m.markerRect)">
                <path [attr.d]="s.d" [attr.transform]="s.transform ?? null" [class.filled]="s.fill" />
              </g>
            } @else {
              <text class="mtxt" [attr.x]="m.markerRect.x + m.markerRect.w / 2" [attr.y]="m.markerRect.y + m.markerRect.h / 2" [attr.font-size]="m.markerRect.h * 0.45">
                {{ m.marker || '?' }}
              </text>
            }
            <text [attr.x]="m.textRect.x + 6" [attr.y]="m.textRect.y + m.textRect.h / 2" [attr.font-size]="Math.min(16, m.textRect.h * 0.55)">{{ rows()[m.index].label }}</text>
          }
          <path class="div" [attr.d]="preview().dividers" />
          @if (preview().geo.labelRect; as l) {
            <text class="lbl" [attr.transform]="'translate(' + (l.x + l.w / 2) + ' ' + (l.y + l.h / 2) + ') rotate(-90)'" [attr.font-size]="Math.min(l.w * 0.6, 18)">{{ label() }}</text>
          }
        </svg>
      </div>

      <div class="members" cdkDropList (cdkDropListDropped)="drop($event)" aria-label="Members, in order">
        @for (m of rows(); track m.control; let i = $index; let first = $first; let last = $last) {
          <div class="member" cdkDrag [class.sel]="selected() === i" [class.missing]="!m.marker" (click)="selected.set(i)" [attr.data-key]="m.key">
            <mat-icon class="handle" cdkDragHandle aria-hidden="true">drag_indicator</mat-icon>
            <app-marker-icon class="icon" [marker]="m.marker" />
            <input
              class="dense-field"
              [value]="m.marker"
              [attr.maxlength]="maxText"
              (input)="setMarker(i, $any($event.target).value)"
              (focus)="selected.set(i)"
              [attr.aria-label]="'Marker for ' + m.key"
              [attr.data-testid]="'marker-' + i"
            />
            <span class="what"><span class="mono">{{ m.key }}</span> · {{ m.label }}</span>
            <span>
              <button matIconButton type="button" (click)="move(i, -1); $event.stopPropagation()" [disabled]="first" aria-label="Move up"><mat-icon>arrow_upward</mat-icon></button>
              <button matIconButton type="button" (click)="move(i, 1); $event.stopPropagation()" [disabled]="last" aria-label="Move down"><mat-icon>arrow_downward</mat-icon></button>
            </span>
          </div>
        }
      </div>
      <p class="hint">Drag to reorder (the rows are drawn in this order). Pick a marker for the selected member, or type up to {{ maxText }} characters (e.g. Fwd, 1).</p>
      <div class="palette" role="group" aria-label="Markers">
        @for (p of palette; track p) {
          <button matButton type="button" [class.on]="rows()[selected()]?.marker === p" (click)="pick(p)" [attr.aria-label]="'Marker ' + p" [attr.data-marker]="p">
            <app-marker-icon [marker]="p" />
          </button>
        }
      </div>
      @if (problem(); as p) {
        <p class="err">{{ p }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions>
      @if (data.existing) {
        <button matButton type="button" (click)="ref.close({ action: 'ungroup' })" data-testid="ungroup"><mat-icon>call_split</mat-icon>Ungroup</button>
      }
      <span class="spacer"></span>
      <button matButton type="button" mat-dialog-close>Cancel</button>
      <button matButton="filled" type="button" (click)="save()" [disabled]="!!problem()" data-testid="group-save">{{ data.existing ? 'Save' : 'Group' }}</button>
    </mat-dialog-actions>
  `,
})
export class GroupDialog {
  protected readonly data = inject<GroupDialogData>(MAT_DIALOG_DATA);
  protected readonly ref = inject<MatDialogRef<GroupDialog, GroupDialogResult>>(MatDialogRef);
  protected readonly Math = Math;
  protected readonly palette = MARKER_PALETTE;
  protected readonly maxText = MAX_MARKER_TEXT;
  protected readonly previewW = PREVIEW_W;

  protected readonly label = signal(this.data.label);
  protected readonly layout = signal<GroupLayoutKind>(this.data.layout);
  protected readonly showLabel = signal(this.data.showLabel);
  protected readonly members = signal<GroupDialogMember[]>(this.data.members.map((m) => ({ ...m })));
  protected readonly selected = signal(Math.max(0, this.data.members.findIndex((m) => !m.marker)));

  /** Members with the names they will get. */
  protected readonly rows = computed(() => {
    const orig = new Map(this.data.members.map((m) => [m.control, m]));
    return this.members().map((m) => {
      const before = orig.get(m.control)!;
      const wasAuto = before.label === memberName(this.data.label, before.marker) || /^(Button|Hat|Rotary|[XYZUV] axis)/.test(before.label);
      return { ...m, label: wasAuto && this.label().trim() ? memberName(this.label(), m.marker) : before.label };
    });
  });
  protected readonly preview = computed(() => {
    const n = this.members().length;
    const stack = this.layout() === 'stack';
    const h = stack ? Math.min(34 * n, 240) : 40;
    const geo = groupLayout({ box: { x: 1, y: 1, w: PREVIEW_W - 2, h: h - 2 }, layout: this.layout(), showLabel: this.showLabel(), members: this.members() });
    return { h, geo, dividers: groupDividers(geo, this.layout()) };
  });
  protected readonly problem = computed(() => {
    const ms = this.members().map((m) => m.marker);
    if (ms.length < 2) return 'A group needs at least 2 controls.';
    if (ms.some((m) => !m)) return 'Give every member a marker.';
    const dup = ms.find((m, i) => ms.indexOf(m) !== i);
    if (dup) return `Marker ${dup} is used twice.`;
    return null;
  });

  protected symbol(marker: string) {
    return markerSymbol(marker);
  }

  protected transform(r: { x: number; y: number; w: number; h: number }): string {
    return markerTransform(r, 0.62);
  }

  protected setMarker(i: number, raw: string): void {
    this.members.update((ms) => ms.map((m, j) => (j === i ? { ...m, marker: normalizeMarker(raw) } : m)));
  }

  protected pick(marker: string): void {
    const i = this.selected();
    this.setMarker(i, marker);
    // Move on to the next member without a marker.
    const next = this.members().findIndex((m, j) => j > i && !m.marker);
    if (next >= 0) this.selected.set(next);
  }

  protected move(i: number, delta: number): void {
    const j = i + delta;
    this.members.update((ms) => {
      const out = [...ms];
      moveItemInArray(out, i, j);
      return out;
    });
    this.selected.set(j);
  }

  protected drop(e: CdkDragDrop<unknown>): void {
    this.members.update((ms) => {
      const out = [...ms];
      moveItemInArray(out, e.previousIndex, e.currentIndex);
      return out;
    });
    this.selected.set(e.currentIndex);
  }

  protected save(): void {
    if (this.problem()) return;
    this.ref.close({
      action: 'save',
      spec: {
        label: this.label().trim(),
        layout: this.layout(),
        showLabel: this.showLabel(),
        members: this.members().map((m) => ({ control: m.control, marker: m.marker })),
      },
    });
  }
}

/**
 * Open the group dialog to group `uids` (new group) or edit `group`, and
 * apply the result to the store. Resolves to the group's uid (null if
 * cancelled or ungrouped).
 */
export async function openGroupDialog(
  dialog: MatDialog,
  store: EditorStore,
  target: { uids: string[] } | { group: string },
): Promise<string | null> {
  const d = store.draft();
  const existing = 'group' in target ? d.groups?.find((g) => g.uid === target.group) : undefined;
  const spec = existing
    ? { label: existing.label, layout: existing.layout, showLabel: existing.showLabel, members: existing.members }
    : groupSpecFor(d, 'uids' in target ? target.uids : [], suggestLabel(d, 'uids' in target ? target.uids : []));
  const data: GroupDialogData = {
    existing: !!existing,
    label: spec.label,
    layout: spec.layout,
    showLabel: spec.showLabel,
    members: spec.members.map((m) => {
      const c = d.controls.find((x) => x.uid === m.control)!;
      return { control: m.control, key: c.key, label: c.label, marker: m.marker };
    }),
  };
  const result = await firstValueFrom(
    dialog.open<GroupDialog, GroupDialogData, GroupDialogResult>(GroupDialog, { data, width: '760px', maxWidth: '96vw', autoFocus: 'first-tabbable' }).afterClosed(),
  );
  if (!result) return null;
  if (result.action === 'ungroup') {
    if (existing) store.ungroup(existing.uid);
    return null;
  }
  if (existing) {
    store.updateGroup(existing.uid, result.spec);
    return existing.uid;
  }
  return store.groupControls(result.spec);
}

/** "H1" for POV1 directions, else empty (the user names it). */
function suggestLabel(d: EditorDraft, uids: string[]): string {
  const keys = uids.map((u) => d.controls.find((c) => c.uid === u)?.key ?? '');
  const pov = [...new Set(keys.map((k) => /POV(\d+)/.exec(k)?.[1]).filter(Boolean))];
  return pov.length === 1 ? `H${pov[0]}` : '';
}
