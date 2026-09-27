import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { NavigationEnd, Router } from '@angular/router';
import { filter, firstValueFrom } from 'rxjs';
import { BindsFormatError } from '../binds/binds-document';
import { XmlParseError } from '../binds/xml';
import { decodeShare, encodeShare } from '../share/share-codec';
import { BindingsStore } from './bindings-store.service';

/** Minimal typings for the File System Access API (Chromium only). */
interface OpenFilePickerWindow {
  showOpenFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (opts?: unknown) => Promise<FileSystemFileHandle>;
}

const BINDS_TYPES = [{ description: 'Elite Dangerous bindings', accept: { 'application/xml': ['.binds'] } }];

/** Opening, downloading and saving `.binds` files. */
@Injectable({ providedIn: 'root' })
export class FileActions {
  private readonly store = inject(BindingsStore);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);

  readonly canSaveInPlace = typeof window !== 'undefined' && 'showSaveFilePicker' in window;

  /** Let the user pick a file; opens it and goes to the bindings table. */
  async pickAndOpen(): Promise<void> {
    const w = window as unknown as OpenFilePickerWindow;
    if (w.showOpenFilePicker) {
      try {
        const [handle] = await w.showOpenFilePicker({ types: BINDS_TYPES, id: 'edb-binds' });
        await this.openFile(await handle.getFile(), handle);
      } catch (e) {
        if ((e as DOMException).name !== 'AbortError') this.error(e);
      }
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.binds,.xml';
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void this.openFile(file);
    };
    input.click();
  }

  async openFile(file: File, handle?: FileSystemFileHandle): Promise<boolean> {
    if (this.store.dirty() && !confirm('You have unsaved changes. Open another file and discard them?')) return false;
    try {
      await this.store.openFile(file, handle);
      this.snack.open(`Opened ${file.name}`, undefined, { duration: 2500 });
      await this.router.navigate(['/bindings']);
      return true;
    } catch (e) {
      this.error(e, file.name);
      return false;
    }
  }

  async openTemplate(): Promise<void> {
    if (this.store.dirty() && !confirm('You have unsaved changes. Start a new file and discard them?')) return;
    try {
      await this.store.openTemplate();
      await this.router.navigate(['/bindings']);
    } catch (e) {
      this.error(e);
    }
  }

  /** Download the current file under the name the game expects. */
  download(name?: string): void {
    const doc = this.store.doc();
    if (!doc) return;
    const fileName = name ?? this.suggestedName();
    const blob = new Blob([doc.serialize()], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    this.store.markSaved(fileName);
    this.snack.open(`Downloaded ${fileName}`, undefined, { duration: 3000 });
  }

  /**
   * Save back to the file it was opened from (Chromium, when opened through
   * the picker); otherwise "Save as" or download.
   */
  async save(): Promise<void> {
    const doc = this.store.doc();
    const src = this.store.source();
    if (!doc) return;
    if (src?.handle && (await this.ensureWritable(src.handle))) {
      await this.writeTo(src.handle);
      return;
    }
    await this.saveAs();
  }

  async saveAs(name?: string): Promise<void> {
    const w = window as unknown as OpenFilePickerWindow;
    if (!w.showSaveFilePicker) {
      this.download(name);
      return;
    }
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: name ?? this.suggestedName(), types: BINDS_TYPES, id: 'edb-binds' });
      await this.writeTo(handle);
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') this.error(e);
    }
  }

  suggestedName(): string {
    const doc = this.store.doc();
    const src = this.store.source();
    if (src?.kind === 'file' && /\.\d+\.\d+\.binds$/.test(src.name)) return src.name;
    return doc?.fileName ?? 'Custom.4.2.binds';
  }

  private async writeTo(handle: FileSystemFileHandle): Promise<void> {
    const doc = this.store.doc();
    if (!doc) return;
    const writable = await handle.createWritable();
    await writable.write(doc.serialize());
    await writable.close();
    this.store.markSaved(handle.name);
    this.snack.open(`Saved ${handle.name}. Restart the game (or reopen Options › Controls) to load it.`, 'OK', {
      duration: 6000,
    });
  }

  private async ensureWritable(handle: FileSystemFileHandle): Promise<boolean> {
    const h = handle as FileSystemFileHandle & {
      queryPermission?: (d: { mode: string }) => Promise<PermissionState>;
      requestPermission?: (d: { mode: string }) => Promise<PermissionState>;
    };
    if (!h.queryPermission) return true;
    if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
    return (await h.requestPermission?.({ mode: 'readwrite' })) === 'granted';
  }

  /** Copy a link that contains the whole file (compressed, in the URL fragment). */
  async copyShareLink(): Promise<void> {
    const doc = this.store.doc();
    if (!doc) return;
    try {
      const hash = await encodeShare({ name: this.suggestedName(), text: doc.serialize() });
      const url = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}#${hash}`;
      await navigator.clipboard.writeText(url);
      this.snack.open(`Share link copied (${Math.round(url.length / 1024)} KB). Anyone with the link can open this file.`, undefined, {
        duration: 5000,
      });
    } catch (e) {
      this.error(e);
    }
  }

  /** If the page was opened from a share link, open the file it contains. */
  async openFromLocation(): Promise<void> {
    let shared;
    try {
      shared = await decodeShare(location.hash);
    } catch (e) {
      this.snack.open('This share link is damaged or incomplete.', 'Dismiss', { duration: 8000 });
      return;
    }
    if (!shared) return;
    // Let the router finish its initial navigation first, or it would override ours.
    if (!this.router.navigated) {
      await firstValueFrom(this.router.events.pipe(filter((e) => e instanceof NavigationEnd)));
    }
    history.replaceState(null, '', location.pathname + location.search);
    if (this.store.dirty() && !confirm(`Open the shared file ${shared.name}? Your unsaved changes will be discarded.`)) return;
    try {
      this.store.open(shared.text, { name: shared.name, kind: 'share' });
      this.snack.open(`Opened shared file ${shared.name}`, undefined, { duration: 3000 });
      await this.router.navigate(['/bindings']);
    } catch (e) {
      this.error(e, shared.name);
    }
  }

  error(e: unknown, fileName?: string): void {
    let msg: string;
    if (e instanceof XmlParseError) msg = `${fileName ?? 'File'} is not valid XML: ${e.message}`;
    else if (e instanceof BindsFormatError) msg = `${fileName ?? 'File'}: ${e.message}`;
    else msg = (e as Error)?.message ?? String(e);
    this.snack.open(msg, 'Dismiss', { duration: 10_000 });
  }
}
