import { EnvironmentProviders, inject, provideAppInitializer } from '@angular/core';
import { LocalDeviceStore } from './local-device-store.service';

/** Load devices saved with the layout editor into the catalogue at startup. Never blocks for long or fails startup. */
export function provideLocalDevices(): EnvironmentProviders {
  return provideAppInitializer(() => {
    const init = inject(LocalDeviceStore).init().catch(() => undefined);
    return Promise.race([init, new Promise<void>((r) => setTimeout(r, 2000))]);
  });
}
