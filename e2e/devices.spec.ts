import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

/** A plain RGB PNG with a darker square in the middle. */
function makePng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      const inside = x > width / 3 && x < (2 * width) / 3 && y > height / 3 && y < (2 * height) / 3;
      row.fill(inside ? 60 : 225, 1 + x * 3, 4 + x * 3);
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('device list shows many devices and search narrows them', async ({ page }) => {
  await page.goto('/devices');
  const cards = page.locator('a.card');
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeGreaterThan(60);
  await page.getByTestId('device-search').fill('x56');
  await expect(page.locator('a.card[data-device="SaitekX56"]')).toBeVisible();
  expect(await cards.count()).toBeLessThan(5);
  // Search by USB ID too.
  await page.getByTestId('device-search').fill('231D:0200');
  await expect(page.locator('a.card[data-device="VKB-Gladiator-NXT-Premium-Right"]')).toBeVisible();
});

test('X56 detail page renders its diagram', async ({ page }) => {
  await page.goto('/devices/SaitekX56');
  await expect(page.getByRole('heading', { name: 'Logitech/Saitek X56' })).toBeVisible();
  const svg = page.locator('app-device-diagram svg');
  await expect(svg).toBeVisible();
  await expect(svg.locator('image')).toHaveAttribute('href', /devices\/SaitekX56\/x56\.webp/);
  expect(await svg.locator('g.control').count()).toBeGreaterThan(50);
  await page.getByText('Boxes only').click();
  await expect(svg.locator('foreignObject')).toHaveCount(0);
  await expect(page.getByRole('cell', { name: 'SaitekX56Joystick' }).first()).toBeVisible();
});

test('layout editor: image, identify, controls, place, export', async ({ page }) => {
  await page.goto('/devices/new');
  await expect(page.getByRole('heading', { name: 'Map a new controller' })).toBeVisible();

  // 1. Image
  await page.getByTestId('image-input').setInputFiles({ name: 'stick.png', mimeType: 'image/png', buffer: makePng(800, 450) });
  await expect(page.locator('.img-card img')).toBeVisible();
  await expect(page.locator('.img-card')).toContainText('800 × 450');

  // 2. Identify
  await page.getByRole('button', { name: /Next: Identify/ }).click();
  await page.getByTestId('device-name').fill('Test Stick');
  await expect(page.getByTestId('device-id')).toHaveValue('Test-Stick');
  await page.getByTestId('binds-id').fill('12345678');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.ids-table')).toContainText('1234:5678');

  // 3. Controls
  await page.getByRole('button', { name: /Next: Controls/ }).click();
  for (const key of ['Joy_1', 'Joy_2', 'Joy_XAxis']) {
    await page.getByTestId('new-key').fill(key);
    await page.getByTestId('new-key').press('Enter');
  }
  await expect(page.getByRole('heading', { name: '3 controls' })).toBeVisible();

  // 4. Place: draw a box for the first control.
  await page.getByRole('button', { name: /Next: Place/ }).click();
  const canvas = page.getByTestId('place-canvas');
  await expect(canvas).toBeVisible();
  await expect(page.locator('.status')).toContainText('Button 1');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.15, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByText('1 / 3 placed')).toBeVisible();
  // Auto-advanced to the next control.
  await expect(page.locator('.status')).toContainText('Button 2');
  // Undo and redo the box.
  await page.keyboard.press('Control+z');
  await expect(page.getByText('0 / 3 placed')).toBeVisible();
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByText('1 / 3 placed')).toBeVisible();

  // Work survives a reload (autosave).
  await page.waitForTimeout(1000);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'New device: Test Stick' })).toBeVisible();

  // 7. Export
  await page.getByRole('button', { name: /Export/ }).first().click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-zip').click()]);
  expect(download.suggestedFilename()).toBe('Test-Stick.zip');
  const zip = await JSZip.loadAsync(readFileSync((await download.path())!));
  const files = Object.keys(zip.files).filter((f) => !zip.files[f].dir);
  expect(files).toEqual(
    expect.arrayContaining(['devices/Test-Stick/device.json', 'buttonmaps/12345678.buttonMap', 'CONTRIBUTING-DEVICE.md']),
  );
  const def = JSON.parse(await zip.file('devices/Test-Stick/device.json')!.async('string'));
  expect(def).toMatchObject({ id: 'Test-Stick', name: 'Test Stick', source: 'user', ids: [{ bindsId: '12345678', usb: { vid: '1234', pid: '5678' } }] });
  expect(def.images).toHaveLength(1);
  expect(files).toContain(`devices/Test-Stick/${def.images[0].file}`);
  expect(def.images[0]).toMatchObject({ width: 800, height: 450 });
  const joy1 = def.controls.find((c: { key: string }) => c.key === 'Joy_1');
  expect(joy1.box.w).toBeGreaterThan(50);
  const map = await zip.file('buttonmaps/12345678.buttonMap')!.async('string');
  expect(map).toContain('<Joy_1>Button 1</Joy_1>');

  // Save to this browser: it becomes a normal device.
  await page.getByRole('button', { name: /Save to this browser/ }).click();
  await expect(page).toHaveURL(/\/devices\/Test-Stick$/);
  await expect(page.getByText('Mine (this browser)')).toBeVisible();
  await expect(page.locator('app-device-diagram g.control')).toHaveCount(1);
});
