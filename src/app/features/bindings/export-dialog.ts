import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BindingsStore } from '../../core/state/bindings-store.service';
import { FileActions } from '../../core/state/file-actions.service';
import { BINDINGS_FOLDER, GAME_VERSIONS, GameVersion, backupFileName, bindsFileName, presetNameError } from './export-model';

interface DirectoryPickerWindow {
  showDirectoryPicker?: (opts?: unknown) => Promise<FileSystemDirectoryHandle>;
}

interface PendingOverwrite {
  dir: FileSystemDirectoryHandle;
  existing: FileSystemFileHandle;
  fileName: string;
}

/** Name, version, download/save, and how to install the file in the game. */
@Component({
  selector: 'app-export-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Export and install</h2>
    <mat-dialog-content>
      <div class="row">
        <mat-form-field appearance="outline" class="grow">
          <mat-label>Preset name</mat-label>
          <input matInput [value]="name()" (input)="name.set($any($event.target).value)" spellcheck="false" autocomplete="off" />
          @if (nameError(); as e) {
            <mat-error>{{ e }}</mat-error>
          } @else {
            <mat-hint>Shown in the game's Controls menu</mat-hint>
          }
        </mat-form-field>
        <mat-form-field appearance="outline" class="ver">
          <mat-label>Game version</mat-label>
          <mat-select [value]="versionKey()" (valueChange)="versionKey.set($event)">
            @for (v of versions(); track key(v)) {
              <mat-option [value]="key(v)">{{ v.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>
      <p class="file">
        File name: <code class="fname" data-testid="export-file-name">{{ fileName() }}</code>
      </p>

      <div class="buttons">
        <button matButton="filled" type="button" (click)="download()" [disabled]="!!nameError() || busy()">
          <mat-icon>download</mat-icon>Download
        </button>
        @if (files.canSaveInPlace) {
          <button matButton="outlined" type="button" (click)="saveAs()" [disabled]="!!nameError() || busy()">
            <mat-icon>save_as</mat-icon>Save as…
          </button>
        }
        @if (canPickFolder) {
          <button matButton="outlined" type="button" (click)="saveToFolder()" [disabled]="!!nameError() || busy()">
            <mat-icon>drive_folder_upload</mat-icon>Save into my Bindings folder…
          </button>
        }
      </div>
      @if (busy()) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (pending(); as p) {
        <div class="confirm" role="alertdialog" aria-labelledby="ow-title">
          <strong id="ow-title">{{ p.fileName }} already exists in that folder.</strong>
          <span>
            Overwrite it? The current file is first copied to <code>{{ backupName(p.fileName) }}</code>, which the game ignores.
          </span>
          <div class="confirm-buttons">
            <button matButton type="button" (click)="pending.set(null)">Cancel</button>
            <button matButton="filled" type="button" (click)="overwrite(p)">Back up and overwrite</button>
          </div>
        </div>
      }
      @if (error(); as e) {
        <p class="error" role="alert">{{ e }}</p>
      }

      <section class="install">
        <h3>Installing the file</h3>
        <ol>
          <li><strong>Quit Elite Dangerous</strong> first. The game rewrites the file when it exits, which would undo your changes.</li>
          <li>
            Put <code>{{ fileName() }}</code> in your Bindings folder:
            <span class="path">
              <code>@for (part of folderParts; track $index) {<span>{{ part }}</span><wbr />}</code>
              <button matIconButton type="button" (click)="copyFolder()" aria-label="Copy folder path" matTooltip="Copy path">
                <mat-icon>content_copy</mat-icon>
              </button>
            </span>
            <span class="muted">Paste the path into Explorer's address bar. Downloads go to your Downloads folder; move the file from there.</span>
          </li>
          <li>Start the game and open <strong>Options › Controls</strong>, then choose <strong>{{ name() || 'Custom' }}</strong> from the preset list at the top.</li>
        </ol>
        <p class="muted small">
          The version in the file name should match your game: 4.2 for current Odyssey, 3.0 for Horizons.
        </p>
      </section>
    </mat-dialog-content>
    <mat-dialog-actions>
      <button matButton type="button" mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: `
    .row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 12px;
      padding-top: 8px;
    }
    .grow {
      flex: 1 1 220px;
    }
    .ver {
      flex: 1 1 200px;
    }
    .file {
      margin: 8px 0 12px;
    }
    .fname {
      font-size: 1em;
      color: var(--edb-accent);
    }
    .buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 8px;
    }
    .confirm {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 12px;
      margin: 8px 0;
      border-radius: 8px;
      background: color-mix(in srgb, var(--edb-warning) 14%, transparent);
    }
    .confirm-buttons {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
    .error {
      color: var(--edb-danger);
    }
    .install {
      margin-top: 16px;
      padding-top: 8px;
      border-top: 1px solid var(--edb-border);
    }
    .install h3 {
      font-size: 1rem;
      margin: 8px 0;
    }
    .install ol {
      padding-left: 20px;
    }
    .install li {
      margin-bottom: 8px;
    }
    .path {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .small {
      font-size: 0.85em;
    }
  `,
})
export class ExportDialog {
  private readonly store = inject(BindingsStore);
  protected readonly files = inject(FileActions);
  private readonly snack = inject(MatSnackBar);

  protected readonly folder = BINDINGS_FOLDER;
  protected readonly folderParts = BINDINGS_FOLDER.split(/(?<=\\)/);
  protected readonly canPickFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  protected readonly backupName = (f: string) => backupFileName(f, new Date());

  private readonly doc = this.store.doc();
  protected readonly name = signal(this.doc?.presetName || 'Custom');
  protected readonly versions = signal<GameVersion[]>(this.initialVersions());
  protected readonly versionKey = signal(this.initialVersionKey());
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly pending = signal<PendingOverwrite | null>(null);

  protected readonly version = computed(
    () => this.versions().find((v) => this.key(v) === this.versionKey()) ?? GAME_VERSIONS[0],
  );
  protected readonly nameError = computed(() => presetNameError(this.name()));
  protected readonly fileName = computed(() => bindsFileName(this.name().trim(), this.version().major, this.version().minor));

  protected key(v: GameVersion): string {
    return `${v.major}.${v.minor}`;
  }

  private initialVersions(): GameVersion[] {
    const major = this.doc?.majorVersion;
    const minor = this.doc?.minorVersion ?? 0;
    if (major === null || major === undefined || GAME_VERSIONS.some((v) => v.major === major && v.minor === minor)) {
      return GAME_VERSIONS;
    }
    return [...GAME_VERSIONS, { major, minor, label: `${major}.${minor} (from this file)` }];
  }

  private initialVersionKey(): string {
    const major = this.doc?.majorVersion;
    return major === null || major === undefined ? '4.2' : `${major}.${this.doc?.minorVersion ?? 0}`;
  }

  /** Write the preset name and version into the document (one undo step). */
  private commitMeta(): void {
    const doc = this.store.doc();
    if (!doc) return;
    const name = this.name().trim();
    const v = this.version();
    if (doc.presetName === name && doc.majorVersion === v.major && doc.minorVersion === v.minor) return;
    this.store.mutate('Set preset name and version', (d) => {
      d.presetName = name;
      d.setVersion(v.major, v.minor);
    });
  }

  protected download(): void {
    if (this.nameError()) return;
    this.commitMeta();
    this.files.download(this.fileName());
  }

  protected async saveAs(): Promise<void> {
    if (this.nameError()) return;
    this.commitMeta();
    await this.files.saveAs(this.fileName());
  }

  protected async saveToFolder(): Promise<void> {
    if (this.nameError()) return;
    const w = window as unknown as DirectoryPickerWindow;
    if (!w.showDirectoryPicker) return;
    this.error.set(null);
    this.pending.set(null);
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await w.showDirectoryPicker({ id: 'edb-bindings-folder', mode: 'readwrite' });
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') this.error.set(`Couldn't open the folder: ${(e as Error).message}`);
      return;
    }
    this.commitMeta();
    const fileName = this.fileName();
    let existing: FileSystemFileHandle | null = null;
    try {
      existing = await dir.getFileHandle(fileName);
    } catch {
      existing = null;
    }
    if (existing) this.pending.set({ dir, existing, fileName });
    else await this.write(dir, fileName, null);
  }

  protected async overwrite(p: PendingOverwrite): Promise<void> {
    this.pending.set(null);
    await this.write(p.dir, p.fileName, p.existing);
  }

  private async write(dir: FileSystemDirectoryHandle, fileName: string, existing: FileSystemFileHandle | null): Promise<void> {
    const doc = this.store.doc();
    if (!doc) return;
    this.busy.set(true);
    try {
      let backup = '';
      if (existing) {
        const old = await (await existing.getFile()).text();
        backup = backupFileName(fileName, new Date());
        const bh = await dir.getFileHandle(backup, { create: true });
        const bw = await bh.createWritable();
        await bw.write(old);
        await bw.close();
      }
      const fh = await dir.getFileHandle(fileName, { create: true });
      const out = await fh.createWritable();
      await out.write(doc.serialize());
      await out.close();
      this.store.markSaved(fileName);
      this.snack.open(
        `Saved ${fileName} into ${dir.name}${backup ? ` (backup: ${backup})` : ''}. Choose “${this.name().trim()}” in Options › Controls.`,
        'OK',
        { duration: 8000 },
      );
    } catch (e) {
      this.error.set(`Saving failed: ${(e as Error).message}`);
    } finally {
      this.busy.set(false);
    }
  }

  protected copyFolder(): void {
    void navigator.clipboard?.writeText(this.folder).then(
      () => this.snack.open('Path copied', undefined, { duration: 2000 }),
      () => undefined,
    );
  }
}
