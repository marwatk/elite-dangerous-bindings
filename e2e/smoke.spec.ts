import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('home page loads and opens a bindings file', async ({ page }) => {
  // Use the <input type=file> fallback: Playwright can't drive the File System Access picker.
  await page.addInitScript(() => delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Elite Dangerous Bindings' })).toBeVisible();
  const text = readFileSync('src/testing/fixtures/Custom.4.2.binds', 'utf-8');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open your bindings file/ }).click();
  await (await chooser).setFiles({ name: 'Custom.4.2.binds', mimeType: 'application/xml', buffer: Buffer.from(text) });
  await expect(page).toHaveURL(/\/bindings$/);
  await expect(page.getByText('Custom.4.2.binds').first()).toBeVisible();
});

test('a share link opens the file it contains', async ({ page }) => {
  const text = readFileSync('src/testing/fixtures/Custom.4.2.binds', 'utf-8');
  await page.goto('/about');
  const hash = await page.evaluate(async (t) => {
    const src = new ReadableStream({ start: (c) => { c.enqueue(new TextEncoder().encode(t)); c.close(); } });
    const buf = new Uint8Array(await new Response(src.pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    let bin = '';
    buf.forEach((b) => (bin += String.fromCharCode(b)));
    return `b=${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}&n=Shared.4.2.binds`;
  }, text);
  await page.goto(`/#${hash}`);
  await expect(page).toHaveURL(/\/bindings$/);
  await expect(page.getByText('Shared.4.2.binds').first()).toBeVisible();
});
