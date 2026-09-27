import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { SlotName } from '../../core/binds/binds-document';
import { CatalogService } from '../../core/data/catalog.service';
import { BindingsView } from './bindings-view.service';
import { parseDescribedSlot } from './changes-model';
import { SlotView } from './slot-view';
import { TARGET_VIRTUAL_DEVICE } from './warnings-model';

export type WarningsPanelResult = { edit: string; slot?: SlotName } | { device: string } | undefined;

@Component({
  selector: 'app-warnings-panel',
  imports: [MatDialogModule, MatButtonModule, MatIconModule, RouterLink, SlotView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Warnings <span class="muted count">({{ report().count }})</span></h2>
    <mat-dialog-content>
      @if (report().count === 0) {
        <p class="ok"><mat-icon inline>check_circle</mat-icon> No problems found.</p>
        @if (report().empty) {
          <p class="muted">This file has no bindings yet.</p>
        }
      }

      @if (report().noSupported) {
        <section class="w">
          <h3><mat-icon inline>help</mat-icon>No supported devices</h3>
          <p>
            None of the devices in this file is the keyboard, mouse, a gamepad or a supported controller, so the table
            and reference cards can only show raw control codes. See below for the device IDs, and add a definition on
            the <a routerLink="/devices" mat-dialog-close>Devices</a> page.
          </p>
        </section>
      }

      @if (report().targetVirtual) {
        <section class="w">
          <h3><mat-icon inline>layers</mat-icon>Thrustmaster TARGET virtual device</h3>
          <p>
            This file uses <code>{{ target }}</code>, the combined virtual device that Thrustmaster's TARGET software
            creates. Controls are then numbered by your TARGET script rather than the hardware, so some may not appear
            or may have different names here. If you don't use TARGET any more, move these bindings to the real stick
            and throttle IDs with <strong>Bulk actions › Move device</strong>.
          </p>
          <button matButton type="button" class="small" (click)="showDevice(target, 0)">Show its bindings</button>
        </section>
      }

      @if (report().conflicts.length) {
        <section class="w">
          <h3><mat-icon inline>error</mat-icon>Conflicts ({{ report().conflicts.length }})</h3>
          <p class="muted">The same control (with the same modifiers) does more than one thing in the same context.</p>
          <ul>
            @for (c of conflicts(); track c.key) {
              <li>
                <div class="input">
                  @if (c.binding) {
                    <app-slot-view [binding]="c.binding" />
                  }
                  <span class="muted">in {{ c.group }}</span>
                </div>
                <div class="links">
                  @for (u of c.uses; track u.code + u.slot) {
                    <button matButton type="button" class="small" (click)="edit(u.code, u.slot)" [attr.title]="u.code">
                      {{ name(u.code) }}
                      <span class="muted">({{ c.dupNames ? u.code + ', ' : '' }}{{ u.slot }})</span>
                    </button>
                  }
                </div>
              </li>
            }
          </ul>
        </section>
      }

      @if (report().axisMisuse.length) {
        <section class="w">
          <h3><mat-icon inline>swap_vert</mat-icon>Button commands on an axis ({{ report().axisMisuse.length }})</h3>
          <p class="muted">
            These are on/off commands bound to a whole analogue axis. The game only triggers them when the axis passes
            its end, so they often fire at random or never. Rebind them to a button, a hat direction, or one half of
            the axis (shown as <em>+</em> or <em>−</em> in the list).
          </p>
          <ul>
            @for (u of report().axisMisuse; track u.code + u.slot) {
              <li>
                <button matButton type="button" class="small" (click)="edit(u.code, u.slot)">{{ name(u.code) }}</button>
                <app-slot-view [binding]="u.binding" />
              </li>
            }
          </ul>
        </section>
      }

      @if (report().unknownDevices.length) {
        <section class="w">
          <h3><mat-icon inline>device_unknown</mat-icon>Unknown devices ({{ report().unknownDevices.length }})</h3>
          <p class="muted">
            These device IDs have no definition yet, so controls show generic names (e.g. “Stick 12”) and there's no
            artwork for reference cards. You can map one yourself with the layout editor on the
            <a routerLink="/devices" mat-dialog-close>Devices</a> page, and contribute it to the project.
          </p>
          <ul>
            @for (d of report().unknownDevices; track d.device + d.deviceIndex) {
              <li>
                <code>{{ d.device }}</code>
                @if (d.deviceIndex > 0) {
                  <span class="muted">index {{ d.deviceIndex }}</span>
                }
                <button matButton type="button" class="small" (click)="showDevice(d.device, d.deviceIndex)">
                  Show its bindings
                </button>
              </li>
            }
          </ul>
        </section>
      }
    </mat-dialog-content>
    <mat-dialog-actions>
      <button matButton="filled" type="button" mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: `
    .count {
      font-size: 0.8em;
    }
    .ok {
      color: var(--edb-ok);
      font-weight: 500;
    }
    .w {
      padding: 4px 0 12px;
      border-bottom: 1px solid var(--edb-border);
    }
    h3 {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 1rem;
      margin: 12px 0 4px;
    }
    h3 mat-icon {
      color: var(--edb-warning);
    }
    ul {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 8px;
      padding: 6px 0;
    }
    li + li {
      border-top: 1px dashed var(--edb-border);
    }
    .input {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 8px;
      align-items: center;
      width: 100%;
    }
    .links {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .small {
      --mat-button-text-container-height: 32px;
    }
  `,
})
export class WarningsPanel {
  private readonly view = inject(BindingsView);
  private readonly catalog = inject(CatalogService);
  private readonly ref = inject<MatDialogRef<WarningsPanel, WarningsPanelResult>>(MatDialogRef);

  protected readonly target = TARGET_VIRTUAL_DEVICE;
  protected readonly report = this.view.warnings;
  protected readonly conflicts = computed(() =>
    this.report().conflicts.map((c) => ({
      ...c,
      key: `${c.group}|${c.input}|${c.modifiers}`,
      binding: c.uses[0]?.binding ?? parseDescribedSlot(c.input),
      dupNames: new Set(c.uses.map((u) => this.name(u.code))).size < c.uses.length,
    })),
  );

  protected name(code: string): string {
    return this.catalog.action(code).longName;
  }

  protected showDevice(device: string, deviceIndex: number): void {
    this.ref.close({ device: `${device}::${deviceIndex}` });
  }

  protected edit(code: string, slot?: SlotName): void {
    this.ref.close({ edit: code, slot });
  }
}
