import { groupDividers, groupLayout } from './group-layout';

const members = (n: number, marker = (i: number) => String(i + 1)) => Array.from({ length: n }, (_, i) => ({ key: `Joy_${i + 1}`, marker: marker(i) }));
const arrows = ['↑', '→', '↓', '←', '●'];

describe('group layout', () => {
  it('stacks members in equal rows right of a label column', () => {
    const g = groupLayout({ box: { x: 100, y: 100, w: 700, h: 270 }, members: members(5, (i) => arrows[i]) });
    expect(g.labelRect).toEqual({ x: 100, y: 100, w: 70.2, h: 270 });
    expect(g.members.map((m) => m.rect.y)).toEqual([100, 154, 208, 262, 316]);
    const first = g.members[0];
    expect(first.rect).toEqual({ x: 170.2, y: 100, w: 629.8, h: 54 });
    expect(first.markerRect).toEqual({ x: 170.2, y: 100, w: 54, h: 54 });
    expect(first.textRect.x).toBeCloseTo(224.2);
    expect(first.textRect.x + first.textRect.w).toBeCloseTo(800);
    expect(g.members.map((m) => m.marker)).toEqual(arrows);
  });

  it('drops the label column when asked', () => {
    const g = groupLayout({ box: { x: 0, y: 0, w: 400, h: 100 }, showLabel: false, members: members(2) });
    expect(g.labelRect).toBeNull();
    expect(g.members[0].rect).toEqual({ x: 0, y: 0, w: 400, h: 50 });
  });

  it('puts members side by side in a row, each with its marker at the left', () => {
    const g = groupLayout({ box: { x: 0, y: 0, w: 654, h: 54 }, layout: 'row', members: [{ key: 'Pos_Joy_ZAxis', marker: '+' }, { key: 'Neg_Joy_ZAxis', marker: '−' }] });
    expect(g.labelRect).toEqual({ x: 0, y: 0, w: 54, h: 54 });
    expect(g.members.map((m) => m.rect)).toEqual([
      { x: 54, y: 0, w: 300, h: 54 },
      { x: 354, y: 0, w: 300, h: 54 },
    ]);
    expect(g.members[1].markerRect).toEqual({ x: 354, y: 0, w: 54, h: 54 });
    expect(g.members[1].textRect).toEqual({ x: 408, y: 0, w: 246, h: 54 });
    expect(groupDividers(g, 'row')).toBe('M54 0V54M108 0V54M408 0V54M354 0V54');
  });

  it('handles any number of members and widens the marker cell for text markers', () => {
    for (const n of [2, 3, 9, 12]) {
      const g = groupLayout({ box: { x: 0, y: 0, w: 500, h: 30 * n }, members: members(n) });
      expect(g.members).toHaveLength(n);
      const total = g.members.reduce((a, m) => a + m.rect.h, 0);
      expect(total).toBeCloseTo(30 * n);
    }
    const g = groupLayout({ box: { x: 0, y: 0, w: 500, h: 60 }, showLabel: false, members: [{ key: 'Joy_1', marker: 'Fwd' }, { key: 'Joy_2', marker: 'Back' }] });
    expect(g.members[0].markerRect.w).toBe(48);
  });
});
