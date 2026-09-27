import {
  alignBoxes,
  boxesOverlap,
  clampBox,
  findOverlaps,
  isOffImage,
  rectFromPoints,
  resizeBox,
  snapEdges,
  snapMove,
  snapTargets,
} from './geometry';

describe('geometry', () => {
  it('builds rectangles from any two corners', () => {
    expect(rectFromPoints({ x: 50, y: 10 }, { x: 10, y: 40 })).toEqual({ x: 10, y: 10, w: 40, h: 30 });
  });

  it('detects overlaps but not touching or identical boxes', () => {
    const a = { x: 0, y: 0, w: 100, h: 20 };
    expect(boxesOverlap(a, { x: 50, y: 10, w: 100, h: 20 })).toBe(true);
    expect(boxesOverlap(a, { x: 100, y: 0, w: 100, h: 20 })).toBe(false);
    expect(boxesOverlap(a, { x: 0, y: 20, w: 100, h: 20 })).toBe(false);
    const items = [
      { id: 'a', box: a },
      { id: 'b', box: { x: 90, y: 5, w: 50, h: 20 } },
      { id: 'c', box: { ...a } },
      { id: 'd', box: { x: 500, y: 500, w: 10, h: 10 } },
    ];
    const pairs = findOverlaps(items).map(([p, q]) => [p.id, q.id].sort().join(''));
    expect(pairs.sort()).toEqual(['ab', 'bc']);
  });

  it('detects boxes off the image', () => {
    expect(isOffImage({ x: 0, y: 0, w: 100, h: 100 }, 100, 100)).toBe(false);
    expect(isOffImage({ x: -5, y: 0, w: 10, h: 10 }, 100, 100)).toBe(true);
    expect(isOffImage({ x: 95, y: 0, w: 10, h: 10 }, 100, 100)).toBe(true);
    expect(isOffImage({ x: 0, y: 95, w: 10, h: 10 }, 100, 100)).toBe(true);
    expect(clampBox({ x: 95, y: -3, w: 10, h: 10 }, 100, 100)).toEqual({ x: 90, y: 0, w: 10, h: 10 });
  });

  it('resizes from any handle without flipping', () => {
    const b = { x: 10, y: 10, w: 100, h: 50 };
    expect(resizeBox(b, 'se', 10, 5)).toEqual({ x: 10, y: 10, w: 110, h: 55 });
    expect(resizeBox(b, 'nw', 10, 5)).toEqual({ x: 20, y: 15, w: 90, h: 45 });
    expect(resizeBox(b, 'w', 500, 0, 4)).toEqual({ x: 106, y: 10, w: 4, h: 50 });
    expect(resizeBox(b, 'n', 0, -10)).toEqual({ x: 10, y: 0, w: 100, h: 60 });
  });

  it('snaps a moved box to other edges, else to the grid', () => {
    const targets = snapTargets([{ x: 100, y: 200, w: 300, h: 40 }]);
    // Left edge 3px from 100 -> snaps.
    const r = snapMove({ x: 103, y: 247, w: 50, h: 20 }, targets, { threshold: 5 });
    expect(r.box.x).toBe(100);
    expect(r.guides.x).toEqual([100]);
    // Top 247 is 7px from 240: outside threshold; no grid -> unchanged.
    expect(r.box.y).toBe(247);
    // Right edge (x + w = 398) snaps to 400.
    expect(snapMove({ x: 348, y: 0, w: 50, h: 20 }, targets, { threshold: 5 }).box.x).toBe(350);
    // Grid.
    expect(snapMove({ x: 13, y: 27, w: 50, h: 20 }, snapTargets([]), { threshold: 5, grid: 10 }).box).toEqual({
      x: 10,
      y: 30,
      w: 50,
      h: 20,
    });
  });

  it('snaps only the moving edges when resizing', () => {
    const targets = snapTargets([{ x: 100, y: 100, w: 100, h: 100 }], { width: 1000, height: 1000 });
    const r = snapEdges({ x: 10, y: 10, w: 188, h: 30 }, { right: true }, targets, { threshold: 4 });
    expect(r.box).toEqual({ x: 10, y: 10, w: 190, h: 30 });
    const g = snapEdges({ x: 12, y: 13, w: 30, h: 30 }, { left: true, top: true }, snapTargets([]), { threshold: 0, grid: 5 });
    expect(g.box).toEqual({ x: 10, y: 15, w: 32, h: 28 });
  });

  it('aligns to the first box', () => {
    const out = alignBoxes(
      [
        { x: 10, y: 10, w: 50, h: 10 },
        { x: 30, y: 40, w: 20, h: 10 },
      ],
      'left',
    );
    expect(out[1]).toEqual({ x: 10, y: 40, w: 20, h: 10 });
  });
});
