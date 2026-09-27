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

test('a nearly default X52 file has no conflicts; intentional overlaps are marked shared by design', async ({ page }) => {
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
  const x52 = readFileSync('src/testing/fixtures/X52.4.2.binds', 'utf-8');
  await (await chooser).setFiles({ name: 'Custom.4.2.binds', mimeType: 'application/xml', buffer: Buffer.from(x52) });
  await expect(page).toHaveURL(/\/bindings$/);

  // No row is marked as a conflict; SRV steering carries the "shared by design" marker.
  await expect(page.getByLabel('Conflict')).toHaveCount(0);
  await page.getByLabel('Filter commands').fill('SteeringAxis');
  await expect(page.getByRole('row').filter({ hasText: 'SteeringAxis' }).getByLabel('Shared by design')).toBeVisible();

  // Warnings lists them under "Shared by design", not as conflicts.
  await page.getByRole('button', { name: /^Warnings/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: /^Conflicts/ })).toHaveCount(0);
  await expect(dialog.getByRole('heading', { name: /Shared by design/ })).toBeVisible();
  await expect(dialog).toContainText('Steers on the ground, rolls while airborne');
  if (process.env['SHOTS']) await dialog.screenshot({ path: 'test-results/shots/bindings/warnings-shared.png' });
});

test.describe('also apply to related commands', () => {
  test.beforeEach(async ({ page }) => {
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
    const x52 = readFileSync('src/testing/fixtures/X52.4.2.binds', 'utf-8');
    await (await chooser).setFiles({ name: 'Custom.4.2.binds', mimeType: 'application/xml', buffer: Buffer.from(x52) });
    await expect(page).toHaveURL(/\/bindings$/);
  });

  const rowFor = (page: import('@playwright/test').Page, code: string) => page.getByRole('row').filter({ hasText: code });

  async function setSecondaryToF9(page: import('@playwright/test').Page, code: string) {
    await page.getByLabel('Filter commands').fill(code);
    await rowFor(page, code).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: /Secondary/ }).click();
    await dialog.getByRole('button', { name: 'Pick from list' }).click();
    // The picker opens on the slot's current device (the X52): switch to the keyboard.
    await dialog.getByRole('combobox', { name: 'Device' }).click();
    await page.getByRole('option', { name: 'Keyboard', exact: true }).click();
    await dialog.getByLabel('Find a control').fill('F9');
    await dialog.getByRole('button', { name: /^F9\b/ }).first().click();
    await expect(dialog.getByRole('region', { name: 'Also apply to' })).toBeVisible();
    return dialog;
  }

  test('SRV power distribution follows the ship (equivalent commands), one undo reverts both', async ({ page }) => {
    const dialog = await setSecondaryToF9(page, 'IncreaseEnginesPower');
    const srv = dialog.locator('mat-checkbox[data-code="IncreaseEnginesPower_Buggy"] input');
    await expect(srv).toBeChecked();
    if (process.env['SHOTS']) await dialog.screenshot({ path: 'test-results/shots/bindings/also-apply-power.png' });
    await expect(dialog).toContainText('+ 1 linked');
    await dialog.getByRole('button', { name: 'Apply' }).click();

    await page.getByLabel('Filter commands').fill('IncreaseEnginesPower_Buggy');
    await expect(rowFor(page, 'IncreaseEnginesPower_Buggy')).toContainText('F9');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(rowFor(page, 'IncreaseEnginesPower_Buggy')).not.toContainText('F9');
    await page.getByLabel('Filter commands').fill('IncreaseEnginesPower');
    await expect(rowFor(page, 'IncreaseEnginesPower').first()).not.toContainText('F9');
  });

  test('commands sharing W get the same secondary when ticked, keeping W as primary', async ({ page }) => {
    const dialog = await setSecondaryToF9(page, 'UI_Up');
    const group = dialog.locator('.link-group').filter({ hasText: /Also using Keyboard › W/ });
    await expect(group).toBeVisible();
    const forward = group.locator('mat-checkbox[data-code="ForwardKey"] input');
    await expect(forward).not.toBeChecked();
    await forward.check();
    if (process.env['SHOTS']) await dialog.screenshot({ path: 'test-results/shots/bindings/also-apply-w.png' });
    await dialog.getByRole('button', { name: 'Apply' }).click();

    await page.getByLabel('Filter commands').fill('ForwardKey');
    const row = rowFor(page, 'ForwardKey');
    await expect(row).toContainText('F9');
    await expect(row).toContainText('W');
    // Not ticked: on-foot forward is unchanged.
    await page.getByLabel('Filter commands').fill('HumanoidForwardButton');
    await expect(rowFor(page, 'HumanoidForwardButton')).not.toContainText('F9');
  });
});

test('clicking the Secondary cell edits the secondary binding; anywhere else edits the primary', async ({ page }) => {
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
  await page.getByLabel('Filter commands').fill('LandingGearToggle');
  const row = page.getByRole('row', { name: 'Edit Landing Gear' });
  const dialog = page.getByRole('dialog');

  await row.locator('td.c-secondary').click();
  await expect(dialog.getByRole('radio', { name: /Secondary/ })).toBeChecked();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  await row.getByText('Landing Gear', { exact: true }).click();
  await expect(dialog.getByRole('radio', { name: /Primary/ })).toBeChecked();
});
