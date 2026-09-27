import { HidCollectionInfo, HidReportItem } from './hid-types';
import { decodeReport, hatValueDirections, normalizeAxis, parseHidLayout, readBits } from './hid-parser';

const ext = (page: number, id: number) => (page << 16) | id;

function item(p: Partial<HidReportItem>): HidReportItem {
  return { isAbsolute: true, isArray: false, isConstant: false, isRange: false, hasNull: false, ...p };
}

/** A typical stick: 12 buttons (range), 4 pad bits, X/Y 16-bit, Z/Rz 8-bit signed, 8-way hat with null, 4 pad bits. */
function stick(): HidCollectionInfo[] {
  const items: HidReportItem[] = [
    item({ isRange: true, usageMinimum: ext(9, 1), usageMaximum: ext(9, 12), reportSize: 1, reportCount: 12, logicalMinimum: 0, logicalMaximum: 1 }),
    item({ isConstant: true, reportSize: 1, reportCount: 4 }),
    item({ usages: [ext(1, 0x30), ext(1, 0x31)], reportSize: 16, reportCount: 2, logicalMinimum: 0, logicalMaximum: 65535 }),
    item({ usages: [ext(1, 0x32), ext(1, 0x35)], reportSize: 8, reportCount: 2, logicalMinimum: -127, logicalMaximum: 127 }),
    item({ usages: [ext(1, 0x39)], reportSize: 4, reportCount: 1, logicalMinimum: 0, logicalMaximum: 7, hasNull: true }),
    item({ isConstant: true, reportSize: 4, reportCount: 1 }),
  ];
  return [
    {
      usagePage: 1,
      usage: 4,
      inputReports: [{ reportId: 1, items }],
      // Chromium also lists items in child collections; they must not be read twice.
      children: [{ usagePage: 1, usage: 1, inputReports: [{ reportId: 1, items: items.slice(2, 4) }], children: [] }],
    },
  ];
}

function bytes(...b: number[]): DataView {
  return new DataView(new Uint8Array(b).buffer);
}

describe('hid-parser', () => {
  it('parses fields with running bit offsets, usage IDs and signed ranges', () => {
    const layout = parseHidLayout(stick());
    expect(layout.buttons).toBe(12);
    expect(layout.axes).toBe(4);
    expect(layout.hats).toBe(1);
    const byKey = new Map(layout.fields.map((f) => [f.key, f]));
    expect(byKey.get('Joy_1')!.bitOffset).toBe(0);
    expect(byKey.get('Joy_12')!.bitOffset).toBe(11);
    expect(byKey.get('Joy_XAxis')!.bitOffset).toBe(16);
    expect(byKey.get('Joy_YAxis')!.bitOffset).toBe(32);
    expect(byKey.get('Joy_ZAxis')!).toMatchObject({ bitOffset: 48, bitSize: 8, signed: true });
    expect(byKey.get('Joy_RZAxis')!.bitOffset).toBe(56);
    expect(byKey.get('Joy_POV1')!).toMatchObject({ kind: 'hat', bitOffset: 64, pov: 1 });
    expect(layout.reportBits.get(1)).toBe(72);
  });

  it('decodes buttons, unsigned/signed axes and hats (incl. null)', () => {
    const layout = parseHidLayout(stick());
    // Buttons 1 and 10 (bits 0, 9), X = 0 (-1), Y = 65535 (+1), Z = -127, Rz = 0, hat = 2 (Right).
    const r = decodeReport(layout, 1, bytes(0x01, 0x02, 0x00, 0x00, 0xff, 0xff, 0x81, 0x00, 0x02))!;
    expect([...r.pressed].sort()).toEqual(['Joy_1', 'Joy_10', 'Joy_POV1Right']);
    expect(r.axes.get('Joy_XAxis')).toBe(-1);
    expect(r.axes.get('Joy_YAxis')).toBe(1);
    expect(r.axes.get('Joy_ZAxis')).toBe(-1);
    expect(r.axes.get('Joy_RZAxis')).toBeCloseTo(0, 5);
    // Hat null value (8 or 15) = centred; diagonal 7 = Up + Left.
    expect(decodeReport(layout, 1, bytes(0, 0, 0, 0, 0, 0, 0, 0, 0x0f))!.pressed.size).toBe(0);
    expect([...decodeReport(layout, 1, bytes(0, 0, 0, 0, 0, 0, 0, 0, 0x07))!.pressed].sort()).toEqual([
      'Joy_POV1Left',
      'Joy_POV1Up',
    ]);
    expect(decodeReport(layout, 2, bytes(0))).toBeNull();
  });

  it('uses the HID usage ID for button numbers, not a running counter', () => {
    const layout = parseHidLayout([
      {
        usagePage: 1,
        usage: 4,
        inputReports: [
          {
            reportId: 0,
            items: [
              item({ usages: [ext(9, 5), ext(9, 9)], reportSize: 1, reportCount: 2, logicalMinimum: 0, logicalMaximum: 1 }),
              item({ isConstant: true, reportSize: 6, reportCount: 1 }),
            ],
          },
        ],
      },
    ]);
    expect(layout.fields.map((f) => f.key)).toEqual(['Joy_5', 'Joy_9']);
    expect([...decodeReport(layout, 0, bytes(0b10))!.pressed]).toEqual(['Joy_9']);
  });

  it('numbers hats in order, maps sliders/dials to U then V, and keeps report IDs separate', () => {
    const layout = parseHidLayout([
      {
        usagePage: 1,
        usage: 4,
        inputReports: [
          {
            reportId: 1,
            items: [
              item({ usages: [ext(1, 0x39), ext(1, 0x39)], reportSize: 4, reportCount: 2, logicalMinimum: 1, logicalMaximum: 8 }),
            ],
          },
          {
            reportId: 2,
            items: [
              item({ usages: [ext(1, 0x37), ext(1, 0x36)], reportSize: 8, reportCount: 2, logicalMinimum: 0, logicalMaximum: 255 }),
              item({ isRange: true, usageMinimum: ext(9, 33), usageMaximum: ext(9, 40), reportSize: 1, reportCount: 8, logicalMinimum: 0, logicalMaximum: 1 }),
            ],
          },
        ],
      },
    ]);
    expect(layout.fields.map((f) => f.key)).toEqual([
      'Joy_POV1',
      'Joy_POV2',
      'Joy_UAxis',
      'Joy_VAxis',
      ...Array.from({ length: 8 }, (_, i) => `Joy_${33 + i}`),
    ]);
    // Report 1: POV1 = 1 (Up, logical min 1), POV2 = 5 (Down).
    expect([...decodeReport(layout, 1, bytes(0x51))!.pressed].sort()).toEqual(['Joy_POV1Up', 'Joy_POV2Down']);
    // Report 2 offsets restart at 0: dial=255, slider=0, button 40 pressed.
    const r2 = decodeReport(layout, 2, bytes(0xff, 0x00, 0x80))!;
    expect(r2.axes.get('Joy_UAxis')).toBe(1);
    expect(r2.axes.get('Joy_VAxis')).toBe(-1);
    expect([...r2.pressed]).toEqual(['Joy_40']);
  });

  it('accepts 16-bit usages with a usagePage and child-only collections', () => {
    const layout = parseHidLayout([
      {
        usagePage: 1,
        usage: 5,
        inputReports: [],
        children: [
          {
            usagePage: 1,
            usage: 1,
            inputReports: [
              { reportId: 0, items: [item({ usagePage: 1, usages: [0x30], reportSize: 8, reportCount: 1, logicalMinimum: 0, logicalMaximum: 255 })] },
            ],
          },
          {
            inputReports: [
              {
                reportId: 0,
                items: [item({ usagePage: 9, isRange: true, usageMinimum: 1, usageMaximum: 4, reportSize: 1, reportCount: 4, logicalMaximum: 1 })],
              },
            ],
          },
        ],
      },
    ]);
    expect(layout.fields.map((f) => [f.key, f.bitOffset])).toEqual([
      ['Joy_XAxis', 0],
      ['Joy_1', 8],
      ['Joy_2', 9],
      ['Joy_3', 10],
      ['Joy_4', 11],
    ]);
  });

  it('fixes logical maxima that were read back as negative', () => {
    const layout = parseHidLayout([
      {
        usagePage: 1,
        usage: 4,
        inputReports: [{ reportId: 0, items: [item({ usages: [ext(1, 0x30)], reportSize: 16, reportCount: 1, logicalMinimum: 0, logicalMaximum: -1 })] }],
      },
    ]);
    expect(layout.fields[0].logicalMax).toBe(65535);
    expect(decodeReport(layout, 0, bytes(0xff, 0xff))!.axes.get('Joy_XAxis')).toBe(1);
  });

  it('decodes button arrays', () => {
    const layout = parseHidLayout([
      {
        usagePage: 1,
        usage: 4,
        inputReports: [
          {
            reportId: 0,
            items: [item({ isArray: true, usageMinimum: ext(9, 1), usageMaximum: ext(9, 20), reportSize: 8, reportCount: 2, logicalMinimum: 1, logicalMaximum: 20 })],
          },
        ],
      },
    ]);
    expect(layout.buttons).toBe(20);
    expect([...decodeReport(layout, 0, bytes(3, 0))!.pressed]).toEqual(['Joy_3']);
  });

  it('reads bits, normalises axes and decodes hat values', () => {
    const dv = bytes(0b1010_1100, 0b0000_0001);
    expect(readBits(dv, 2, 3)).toBe(0b011);
    expect(readBits(dv, 4, 5)).toBe(0b11010);
    expect(readBits(dv, 4, 5, true)).toBe(0b11010 - 32);
    expect(normalizeAxis(512, 0, 1024)).toBe(0);
    expect(normalizeAxis(-512, -512, 511)).toBe(-1);
    expect(hatValueDirections(0, 0, 3)).toEqual(['Up']);
    expect(hatValueDirections(3, 0, 3)).toEqual(['Left']);
    expect(hatValueDirections(4, 0, 3)).toEqual([]);
    expect(hatValueDirections(9000, 0, 35999)).toEqual(['Right']);
  });
});
