import { Adjustment, adjustBox, adjustPoint, adjustedSize, adjustmentTransform } from './image-tools';

const img = { width: 1000, height: 500 };
const none: Adjustment = { rotate: 0, straighten: 0, crop: null };

describe('adjustment transforms', () => {
  it('leaves boxes and points alone without changes', () => {
    expect(adjustBox({ x: 10, y: 20, w: 100, h: 30 }, img, none)).toEqual({ x: 10, y: 20, w: 100, h: 30 });
    expect(adjustPoint({ x: 400, y: 300 }, img, none)).toEqual({ x: 400, y: 300 });
  });

  it('shifts boxes and leader points by the added left/top padding', () => {
    const adj: Adjustment = { ...none, pad: { top: 50, right: 20, bottom: 10, left: 200 } };
    expect(adjustedSize(img.width, img.height, adj)).toEqual({ width: 1220, height: 560 });
    expect(adjustBox({ x: 10, y: 20, w: 100, h: 30 }, img, adj)).toEqual({ x: 210, y: 70, w: 100, h: 30 });
    expect(adjustPoint({ x: 400, y: 300 }, img, adj)).toEqual({ x: 600, y: 350 });
  });

  it('scales down when the padded image is larger than the limit', () => {
    const adj: Adjustment = { ...none, pad: { top: 0, right: 3000, bottom: 0, left: 3680 } };
    // 7680 wide -> half size.
    expect(adjustedSize(img.width, img.height, adj)).toEqual({ width: 3840, height: 250 });
    expect(adjustBox({ x: 100, y: 100, w: 100, h: 40 }, img, adj)).toEqual({ x: 1890, y: 50, w: 50, h: 20 });
    expect(adjustPoint({ x: 400, y: 300 }, img, adj)).toEqual({ x: 2040, y: 150 });
  });

  it('scales up to an output width', () => {
    const adj: Adjustment = { ...none, pad: { top: 40, right: 460, bottom: 40, left: 460 }, outputWidth: 3840 };
    // 1920 × 580 -> 3840 × 1160.
    expect(adjustedSize(img.width, img.height, adj)).toEqual({ width: 3840, height: 1160 });
    expect(adjustPoint({ x: 0, y: 0 }, img, adj)).toEqual({ x: 920, y: 80 });
  });

  it('applies rotation and crop before padding', () => {
    const adj: Adjustment = { rotate: 90, straighten: 0, crop: { x: 100, y: 100, w: 300, h: 600 }, pad: { top: 10, right: 0, bottom: 0, left: 20 } };
    const t = adjustmentTransform(img.width, img.height, adj);
    expect({ width: t.width, height: t.height }).toEqual({ width: 320, height: 610 });
    // (0,0) of a 1000×500 image rotated 90° clockwise lands at (500, 0); then crop and pad.
    const p = adjustPoint({ x: 0, y: 0 }, img, adj);
    expect(p).toEqual({ x: 500 - 100 + 20, y: 0 - 100 + 10 });
  });
});
