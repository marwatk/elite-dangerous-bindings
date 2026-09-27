import { Measure, REF_SIZE, fitStacked, fitText } from './text-fit';

/** Every character is half an em wide; bold is 10% wider. */
const measure: Measure = (text, bold) => text.length * REF_SIZE * 0.5 * (bold ? 1.1 : 1);

const width = (text: string, size: number) => text.length * size * 0.5;

describe('fitText', () => {
  it('uses the maximum size when the text fits', () => {
    const r = fitText([{ text: 'Boost' }], 800, 54, measure, { maxSize: 40 });
    expect(r.size).toBe(40);
    expect(r.lines.length).toBe(1);
    expect(r.truncated).toBe(false);
  });

  it('never exceeds the box height', () => {
    const r = fitText([{ text: 'Boost' }], 800, 30, measure, { maxSize: 40 });
    expect(r.size).toBeLessThanOrEqual(30);
  });

  it('shrinks until one line fits the width', () => {
    const r = fitText([{ text: 'x'.repeat(40) }], 400, 54, measure, { maxSize: 40, separator: ' · ' });
    // 40 chars * 0.5em = 20em <= 400px -> 20px.
    expect(r.size).toBe(20);
    expect(width('x'.repeat(40), r.size)).toBeLessThanOrEqual(400);
  });

  it('flows several items on one line with separators', () => {
    const r = fitText([{ text: 'Fire' }, { text: 'Boost' }], 1000, 54, measure, { maxSize: 40 });
    expect(r.lines.length).toBe(1);
    expect(r.lines[0].map((x) => x.text)).toEqual(['Fire', ' · ', 'Boost']);
    expect(r.lines[0][2].x).toBeCloseTo(width('Fire · ', 40));
  });

  it('wraps onto more lines when the box is tall enough', () => {
    const items = [{ text: 'Primary Fire' }, { text: 'Secondary Fire' }, { text: 'Boost' }];
    const r = fitText(items, 300, 108, measure, { maxSize: 40, lineHeight: 1.1 });
    expect(r.lines.length).toBeGreaterThan(1);
    const total = r.size + (r.lines.length - 1) * r.lineHeight;
    expect(total).toBeLessThanOrEqual(108);
    for (const line of r.lines) {
      const end = line.at(-1)!;
      expect(end.x + end.width).toBeLessThanOrEqual(300 + 1e-6);
    }
    // Bigger than it would be on a single line.
    expect(r.size).toBeGreaterThan(300 / ('Primary Fire · Secondary Fire · Boost'.length * 0.5));
  });

  it('wraps a single long item at spaces', () => {
    const r = fitText([{ text: 'Toggle Frame Shift Drive' }], 200, 120, measure, { maxSize: 40, minSize: 10 });
    expect(r.lines.length).toBeGreaterThan(1);
    expect(r.lines.flat().map((x) => x.text).join(' ')).toBe('Toggle Frame Shift Drive');
    expect(r.truncated).toBe(false);
  });

  it('puts each item on its own line in onePerLine mode', () => {
    const r = fitText([{ text: 'A' }, { text: 'B' }, { text: 'C' }], 200, 200, measure, {
      maxSize: 30,
      onePerLine: true,
    });
    expect(r.lines.map((l) => l.map((x) => x.text))).toEqual([['A'], ['B'], ['C']]);
  });

  it('accounts for bold text', () => {
    const plain = fitText([{ text: 'x'.repeat(40) }], 400, 54, measure, { maxSize: 40 });
    const bold = fitText([{ text: 'x'.repeat(40), bold: true }], 400, 54, measure, { maxSize: 40 });
    expect(bold.size).toBeLessThan(plain.size);
  });

  it('truncates with an ellipsis only as a last resort', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ text: `Command number ${i}` }));
    const r = fitText(items, 200, 30, measure, { maxSize: 40, minSize: 10 });
    expect(r.truncated).toBe(true);
    expect(r.size).toBe(10);
    const last = r.lines.at(-1)!;
    expect(last.at(-1)!.text.endsWith('…')).toBe(true);
    expect(r.size + (r.lines.length - 1) * r.lineHeight).toBeLessThanOrEqual(30);
    for (const line of r.lines) {
      const end = line.at(-1)!;
      expect(end.x + end.width).toBeLessThanOrEqual(200 + 1e-6);
    }
  });

  it('cuts a word wider than the box', () => {
    const r = fitText([{ text: 'Supercalifragilistic' }], 50, 12, measure, { maxSize: 40, minSize: 10 });
    expect(r.truncated).toBe(true);
    expect(r.lines[0][0].text.endsWith('…')).toBe(true);
    expect(r.lines[0][0].width).toBeLessThanOrEqual(50);
  });
});

describe('fitStacked', () => {
  it('stacks a few items one per line', () => {
    const r = fitStacked([{ text: 'Boost' }, { text: 'Jump' }], 200, 200, measure, { maxSize: 30 });
    expect(r.lines.map((l) => l.map((x) => x.text))).toEqual([['Boost'], ['Jump']]);
  });

  it('flows crowded items when that gives clearly larger text', () => {
    const items = Array.from({ length: 12 }, () => ({ text: 'Ab' }));
    const stacked = fitText(items, 300, 120, measure, { maxSize: 40, onePerLine: true });
    const r = fitStacked(items, 300, 120, measure, { maxSize: 40 });
    expect(r.size).toBeGreaterThan(stacked.size);
    expect(r.lines.length).toBeLessThan(12);
  });
});
