import { BreakpointObserver } from '@angular/cdk/layout';
import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { InputService } from '../../../core/input/input.service';
import { EditorStore } from './editor-store';
import { StepCheck } from './step-check';
import { StepExport } from './step-export';
import { StepIdentify } from './step-identify';
import { StepImage } from './step-image';
import { StepInventory } from './step-inventory';
import { StepName } from './step-name';
import { StepPlace } from './step-place';
import { StepId } from './validation';

interface StepDef {
  id: StepId;
  label: string;
  icon: string;
}

export const STEPS: StepDef[] = [
  { id: 'image', label: 'Image', icon: 'image' },
  { id: 'identify', label: 'Identify', icon: 'fingerprint' },
  { id: 'inventory', label: 'Controls', icon: 'list' },
  { id: 'place', label: 'Place', icon: 'highlight_alt' },
  { id: 'name', label: 'Name', icon: 'label' },
  { id: 'check', label: 'Check', icon: 'fact_check' },
  { id: 'export', label: 'Export', icon: 'ios_share' },
];

/** The device layout editor: /devices/new and /devices/:id/edit. */
@Component({
  selector: 'app-layout-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [EditorStore],
  imports: [
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatProgressSpinnerModule,
    RouterLink,
    StepImage,
    StepIdentify,
    StepInventory,
    StepPlace,
    StepName,
    StepCheck,
    StepExport,
  ],
  templateUrl: './layout-editor.html',
  styleUrl: './layout-editor.scss',
})
export class LayoutEditor implements OnInit, OnDestroy {
  protected readonly store = inject(EditorStore);
  private readonly route = inject(ActivatedRoute);
  private readonly input = inject(InputService);
  private readonly snack = inject(MatSnackBar);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly steps = STEPS;
  protected readonly baseId = this.route.snapshot.paramMap.get('id');
  protected readonly isPhone = toSignal(
    inject(BreakpointObserver)
      .observe('(max-width: 599px)')
      .pipe(map((r) => r.matches)),
    { initialValue: false },
  );

  protected readonly title = computed(() => {
    const d = this.store.draft();
    if (this.baseId) return `Edit ${d.name || this.baseId}`;
    return d.name ? `New device: ${d.name}` : 'Map a new controller';
  });

  protected readonly stepIndex = computed(() => STEPS.findIndex((s) => s.id === this.store.step()));

  protected readonly done = computed<Record<StepId, boolean>>(() => {
    const d = this.store.draft();
    const issues = this.store.issues();
    const placeable = this.store.placeable();
    return {
      image: d.images.length > 0,
      identify: !!d.name.trim() && !!d.id && d.ids.length > 0 && !issues.some((i) => i.step === 'identify' && i.level === 'error'),
      inventory: d.controls.length > 0,
      place: d.images.length > 0 && placeable.length > 0 && placeable.every((c) => c.box),
      name: d.controls.length > 0 && d.controls.every((c) => c.label.trim()),
      check: d.controls.length > 0 && !issues.some((i) => i.level === 'error'),
      export: false,
    };
  });

  protected readonly issueCount = computed(() => {
    const counts: Partial<Record<StepId, number>> = {};
    for (const i of this.store.issues()) if (i.level === 'error') counts[i.step] = (counts[i.step] ?? 0) + 1;
    return counts;
  });

  private readonly keyHandler = (e: KeyboardEvent) => this.onKeydown(e);

  ngOnInit(): void {
    // Capture phase, so editor undo wins over the app's bindings undo.
    window.addEventListener('keydown', this.keyHandler, true);
    this.input.start();
    const bindsId = this.route.snapshot.queryParamMap.get('bindsId') ?? undefined;
    void this.store.open(this.baseId, { bindsId }).then(() => {
      if (this.store.restored()) {
        this.snack
          .open('Restored your unsaved work on this device.', 'Start over', { duration: 8000 })
          .onAction()
          .subscribe(() => void this.store.discard());
      }
      if (this.baseId && !this.store.restored() && this.store.draft().images.length) this.store.step.set('place');
    });
  }

  ngOnDestroy(): void {
    window.removeEventListener('keydown', this.keyHandler, true);
    this.input.stop();
  }

  protected go(delta: number): void {
    const i = Math.min(STEPS.length - 1, Math.max(0, this.stepIndex() + delta));
    this.store.step.set(STEPS[i].id);
    this.host.nativeElement.scrollIntoView({ block: 'start' });
  }

  protected async startOver(): Promise<void> {
    if (!confirm('Discard all changes made in the editor and start again?')) return;
    await this.store.discard();
  }

  protected async importZip(ev: Event): Promise<void> {
    const el = ev.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    try {
      await this.store.importZip(file);
      this.snack.open(`Imported ${file.name}`, undefined, { duration: 3000 });
    } catch (e) {
      this.snack.open((e as Error).message, 'OK', { duration: 8000 });
    }
  }

  /** Editor undo/redo (capture phase, so it wins over the app's bindings undo). */
  private onKeydown(e: KeyboardEvent): void {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest('input, textarea, select, [contenteditable="true"]')) return;
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.store.undo();
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      e.preventDefault();
      this.store.redo();
    }
  }
}
