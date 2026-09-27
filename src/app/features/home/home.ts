import { DatePipe } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { Router, RouterLink } from '@angular/router';
import { InputService } from '../../core/input/input.service';
import { BindingsStore, RecentFile } from '../../core/state/bindings-store.service';
import { FileActions } from '../../core/state/file-actions.service';

@Component({
  selector: 'app-home',
  imports: [MatButtonModule, MatCardModule, MatIconModule, MatListModule, RouterLink, DatePipe],
  templateUrl: './home.html',
  styleUrl: './home.scss',
})
export class Home {
  protected readonly store = inject(BindingsStore);
  protected readonly files = inject(FileActions);
  protected readonly input = inject(InputService);
  private readonly router = inject(Router);

  protected readonly session = computed(() => {
    this.store.revision();
    return this.store.isOpen() ? null : this.store.savedSession();
  });

  protected readonly bindingsPath = '%LOCALAPPDATA%\\Frontier Developments\\Elite Dangerous\\Options\\Bindings';

  protected restore(): void {
    if (this.store.restoreSession()) void this.router.navigate(['/bindings']);
  }

  protected openRecent(r: RecentFile): void {
    void this.files.openFile(new File([r.text], r.name, { type: 'application/xml' }));
  }

  protected copyPath(): void {
    void navigator.clipboard?.writeText(this.bindingsPath);
  }
}
