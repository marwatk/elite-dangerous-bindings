import { CardEntry, DeviceCard, GroupSpot } from './card-model';
import { RenderContext, boxTextMetrics, renderCard, typicalBoxHeight } from './card-render';

function ctx(): RenderContext {
  return {
    scheme: 'group',
    measure: (t) => t.length * 55,
    fontFamily: 'sans-serif',
    image: { width: 3840, height: 2160 },
    imageHref: 'x.webp',
    keyboardStyle: 'graphic',
    keyLabel: (k) => k,
    inputLabel: (r) => r.key,
    controlLabel: (r) => r.key,
    modifiers: [],
    footer: { preset: '', file: '', date: '' },
  };
}

const entry = (text = 'Fire'): CardEntry => ({ kind: 'action', text, code: 'PrimaryFire', group: 'Ship', category: 'Combat', modifier: 0, hold: false, order: 1 });

function card(patch: Partial<DeviceCard> = {}): DeviceCard {
  return { kind: 'device', id: 'X::0', deviceId: 'X', deviceIndex: 0, name: 'X', covers: [], spots: [], groups: [], ...patch };
}

const hat = (): GroupSpot => ({
  id: 'H1',
  label: 'H1',
  layout: 'stack',
  showLabel: true,
  image: 0,
  box: { x: 100, y: 500, w: 700, h: 270 },
  members: [
    { key: 'Joy_POV1Up', marker: '↑', entries: [entry('Up thing')] },
    { key: 'Joy_POV1Right', marker: '→', entries: [] },
    { key: 'Joy_POV1Down', marker: '↓', entries: [entry('Down thing')] },
    { key: 'Joy_POV1Left', marker: '←', entries: [] },
    { key: 'Joy_5', marker: 'Push', entries: [entry('Push thing')] },
  ],
});

describe('device card rendering', () => {
  it('draws leader lines under the text, from the box edge to the anchor', () => {
    const c = card({
      spots: [
        { box: { x: 100, y: 100, w: 800, h: 50 }, image: 0, controls: ['Joy_1'], entries: [entry()], leader: [{ x: 1200, y: 125 }, { x: 1400, y: 400 }] },
        { box: { x: 100, y: 300, w: 800, h: 50 }, image: 0, controls: ['Joy_2'], entries: [entry()] },
      ],
    });
    const svg = renderCard(c, ctx()).svg;
    const lines = svg.indexOf('class="leaders"');
    expect(lines).toBeGreaterThan(0);
    expect(lines).toBeLessThan(svg.indexOf('class="spot"'));
    expect(svg).toContain('<path d="M900 125L1200 125L1400 400"/>');
    expect(svg).toContain('<circle cx="1400" cy="400"');
    expect(svg.match(/<path d=/g)?.length).toBe(1);
    expect(svg).not.toContain('class="box"');
  });

  it('sizes text from the box height, capped at the typical box height', () => {
    // EDRefCard's 54 px boxes keep their ≈40 px text.
    expect(boxTextMetrics(54, 54).maxSize).toBeCloseTo(40, 0);
    // A small image's boxes still fill their height.
    expect(boxTextMetrics(30, 30).maxSize).toBeCloseTo(22.2);
    // Tall boxes wrap rather than blow the text up.
    expect(boxTextMetrics(108, 54).maxSize).toBeCloseTo(40, 0);
    expect(typicalBoxHeight(card({ spots: [54, 54, 108].map((h) => ({ box: { x: 0, y: 0, w: 10, h }, image: 0, controls: [], entries: [] })) }))).toBe(54);
    // Text on a small (960 px wide) image is as large as its boxes allow, not 40 × 960/3840.
    const small = { ...ctx(), image: { width: 960, height: 540 } };
    const svg = renderCard(card({ spots: [{ box: { x: 10, y: 10, w: 400, h: 30 }, image: 0, controls: ['Joy_1'], entries: [entry()] }] }), small).svg;
    const size = Number(/<text y="[\d.]+" font-size="([\d.]+)"/.exec(svg)![1]);
    expect(size).toBeGreaterThan(20);
  });

  it('draws outlined boxes, including empty ones, when the artwork has none', () => {
    const c = card({
      drawBoxes: true,
      spots: [
        { box: { x: 100, y: 100, w: 800, h: 50 }, image: 0, controls: ['Joy_1'], entries: [entry()] },
        { box: { x: 100, y: 300, w: 800, h: 50 }, image: 0, controls: [], entries: [] },
      ],
    });
    const svg = renderCard(c, ctx()).svg;
    expect(svg.match(/class="box"/g)?.length).toBe(2);
    expect(svg).toContain('fill="#ffffff" fill-opacity="0.78"');
    // Boxes go behind their text.
    expect(svg.indexOf('class="box"')).toBeLessThan(svg.indexOf('>Fire<'));
  });

  it('draws a group: rotated label, a row per member with its marker, unbound rows empty', () => {
    const svg = renderCard(card({ groups: [hat()] }), ctx()).svg;
    expect(svg).toContain('data-group="H1"');
    expect(svg).toContain('rotate(-90)');
    const rows = svg.split('<g class="member" ').slice(1);
    expect(rows.map((r) => /data-key="([^"]+)"/.exec(r)![1])).toEqual(['Joy_POV1Up', 'Joy_POV1Right', 'Joy_POV1Down', 'Joy_POV1Left', 'Joy_5']);
    const member = (key: string) => rows.find((r) => r.startsWith(`data-key="${key}"`))!;
    expect(member('Joy_POV1Up')).toContain('Up thing');
    expect(member('Joy_POV1Right')).not.toContain('thing');
    expect(member('Joy_POV1Right')).toContain('rotate(90 12 12)');
    // Text markers are text, symbols are paths.
    expect(svg).toContain('>Push<');
    expect(svg).not.toContain('>↑<');
  });
});
