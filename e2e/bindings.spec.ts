import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const FIXTURE = readFileSync('src/testing/fixtures/Custom.4.2.binds', 'utf-8');

test('edit a binding from the table, see it in Changes, undo it, and export', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
    try {
      localStorage.removeItem('edb.bindings.view');
    } catch {
      /* ignore */
    }
  });
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open your bindings file/ }).click();
  await (await chooser).setFiles({ name: 'Custom.4.2.binds', mimeType: 'application/xml', buffer: Buffer.from(FIXTURE) });
  await expect(page).toHaveURL(/\/bindings$/);

  // Filter the table down to one command.
  await page.getByLabel('Filter commands').fill('LandingGearToggle');
  const row = page.getByRole('row', { name: 'Edit Landing Gear' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('K');

  // Open the editor from the row and pick a keyboard key by name.
  await row.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Landing Gear' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Pick from list' }).click();
  await dialog.getByLabel('Find a control').fill('F9');
  await dialog.getByRole('button', { name: /^F9\b/ }).first().click();
  await expect(dialog.getByText('Replaces')).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toHaveCount(0);

  // The table shows the new key and the row is marked as changed.
  await expect(row).toContainText('F9');
  await expect(row.getByLabel('Changed')).toBeVisible();

  // It's listed in Changes.
  await page.getByRole('button', { name: /^Changes \(1\)/ }).click();
  const changes = page.getByRole('dialog');
  await expect(changes.getByRole('button', { name: 'Landing Gear', exact: true })).toBeVisible();
  await expect(changes).toContainText('F9');
  await changes.getByRole('button', { name: 'Close' }).click();
  await expect(changes).toHaveCount(0);

  // Undo from the app toolbar restores the original key.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(row).not.toContainText('F9');
  await expect(row).toContainText('K');
  await expect(page.getByRole('button', { name: /^Changes \(0\)/ })).toBeVisible();

  // Export dialog shows the file name the game expects.
  await page.getByRole('button', { name: 'Export / install' }).click();
  await expect(page.getByTestId('export-file-name')).toHaveText('Custom.4.2.binds');
});

test('shows an empty state with no file open', async ({ page }) => {
  await page.goto('/bindings');
  await expect(page.getByRole('heading', { name: 'No bindings file is open' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New empty file' })).toBeVisible();
});
