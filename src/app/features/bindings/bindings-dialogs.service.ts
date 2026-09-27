import { Injectable, inject } from '@angular/core';
import { MatDialog, MatDialogConfig, MatDialogRef } from '@angular/material/dialog';
import { Observable, map } from 'rxjs';
import { SlotName } from '../../core/binds/binds-document';
import { BindingEditor, BindingEditorData } from './binding-editor';
import { BulkDialog, BulkMode } from './bulk-dialog';
import { ChangesPanel, ChangesPanelResult } from './changes-panel';
import { ExportDialog } from './export-dialog';
import { MergeDialog } from './merge-dialog';
import { SettingsDialog } from './settings-dialog';
import { WarningsPanel, WarningsPanelResult } from './warnings-panel';

const BASE: MatDialogConfig = {
  maxWidth: 'calc(100vw - 16px)',
  maxHeight: 'calc(100dvh - 16px)',
  autoFocus: 'first-tabbable',
  restoreFocus: true,
};

/**
 * Opens the bindings feature's dialogs. Other pages can inject this to offer
 * the same editor or export dialog (e.g. from a reference card click).
 */
@Injectable({ providedIn: 'root' })
export class BindingsDialogs {
  private readonly dialog = inject(MatDialog);

  openEditor(code: string, slot?: SlotName): MatDialogRef<BindingEditor, boolean> {
    return this.dialog.open<BindingEditor, BindingEditorData, boolean>(BindingEditor, {
      ...BASE,
      width: '720px',
      data: { code, slot },
    });
  }

  openChanges(): void {
    this.dialog
      .open<ChangesPanel, void, ChangesPanelResult>(ChangesPanel, { ...BASE, width: '860px' })
      .afterClosed()
      .subscribe((r) => {
        if (r?.edit) this.openEditor(r.edit);
      });
  }

  /** Opens the warnings; emits a `device::index` key when the user asks to see a device's bindings. */
  openWarnings(): Observable<string | null> {
    return this.dialog
      .open<WarningsPanel, void, WarningsPanelResult>(WarningsPanel, { ...BASE, width: '760px' })
      .afterClosed()
      .pipe(
        map((r) => {
          if (r && 'edit' in r) this.openEditor(r.edit, r.slot);
          return r && 'device' in r ? r.device : null;
        }),
      );
  }

  openBulk(mode: BulkMode = 'clear'): void {
    this.dialog.open(BulkDialog, { ...BASE, width: '640px', data: { mode } });
  }

  openSettings(): void {
    this.dialog.open(SettingsDialog, { ...BASE, width: '720px' });
  }

  openMerge(): void {
    this.dialog.open(MergeDialog, { ...BASE, width: '760px' });
  }

  openExport(): void {
    this.dialog.open(ExportDialog, { ...BASE, width: '680px' });
  }
}
