import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, HostListener, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule, MatIconRegistry } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenavContent, MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { CatalogService } from './core/data/catalog.service';
import { BindingsStore } from './core/state/bindings-store.service';
import { FileActions } from './core/state/file-actions.service';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  needsFile?: boolean;
}

@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatSidenavModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatTooltipModule,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly store = inject(BindingsStore);
  protected readonly files = inject(FileActions);
  protected readonly catalog = inject(CatalogService);

  protected readonly isMobile = toSignal(
    inject(BreakpointObserver)
      .observe('(max-width: 840px)')
      .pipe(map((r) => r.matches)),
    { initialValue: false },
  );
  protected readonly navOpen = signal(true);
  protected readonly dragging = signal(false);
  protected readonly light = signal(document.documentElement.classList.contains('light'));

  protected readonly nav: NavItem[] = [
    { path: '/', label: 'Home', icon: 'home' },
    { path: '/bindings', label: 'Bindings', icon: 'table_rows', needsFile: true },
    { path: '/cards', label: 'Reference cards', icon: 'print', needsFile: true },
    { path: '/live', label: 'Live input', icon: 'stadia_controller' },
    { path: '/devices', label: 'Devices', icon: 'joystick' },
    { path: '/about', label: 'About', icon: 'info' },
  ];

  constructor() {
    inject(MatIconRegistry).setDefaultFontSetClass('material-symbols-outlined');
    void this.files.openFromLocation();
    // The sidenav content is the scroll container: start each page at the top.
    inject(Router)
      .events.pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.content()?.scrollTo({ top: 0 }));
  }

  private readonly content = viewChild(MatSidenavContent);

  @HostListener('window:hashchange')
  protected onHashChange(): void {
    void this.files.openFromLocation();
  }

  protected toggleTheme(): void {
    const light = !this.light();
    this.light.set(light);
    document.documentElement.classList.toggle('light', light);
    try {
      localStorage.setItem('edb.theme', light ? 'light' : 'dark');
    } catch {
      // Preference just won't persist.
    }
  }

  protected closeNavOnMobile(): void {
    if (this.isMobile()) this.navOpen.set(false);
  }

  // ------------------------------------------------------------ shortcuts

  @HostListener('window:keydown', ['$event'])
  protected onKeydown(e: KeyboardEvent): void {
    if (e.defaultPrevented || !(e.ctrlKey || e.metaKey)) return;
    const target = e.target as HTMLElement | null;
    const typing = !!target?.closest('input, textarea, [contenteditable="true"]');
    const key = e.key.toLowerCase();
    if (key === 'o') {
      e.preventDefault();
      void this.files.pickAndOpen();
    } else if (key === 's' && this.store.isOpen()) {
      e.preventDefault();
      void (e.shiftKey ? this.files.saveAs() : this.files.save());
    } else if (!typing && key === 'z' && !e.shiftKey && this.store.canUndo()) {
      e.preventDefault();
      this.store.undo();
    } else if (!typing && ((key === 'z' && e.shiftKey) || key === 'y') && this.store.canRedo()) {
      e.preventDefault();
      this.store.redo();
    }
  }

  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(e: BeforeUnloadEvent): void {
    // Edits are autosaved, but warn so a download isn't forgotten.
    if (this.store.dirty()) e.preventDefault();
  }

  // ------------------------------------------------------------ drag and drop

  @HostListener('window:dragover', ['$event'])
  protected onDragOver(e: DragEvent): void {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    this.dragging.set(true);
  }

  @HostListener('window:dragleave', ['$event'])
  protected onDragLeave(e: DragEvent): void {
    if (e.relatedTarget === null) this.dragging.set(false);
  }

  @HostListener('window:drop', ['$event'])
  protected onDrop(e: DragEvent): void {
    this.dragging.set(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    // Let pages with their own drop zones (e.g. the layout editor's image) handle it.
    if ((e.target as HTMLElement | null)?.closest('[data-own-drop]')) return;
    e.preventDefault();
    void this.files.openFile(file);
  }
}
