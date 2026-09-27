import { existsSync, readFileSync } from 'node:fs';

/** A tracked test fixture from src/testing/fixtures/. */
export function fixture(name: string): string {
  return readFileSync(`src/testing/fixtures/${name}`, 'utf-8');
}

/**
 * Move every binding on one device ID to another, so a tracked fixture can
 * exercise another controller's card (the key numbers won't match that
 * controller's real layout, but every labelled box still gets text).
 */
export function remap(text: string, from: string, to: string, preset: string): string {
  return text.replaceAll(`Device="${from}"`, `Device="${to}"`).replace(/PresetName="[^"]*"/, `PresetName="${preset}"`);
}

/** A file from upstream/ (tools/fetch-upstream.sh), or null when it hasn't been fetched. */
export function upstream(path: string): string | null {
  const full = `upstream/${path}`;
  return existsSync(full) ? readFileSync(full, 'utf-8') : null;
}
