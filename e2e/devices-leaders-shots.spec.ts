import { Page, expect, test } from '@playwright/test';
import { crc32, deflateSync } from 'node:zlib';

// Visual check of the Place step's canvas menu, boxes beside the photo, leader lines
// and on a reference card. Not part of the normal run:
// `LEADER_SHOTS=1 npx playwright test e2e/devices-leaders-shots.spec.ts`.
// Screenshots go to test-results/shots/devices-leaders/.

test.skip(!process.env['LEADER_SHOTS'], 'Set LEADER_SHOTS=1 to take leader-line screenshots');
test.setTimeout(120_000);

const OUT = 'test-results/shots/devices-leaders';
const BINDS_ID = '12345670';

/** RGB PNG from a per-pixel function. */
function png(width: number, height: number, px: (x: number, y: number) => [number, number, number]): Buffer {
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
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) row.set(px(x, y), 1 + x * 3);
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A tight "photo" of a joystick on a slightly noisy light background. */
function stickPhoto(): Buffer {
  return png(600, 800, (x, y) => {
    const inEllipse = (cx: number, cy: number, rx: number, ry: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
    if (inEllipse(260, 150, 18, 18)) return [200, 40, 40];
    if (inEllipse(340, 150, 18, 18)) return [50, 70, 200];
    if (inEllipse(300, 185, 14, 14)) return [140, 140, 140];
    if (x >= 220 && x <= 380 && y >= 110 && y <= 420 && (inEllipse(300, 200, 80, 95) || y > 200)) return [38, 38, 44];
    if (x >= 200 && x < 222 && y >= 260 && y <= 340) return [60, 60, 66];
    if (x >= 270 && x <= 330 && y > 420 && y <= 660) return [75, 75, 82];
    if (inEllipse(300, 690, 230, 70)) return [48, 48, 54];
    const n = ((x * 13 + y * 7) % 7) - 3;
    return [214 + n, 216 + n, 220 + n];
  });
}

const BINDS = `<?xml version="1.0" encoding="UTF-8" ?>
<Root PresetName="Leaders" MajorVersion="4" MinorVersion="2">
<PrimaryFire><Primary Device="${BINDS_ID}" Key="Joy_1" /><Secondary Device="{NoDevice}" Key="" /></PrimaryFire>
<SecondaryFire><Primary Device="${BINDS_ID}" Key="Joy_2" /><Secondary Device="{NoDevice}" Key="" /></SecondaryFire>
<UseBoostJuice><Primary Device="${BINDS_ID}" Key="Joy_POV1Up" /><Secondary Device="{NoDevice}" Key="" /></UseBoostJuice>
<LandingGearToggle><Primary Device="${BINDS_ID}" Key="Joy_POV1Down" /><Secondary Device="{NoDevice}" Key="" /></LandingGearToggle>
<ShipSpotLightToggle><Primary Device="${BINDS_ID}" Key="Joy_3" /><Secondary Device="{NoDevice}" Key="" /></ShipSpotLightToggle>
<RollAxisRaw><Binding Device="${BINDS_ID}" Key="Joy_XAxis" /><Inverted Value="0" /><Deadzone Value="0.00000000" /></RollAxisRaw>
</Root>
`;

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

for (const theme of ['dark', 'light'] as const) {
  test(`leader lines and canvas beside the photo (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1100 });
    await page.addInitScript((t) => {
      localStorage.setItem('edb.theme', t);
      delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
    }, theme);
    await page.goto('/devices/new');
    await page.getByTestId('image-input').setInputFiles({ name: 'stick.png', mimeType: 'image/png', buffer: stickPhoto() });
    await expect(page.locator('.img-card')).toContainText('600 × 800');

    await page.getByRole('button', { name: /Next: Identify/ }).click();
    await page.getByTestId('device-name').fill('Leader Stick');
    await page.getByTestId('binds-id').fill(BINDS_ID);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: /Next: Controls/ }).click();
    for (const key of ['Joy_1', 'Joy_2', 'Joy_POV1Up', 'Joy_POV1Right', 'Joy_POV1Down', 'Joy_POV1Left', 'Joy_3', 'Joy_4', 'Joy_XAxis']) {
      await page.getByTestId('new-key').fill(key);
      await page.getByTestId('new-key').press('Enter');
    }
    // A hat with a push: one group, markers from the keys (+ ● for the push).
    for (const k of ['Joy_POV1Up', 'Joy_POV1Right', 'Joy_POV1Down', 'Joy_POV1Left', 'Joy_3']) await page.locator(`input[type=checkbox][data-key="${k}"]`).check();
    await page.getByTestId('group-selected').click();
    const dialog = page.locator('app-group-dialog');
    await dialog.locator('.palette button[data-marker="●"]').click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/group-dialog-${theme}.png` });
    await dialog.getByTestId('group-save').click();

    // Place: boxes beside the photo on both sides, lines to the stick.
    await page.getByRole('button', { name: /Next: Place/ }).click();
    const canvas = page.getByTestId('place-canvas');
    await canvas.scrollIntoViewIfNeeded();
    const at = async (x: number, y: number) => {
      const r = (await canvas.locator('image').boundingBox())!;
      return { x: r.x + (x / 600) * r.width, y: r.y + (y / 800) * r.height };
    };
    const place = async (key: string, box: number[], anchor: [number, number], bend?: { dx: number; dy: number }) => {
      await page.locator('.checklist .item', { hasText: key }).click();
      await drag(page, await at(560, 20), await at(640, 60));
      await page.locator('.checklist .item', { hasText: key }).click();
      const fields = page.locator('.inspector input.num');
      for (let i = 0; i < 4; i++) {
        await fields.nth(i).fill(String(box[i]));
        await fields.nth(i).blur();
      }
      await page.keyboard.press('l');
      const a = await at(anchor[0], anchor[1]);
      await page.mouse.click(a.x, a.y);
      if (bend) {
        const hit = (await canvas.locator('.leader-hit').boundingBox())!;
        const mid = { x: hit.x + hit.width / 2, y: hit.y + hit.height / 2 };
        await drag(page, mid, { x: mid.x + bend.dx, y: mid.y + bend.dy });
      }
    };
    await place('Joy_1', [-440, 110, 380, 44], [260, 150], { dx: 0, dy: -25 });
    await place('Joy_2', [-440, 280, 380, 44], [205, 300]);
    await place('Joy_4', [660, 60, 380, 44], [340, 150]);
    await place('Joy_POV1Up', [660, 150, 380, 220], [300, 185]);
    await place('Joy_XAxis', [660, 520, 380, 44], [300, 540], { dx: -20, dy: 20 });
    await expect(canvas.locator('g.leader')).toHaveCount(5);
    // Select the hat group for the screenshot.
    await page.locator('.checklist .item', { hasText: 'H1' }).click();
    await page.getByRole('button', { name: 'Fit to width' }).click();
    await page.getByTestId('canvas-button').click();
    await expect(page.getByTestId('canvas-size')).toHaveText('1576 × 800');
    await page.getByTestId('canvas-button').click();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/place-group-${theme}.png` });
    await page.getByTestId('canvas-button').click();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/place-canvas-menu-${theme}.png` });
    await page.getByTestId('bg-color').click();
    await page.waitForTimeout(300);
    await page.getByTestId('canvas-panel').screenshot({ path: `${OUT}/canvas-menu-colour-${theme}.png` });
    await page.getByTestId('bg-auto').click();
    await page.getByTestId('canvas-button').click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/place-${theme}.png` });

    // Check step: the diagram shows the grown canvas and the lines.
    await page.getByRole('button', { name: 'Check', exact: true }).click();
    await expect(page.locator('app-device-diagram g.leader')).toHaveCount(5);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/check-${theme}.png` });

    // Save and render a reference card with bindings on it.
    await page.getByRole('button', { name: /Export/ }).first().click();
    await page.getByRole('button', { name: /Save to this browser/ }).click();
    await expect(page).toHaveURL(/\/devices\/Leader-Stick$/);
    await page.goto('/');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /Open your bindings file/ }).click();
    await (await chooser).setFiles({ name: 'Leaders.4.2.binds', mimeType: 'application/xml', buffer: Buffer.from(BINDS) });
    await expect(page).toHaveURL(/\/bindings$/);
    await page.getByRole('link', { name: 'Reference cards' }).click();
    await page.locator('app-card-svg svg').first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    const card = page.locator('app-card-svg').first();
    await expect(card.locator('g.leaders path')).toHaveCount(5);
    await expect(card.locator('g.group[data-group="H1"] g.member')).toHaveCount(5);
    await card.screenshot({ path: `${OUT}/card-${theme}.png` });
  });
}
