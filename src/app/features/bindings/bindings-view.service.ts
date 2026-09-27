import { Injectable, computed, inject } from '@angular/core';
import { ActionMeta } from '../../core/binds/analysis';
import { InputRef } from '../../core/binds/binds-document';
import { CatalogService } from '../../core/data/catalog.service';
import { BindingsStore } from '../../core/state/bindings-store.service';
import { buildRows, deviceKey } from './table-model';
import { buildWarnings, conflictCodes } from './warnings-model';

/** Derived views of the open file shared by the bindings page and its dialogs. */
@Injectable({ providedIn: 'root' })
export class BindingsView {
  private readonly store = inject(BindingsStore);
  private readonly catalog = inject(CatalogService);

  /** Action metadata for the analysis functions (reactive: reads the catalogue signal). */
  readonly meta = (code: string): ActionMeta => this.catalog.action(code);

  readonly warnings = computed(() => {
    this.catalog.devices();
    return buildWarnings(this.store.actions(), this.meta, this.store.devicesUsed(), (d, i) => !!this.catalog.deviceFor(d, i));
  });

  readonly conflictCodes = computed(() => conflictCodes(this.warnings().conflicts));
  readonly changedCodes = computed(() => new Set(this.store.changes().map((c) => c.code)));

  readonly rows = computed(() => {
    // Labels change when device definitions finish loading.
    this.catalog.definitions();
    this.catalog.keys();
    return buildRows(
      this.store.actions(),
      (c) => this.catalog.action(c),
      (r: InputRef) => this.catalog.inputLabel(r),
      this.conflictCodes(),
      this.changedCodes(),
    );
  });

  /** Devices used in the file, labelled, for selects. */
  readonly deviceOptions = computed(() => {
    this.catalog.devices();
    return this.store
      .devicesUsed()
      .map((d) => ({
        key: deviceKey(d),
        device: d.device,
        deviceIndex: d.deviceIndex,
        label: this.catalog.deviceName(d.device, d.deviceIndex),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  readonly groups = computed(() => {
    const seen = new Set<string>();
    for (const a of this.store.actions()) seen.add(this.catalog.action(a.code).group);
    return [...seen].sort();
  });
}
