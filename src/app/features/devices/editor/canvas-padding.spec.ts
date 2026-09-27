import {
  DEFAULT_CANVAS,
  borderSamples,
  canvasPadding,
  canvasRect,
  contentExtent,
  detectBackground,
  expandTo169,
  fromHex,
  hasPadding,
  outputScale,
  paddedSize,
  resolveBackground,
  toHex,
  unionRect,
  workspaceRect,
} from './canvas-padding';

/** RGBA pixels from a function of (x, y). */
function image(width: number, height: number, px: (x: number, y: number) => [number, number, number, number?]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a = 255] = px(x, y);
      data.set([r, g, b, a], (y * width + x) * 4);
    }
  }
  return data;
}

const photo = { width: 400, height: 300 };
const opts = { margin: 48, aspect169: false };

describe('canvas extent', () => {
  it('spans the image, boxes and leader points', () => {
    expect(contentExtent(photo, [], [])).toEqual({ x: 0, y: 0, w: 400, h: 300 });
    expect(contentExtent(photo, [{ x: 350, y: 10, w: 150, h: 30 }], [{ x: -20, y: 320 }])).toEqual({ x: -20, y: 0, w: 520, h: 320 });
    expect(unionRect({ x: 0, y: 0, w: 10, h: 10 }, { x: -5, y: 5, w: 5, h: 20 })).toEqual({ x: -5, y: 0, w: 15, h: 25 });
  });

  it('adds nothing when everything fits on the photo', () => {
    const pad = canvasPadding(photo, [{ x: 10, y: 10, w: 100, h: 20 }], [{ x: 200, y: 150 }], opts);
    expect(pad).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(hasPadding(pad)).toBe(false);
    // Half a pixel over is rounding, not "beside the photo".
    expect(hasPadding(canvasPadding(photo, [{ x: -0.4, y: 0, w: 400.8, h: 20 }], [], opts))).toBe(false);
  });

  it('grows only the sides where content goes beyond the photo, plus the margin', () => {
    const pad = canvasPadding(photo, [{ x: 300, y: 100, w: 200, h: 30 }, { x: -150, y: 200, w: 200, h: 30 }], [{ x: 200, y: 330.5 }], opts);
    expect(pad).toEqual({ left: 198, right: 148, top: 0, bottom: 79 });
    expect(canvasRect(photo, pad)).toEqual({ x: -198, y: 0, w: 746, h: 379 });
    expect(paddedSize(400, 300, pad)).toEqual({ width: 746, height: 379 });
    expect(canvasPadding(photo, [{ x: 300, y: 100, w: 200, h: 30 }], [], { margin: 0, aspect169: false }).right).toBe(100);
  });

  it('can keep 16:9 around the content', () => {
    for (const [w, h] of [
      [400, 300],
      [900, 1600],
      [3000, 1000],
      [1600, 900],
    ]) {
      const p = expandTo169(w, h, { top: 0, right: 10, bottom: 0, left: 0 });
      const W = w + p.left + p.right;
      const H = h + p.top + p.bottom;
      expect(Math.abs(W / H - 16 / 9)).toBeLessThan(2 / H);
      expect(Math.min(p.left, p.top, p.bottom)).toBeGreaterThanOrEqual(0);
      expect(p.right).toBeGreaterThanOrEqual(10);
    }
    // Keep 16:9 applies even without content beside the photo.
    expect(canvasPadding(photo, [], [], { margin: 48, aspect169: true })).toEqual({ top: 0, right: 67, bottom: 0, left: 67 });
  });

  it('gives the workspace room on every side', () => {
    expect(workspaceRect(photo, { x: 0, y: 0, w: 400, h: 300 })).toEqual({ x: -200, y: -150, w: 800, h: 600 });
    expect(workspaceRect(photo, { x: -100, y: 0, w: 700, h: 300 })).toEqual({ x: -300, y: -150, w: 1100, h: 600 });
  });

  it('scales past the size limit', () => {
    expect(outputScale(1000, 500)).toBe(1);
    expect(outputScale(7680, 1000)).toBe(0.5);
    expect(outputScale(1920, 1080, 3840)).toBe(2);
  });

  it('resolves the background setting', () => {
    expect(DEFAULT_CANVAS.background).toEqual({ kind: 'auto' });
    expect(resolveBackground({ kind: 'auto' }, '#123456')).toEqual({ kind: 'color', color: '#123456' });
    expect(resolveBackground({ kind: 'auto' }, null)).toEqual({ kind: 'transparent' });
    expect(resolveBackground({ kind: 'color', color: '#fff' }, '#123456')).toEqual({ kind: 'color', color: '#fff' });
    expect(resolveBackground({ kind: 'transparent' }, '#123456')).toEqual({ kind: 'transparent' });
  });
});

describe('background detection', () => {
  it('formats colours', () => {
    expect(toHex(225, 0, 255.4)).toBe('#e100ff');
    expect(fromHex('#E100ff')).toEqual([225, 0, 255]);
    expect(fromHex('red')).toBeNull();
  });

  it('samples only the border band', () => {
    const offsets = borderSamples(10, 10, 1);
    expect(offsets.length).toBe(36);
    expect(offsets).not.toContain((5 * 10 + 5) * 4);
    expect(borderSamples(1000, 1000, 10, 500).length).toBeLessThanOrEqual(520);
  });

  it('finds the dominant border colour of a controller photo', () => {
    // Light grey background with some noise, a dark controller in the middle touching the bottom edge.
    const data = image(200, 100, (x, y) => {
      if (x > 70 && x < 130 && y > 20) return [40, 40, 40];
      const n = (x * 7 + y * 13) % 5;
      return [224 + n, 224 + n, 226 + n];
    });
    const r = detectBackground(data, 200, 100);
    expect(r.busy).toBe(false);
    expect(r.share).toBeGreaterThan(0.8);
    const [red, green, blue] = fromHex(r.color!)!;
    expect(Math.abs(red - 226)).toBeLessThanOrEqual(2);
    expect(Math.abs(green - 226)).toBeLessThanOrEqual(2);
    expect(Math.abs(blue - 228)).toBeLessThanOrEqual(2);
  });

  it('falls back to the median for a busy border', () => {
    // Every pixel a different colour: no bucket dominates.
    const data = image(64, 64, (x, y) => [(x * 37) % 256, (y * 53) % 256, ((x + y) * 29) % 256]);
    const r = detectBackground(data, 64, 64);
    expect(r.busy).toBe(true);
    expect(r.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('keeps a transparent border transparent', () => {
    const data = image(50, 50, (x, y) => (x > 10 && x < 40 && y > 10 && y < 40 ? [0, 0, 0, 255] : [0, 0, 0, 0]));
    expect(detectBackground(data, 50, 50).color).toBeNull();
  });
});
