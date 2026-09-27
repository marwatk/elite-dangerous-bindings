import { Pipe, PipeTransform, inject } from '@angular/core';
import { InputRef } from '../core/binds/binds-document';
import { CatalogService } from '../core/data/catalog.service';

/**
 * Friendly text for an input: `ref | inputLabel` -> "Logitech/Saitek X56 › TG1 (Trigger)",
 * `ref | inputLabel: 'control'` -> "TG1 (Trigger)", `'device'` -> "Logitech/Saitek X56".
 * Impure so labels update when device definitions finish loading.
 */
@Pipe({ name: 'inputLabel', pure: false })
export class InputLabelPipe implements PipeTransform {
  private readonly catalog = inject(CatalogService);

  transform(ref: InputRef | null | undefined, part: 'full' | 'control' | 'device' = 'full'): string {
    if (!ref || !ref.key || ref.device === '{NoDevice}') return '';
    if (part === 'control') return this.catalog.controlLabel(ref);
    if (part === 'device') return this.catalog.deviceName(ref.device, ref.deviceIndex ?? 0);
    return this.catalog.inputLabel(ref);
  }
}
