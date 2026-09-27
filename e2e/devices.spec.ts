import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';

type Rgb = [number, number, number];

/** A plain RGB PNG with a darker square in the middle (a "controller" on a solid background). */
function makePng(width: number, height: number, bg: Rgb = [225, 225, 225], fg: Rgb = [60, 60, 60]): Buffer {
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
      row.set(inside ? fg : bg, 1 + x * 3);
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
  const box = (await canvas.locator('image').boundingBox())!;
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

test('layout editor: boxes beside a controller-only photo grow the exported canvas', async ({ page }) => {
  const bg: Rgb = [40, 110, 170];
  const fg: Rgb = [20, 20, 20];
  await page.goto('/devices/new');
  await page.getByTestId('image-input').setInputFiles({ name: 'pad.png', mimeType: 'image/png', buffer: makePng(400, 300, bg, fg) });
  await expect(page.locator('.img-card')).toContainText('400 × 300');
  await page.getByRole('button', { name: /Next: Identify/ }).click();
  await page.getByTestId('device-name').fill('Pad Stick');
  await page.getByTestId('binds-id').fill('12345679');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: /Next: Controls/ }).click();
  for (const key of ['Joy_1', 'Joy_2']) {
    await page.getByTestId('new-key').fill(key);
    await page.getByTestId('new-key').press('Enter');
  }

  await page.getByRole('button', { name: /Next: Place/ }).click();
  const canvas = page.getByTestId('place-canvas');
  await canvas.scrollIntoViewIfNeeded();
  // Photo pixels to screen (the workspace extends beyond the photo on every side).
  const at = async (x: number, y: number) => {
    const r = (await canvas.locator('image').boundingBox())!;
    return { x: r.x + (x / 400) * r.width, y: r.y + (y / 300) * r.height };
  };
  const drag = async (a: { x: number; y: number }, b: { x: number; y: number }) => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
  };
  const setBox = async (label: string, box: number[]) => {
    await page.locator('.checklist .item', { hasText: label }).click();
    const fields = page.locator('.inspector input.num');
    for (let i = 0; i < 4; i++) {
      await fields.nth(i).fill(String(box[i]));
      await fields.nth(i).blur();
    }
  };
  const outline = canvas.getByTestId('canvas-outline');
  await expect(outline).toHaveAttribute('width', '400');

  // Button 1: partly beside the photo on the right, with a leader line to the photo.
  await drag(await at(300, 100), await at(460, 130));
  await expect(page.getByText('1 / 2 placed')).toBeVisible();
  await setBox('Joy_1', [300, 100, 200, 30]);
  await expect(outline).toHaveAttribute('width', '548');
  await page.getByTestId('draw-line').click();
  const anchor = await at(200, 150);
  await page.mouse.click(anchor.x, anchor.y);
  await expect(canvas.locator('g.leader')).toHaveCount(1);

  // Button 2: out to the left of the photo.
  await page.locator('.checklist .item', { hasText: 'Joy_2' }).click();
  await drag(await at(-40, 200), await at(30, 230));
  await expect(page.getByText('2 / 2 placed')).toBeVisible();
  await setBox('Joy_2', [-150, 200, 200, 30]);
  await expect(outline).toHaveAttribute('x', '-198');
  await expect(outline).toHaveAttribute('width', '746');

  // The canvas menu: detected background and output size.
  await page.getByTestId('canvas-button').click();
  const panel = page.getByTestId('canvas-panel');
  await expect(panel.getByTestId('detected-colour')).toBeVisible();
  const detected = (await panel.getByTestId('detected-colour').textContent())!.trim();
  const hex = (c: string): Rgb => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as Rgb;
  const near = (a: number[], b: number[], tol: number) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
  expect(near(hex(detected), bg, 4)).toBe(true);
  await expect(panel.getByTestId('canvas-size')).toHaveText('746 × 300');
  await expect(canvas.locator('rect.backdrop')).toHaveAttribute('fill', detected);
  await page.getByTestId('canvas-button').click();

  // Export: the image grew to hold the boxes, and everything moved by the same offset.
  await page.getByRole('button', { name: /Export/ }).first().click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-zip').click()]);
  const zip = await JSZip.loadAsync(readFileSync((await download.path())!));
  const def = JSON.parse(await zip.file('devices/Pad-Stick/device.json')!.async('string'));
  expect(def.images[0]).toMatchObject({ width: 746, height: 300 });
  const byKey = (k: string) => def.controls.find((c: { key: string }) => c.key === k);
  expect(byKey('Joy_1').box).toEqual({ x: 498, y: 100, w: 200, h: 30 });
  expect(byKey('Joy_2').box).toEqual({ x: 48, y: 200, w: 200, h: 30 });
  expect(byKey('Joy_1').leader).toHaveLength(1);
  const a = byKey('Joy_1').leader[0];
  expect(Math.abs(a.x - 398)).toBeLessThanOrEqual(3);
  expect(Math.abs(a.y - 150)).toBeLessThanOrEqual(3);
  const imageBytes = await zip.file(`devices/Pad-Stick/${def.images[0].file}`)!.async('base64');
  const px = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes]));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const at = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data];
    return { size: [bmp.width, bmp.height], left: at(20, 20), right: at(730, 280), photo: at(398, 150) };
  }, imageBytes);
  expect(px.size).toEqual([746, 300]);
  // New area on both sides: the detected background; the photo itself is unchanged (dark controller in the middle).
  expect(near(px.left, [...hex(detected), 255], 8)).toBe(true);
  expect(near(px.right, [...hex(detected), 255], 8)).toBe(true);
  expect(near(px.photo, [...fg, 255], 12)).toBe(true);
});

test('layout editor: control groups (hat + push, rocker) on the editor, export and reference card', async ({ page }) => {
  await page.addInitScript(() => delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker);
  await page.goto('/devices/new');
  await page.getByTestId('image-input').setInputFiles({ name: 'grp.png', mimeType: 'image/png', buffer: makePng(800, 450) });
  await page.getByRole('button', { name: /Next: Identify/ }).click();
  await page.getByTestId('device-name').fill('Group Stick');
  await page.getByTestId('binds-id').fill('12340001');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: /Next: Controls/ }).click();
  for (const key of ['Joy_1', 'Joy_POV1Up', 'Joy_POV1Right', 'Joy_POV1Down', 'Joy_POV1Left', 'Joy_5', 'Joy_6', 'Joy_7']) {
    await page.getByTestId('new-key').fill(key);
    await page.getByTestId('new-key').press('Enter');
  }
  await expect(page.getByRole('heading', { name: '8 controls' })).toBeVisible();
  const tick = async (keys: string[]) => {
    for (const k of keys) await page.locator(`input[type=checkbox][data-key="${k}"]`).check();
  };

  // Hat: 4 POV directions + push. Arrows are filled in from the keys; the push gets ● from the palette.
  await tick(['Joy_POV1Up', 'Joy_POV1Right', 'Joy_POV1Down', 'Joy_POV1Left', 'Joy_5']);
  await page.getByTestId('group-selected').click();
  const dialog = page.locator('app-group-dialog');
  await expect(dialog.getByTestId('group-label')).toHaveValue('H1');
  await expect(dialog.getByTestId('marker-0')).toHaveValue('↑');
  await expect(dialog.getByTestId('marker-3')).toHaveValue('←');
  await expect(dialog.getByTestId('marker-4')).toHaveValue('');
  await expect(dialog.getByTestId('group-save')).toBeDisabled();
  await dialog.locator('.palette button[data-marker="●"]').click();
  await expect(dialog.getByTestId('marker-4')).toHaveValue('●');
  await dialog.getByTestId('group-save').click();
  await expect(page.locator('.group-chip')).toHaveCount(1);

  // Rocker: two buttons side by side.
  await tick(['Joy_6', 'Joy_7']);
  await page.getByTestId('group-selected').click();
  await dialog.getByTestId('group-label').fill('Rocker');
  await dialog.getByTestId('layout-row').click();
  await dialog.locator('.member').first().click();
  await dialog.locator('.palette button[data-marker="+"]').click();
  await dialog.locator('.palette button[data-marker="−"]').click();
  await dialog.getByTestId('group-save').click();
  await expect(page.locator('.group-chip')).toHaveCount(2);
  // Members are named after the group.
  await expect(page.locator('tr', { hasText: 'Joy_POV1Right' })).toContainText('H1 →');
  await expect(page.locator('tr', { hasText: 'Joy_7' })).toContainText('Rocker −');

  // Place: one box per group.
  await page.getByRole('button', { name: /Next: Place/ }).click();
  await expect(page.getByText('0 / 3 placed')).toBeVisible();
  const canvas = page.getByTestId('place-canvas');
  await canvas.scrollIntoViewIfNeeded();
  const drawAt = async (x1: number, y1: number, x2: number, y2: number) => {
    const r = (await canvas.locator('image').boundingBox())!;
    await page.mouse.move(r.x + r.width * x1, r.y + r.height * y1);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width * x2, r.y + r.height * y2, { steps: 5 });
    await page.mouse.up();
  };
  await drawAt(0.05, 0.08, 0.4, 0.14); // Button 1
  await expect(page.locator('.status')).toContainText('H1');
  await drawAt(0.55, 0.08, 0.95, 0.6); // H1
  await expect(page.locator('.status')).toContainText('Rocker');
  await drawAt(0.05, 0.7, 0.45, 0.8); // Rocker
  await expect(page.getByText('3 / 3 placed')).toBeVisible();
  await expect(canvas.locator('.group-marker')).toHaveCount(4 + 1 + 2);

  // Export.
  await page.getByRole('button', { name: /Export/ }).first().click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download-zip').click()]);
  const zip = await JSZip.loadAsync(readFileSync((await download.path())!));
  const def = JSON.parse(await zip.file('devices/Group-Stick/device.json')!.async('string'));
  expect(def.drawBoxes).toBe(true);
  expect(def.groups.map((g: { id: string; label: string; layout: string; members: { key: string; marker: string }[] }) => [g.id, g.label, g.layout, g.members.map((m) => `${m.key}=${m.marker}`)])).toEqual([
    ['H1', 'H1', 'stack', ['Joy_POV1Up=↑', 'Joy_POV1Right=→', 'Joy_POV1Down=↓', 'Joy_POV1Left=←', 'Joy_5=●']],
    ['Rocker', 'Rocker', 'row', ['Joy_6=+', 'Joy_7=−']],
  ]);
  expect(def.groups[0].box.h).toBeGreaterThan(150);
  const up = def.controls.find((c: { key: string }) => c.key === 'Joy_POV1Up');
  expect(up).toEqual({ bindsId: '12340001', key: 'Joy_POV1Up', label: 'H1 ↑', kind: 'hat' });
  const map = await zip.file('buttonmaps/12340001.buttonMap')!.async('string');
  expect(map).toContain('<Joy_5>H1 ●</Joy_5>');

  // Save it, open bindings that use the group members, and look at the reference card.
  await page.getByRole('button', { name: /Save to this browser/ }).click();
  await expect(page).toHaveURL(/\/devices\/Group-Stick$/);
  await expect(page.locator('app-device-diagram g.group')).toHaveCount(2);
  const binds = `<?xml version="1.0" encoding="UTF-8" ?>
<Root PresetName="Groups" MajorVersion="4" MinorVersion="2">
<PrimaryFire><Primary Device="12340001" Key="Joy_POV1Up" /><Secondary Device="{NoDevice}" Key="" /></PrimaryFire>
<SecondaryFire><Primary Device="12340001" Key="Joy_5" /><Secondary Device="{NoDevice}" Key="" /></SecondaryFire>
<UseBoostJuice><Primary Device="12340001" Key="Joy_7" /><Secondary Device="{NoDevice}" Key="" /></UseBoostJuice>
<LandingGearToggle><Primary Device="12340001" Key="Joy_1" /><Secondary Device="{NoDevice}" Key="" /></LandingGearToggle>
</Root>
`;
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Open your bindings file/ }).click();
  await (await chooser).setFiles({ name: 'Groups.4.2.binds', mimeType: 'application/xml', buffer: Buffer.from(binds) });
  await expect(page).toHaveURL(/\/bindings$/);
  await page.getByRole('link', { name: 'Reference cards' }).click();
  const card = page.locator('app-card-svg svg').first();
  await card.waitFor({ timeout: 30_000 });
  const hat = card.locator('g.group[data-group="H1"]');
  await expect(hat.locator('g.member')).toHaveCount(5);
  await expect(hat.locator('g.member[data-key="Joy_POV1Up"]')).toContainText('Fire 1');
  await expect(hat.locator('g.member[data-key="Joy_5"]')).toContainText('Fire 2');
  // Unbound rows stay, empty, with their marker.
  await expect(hat.locator('g.member[data-key="Joy_POV1Down"]')).toHaveAttribute('data-marker', '↓');
  await expect(hat.locator('g.member[data-key="Joy_POV1Down"] text')).toHaveCount(0);
  const rocker = card.locator('g.group[data-group="Rocker"]');
  await expect(rocker.locator('g.member[data-key="Joy_7"]')).toContainText('Boost');
  await expect(rocker.locator('g.member[data-key="Joy_6"] text')).toHaveCount(0);
  await expect(card.locator('g.spot', { hasText: 'Landing Gear' }).locator('rect.box')).toHaveCount(1);
});

test('layout editor: pressing a control on the controller highlights its row in Controls', async ({ page }) => {
  // A fake joystick (USB 1234:5678) through the Gamepad API; WebHID hidden.
  await page.addInitScript(() => {
    const pad = {
      index: 0,
      id: 'Test Stick (Vendor: 1234 Product: 5678)',
      mapping: '',
      connected: true,
      timestamp: 0,
      buttons: Array.from({ length: 8 }, () => ({ pressed: false, touched: false, value: 0 })),
      axes: [0, 0, 0, 0],
    };
    const w = window as unknown as { __press: (i: number, d: boolean) => void; __axis: (i: number, v: number) => void };
    w.__press = (i, down) => {
      pad.buttons[i] = { pressed: down, touched: down, value: down ? 1 : 0 };
      pad.timestamp++;
    };
    w.__axis = (i, v) => {
      pad.axes[i] = v;
      pad.timestamp++;
    };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad, null, null, null], configurable: true });
    try {
      Object.defineProperty(Navigator.prototype, 'hid', { get: () => undefined, configurable: true });
    } catch {
      /* ignore */
    }
  });
  const press = (i: number, down: boolean) =>
    page.evaluate(([i, d]) => (window as unknown as { __press: (i: number, d: boolean) => void }).__press(i, d), [i, down] as const);
  const axis = (i: number, v: number) =>
    page.evaluate(([i, v]) => (window as unknown as { __axis: (i: number, v: number) => void }).__axis(i, v), [i, v] as const);

  await page.goto('/devices/new');
  await page.getByTestId('image-input').setInputFiles({ name: 'stick.png', mimeType: 'image/png', buffer: makePng(400, 300) });
  await page.getByRole('button', { name: /Next: Identify/ }).click();
  await page.getByTestId('device-name').fill('Live Stick');
  await page.getByTestId('binds-id').fill('12345678');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: /Next: Controls/ }).click();
  for (const key of ['Joy_1', 'Joy_2', 'Joy_3', 'Joy_XAxis']) {
    await page.getByTestId('new-key').fill(key);
    await page.getByTestId('new-key').press('Enter');
  }
  const row = (key: string) => page.locator(`tr[data-row-key="${key}"]`);

  // Holding button 2 lights its row; letting go clears it.
  await press(1, true);
  await expect(row('Joy_2')).toHaveClass(/\blive\b/);
  await expect(row('Joy_1')).not.toHaveClass(/\blive\b/);
  if (process.env['SHOTS']) await page.locator('.panel.list').screenshot({ path: 'test-results/shots/devices/controls-live-row.png' });
  await press(1, false);
  await expect(row('Joy_2')).not.toHaveClass(/\blive\b/);

  // Moving the X axis lights the axis row while it's away from rest.
  await axis(0, 0.9);
  await expect(row('Joy_XAxis')).toHaveClass(/\blive\b/);
  await axis(0, 0);
  await expect(row('Joy_XAxis')).not.toHaveClass(/\blive\b/);

  // A control not in the list yet is added as it's pressed, and highlighted.
  await press(5, true);
  await expect(row('Joy_6')).toHaveClass(/\blive\b/);
  await press(5, false);
});
