import { MARKER_PALETTE, autoMarker, fillMarkers, markerSvg, markerSymbol, markerTransform, normalizeMarker } from './markers';

describe('group markers', () => {
  it('has a vector symbol for every palette entry', () => {
    expect(MARKER_PALETTE).toEqual(['↑', '↗', '→', '↘', '↓', '↙', '←', '↖', '●', '⟳', '⟲', '↕', '↔', '±', '+', '−']);
    for (const m of MARKER_PALETTE) expect(markerSymbol(m)?.d).toMatch(/^M/);
    expect(markerSymbol('Fwd')).toBeNull();
  });

  it('fills markers from the key where it tells us', () => {
    expect(['Joy_POV1Up', 'Joy_POV1Right', 'Joy_POV2Down', 'Joy_POV1Left'].map(autoMarker)).toEqual(['↑', '→', '↓', '←']);
    expect(autoMarker('GamePad_DPadUp')).toBe('↑');
    expect(autoMarker('Pos_Joy_XAxis')).toBe('+');
    expect(autoMarker('Neg_Joy_XAxis')).toBe('−');
    expect(autoMarker('Joy_5')).toBe('');
    expect(fillMarkers([{ key: 'Joy_POV1Up' }, { key: 'Joy_POV1Down' }, { key: 'Joy_5' }, { key: 'Joy_6', marker: '●' }])).toEqual(['↑', '↓', '', '●']);
    // Keeps chosen markers, never repeats one.
    expect(fillMarkers([{ key: 'Joy_POV1Up', marker: '⟳' }, { key: 'Joy_7', marker: '⟳' }])).toEqual(['⟳', '']);
  });

  it('tidies typed markers', () => {
    expect(normalizeMarker(' - ')).toBe('−');
    expect(normalizeMarker('Forward')).toBe('Forwar');
  });

  it('draws symbols as paths, centred in their cell', () => {
    expect(markerTransform({ x: 0, y: 0, w: 100, h: 50 }, 0.48)).toBe('translate(38 13) scale(1)');
    const svg = markerSvg('→', { x: 10, y: 10, w: 40, h: 40 }, '#111')!;
    expect(svg).toContain('rotate(90 12 12)');
    expect(svg).toContain('stroke="#111"');
    expect(markerSvg('●', { x: 0, y: 0, w: 24, h: 24 }, '#111')).toContain('fill="#111" stroke="none"');
    expect(markerSvg('Fwd', { x: 0, y: 0, w: 24, h: 24 }, '#111')).toBeNull();
  });
});
