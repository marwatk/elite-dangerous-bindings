import { applyCanvas, canvasOutputSize, canvasPaddingFor, canvasSettings } from './canvas';
import { EditorDraft, draftToDefinition, emptyDraft } from './draft';

function draft(controls: EditorDraft['controls'], patch: Partial<EditorDraft> = {}): EditorDraft {
  return {
    ...emptyDraft(),
    id: 'T',
    name: 'T',
    ids: [{ uid: 'p', bindsId: '12345678' }],
    images: [{ uid: 'i', name: 'x.png', file: 'T.png', blob: new Blob([]), type: 'png', width: 400, height: 300 }],
    controls,
    ...patch,
  };
}

describe('draft canvas', () => {
  it('leaves the draft alone when everything is on the photo', () => {
    const d = draft([{ uid: 'a', part: 'p', key: 'Joy_1', label: 'A', kind: 'button', image: 0, box: { x: 10, y: 10, w: 100, h: 20 }, leader: [{ x: 200, y: 150 }] }]);
    expect(applyCanvas(d)).toBe(d);
    expect(canvasOutputSize(d, 0)).toEqual({ width: 400, height: 300 });
  });

  it('grows the image to hold boxes beside it and moves boxes and leader points by the offset', () => {
    const d = draft([
      { uid: 'a', part: 'p', key: 'Joy_1', label: 'A', kind: 'button', image: 0, box: { x: 300, y: 100, w: 200, h: 30 }, leader: [{ x: 250, y: 140 }, { x: 200, y: 150 }] },
      { uid: 'b', part: 'p', key: 'Joy_2', label: 'B', kind: 'button', image: 0, box: { x: -150, y: 200, w: 200, h: 30 } },
      { uid: 'c', part: 'p', key: 'Joy_3', label: 'C', kind: 'button' },
    ]);
    expect(canvasPaddingFor(d, 0)).toEqual({ top: 0, right: 148, bottom: 0, left: 198 });
    const out = applyCanvas(d);
    expect(out.images[0]).toMatchObject({ width: 746, height: 300, type: 'webp', file: 'T.webp' });
    expect(out.controls[0].box).toEqual({ x: 498, y: 100, w: 200, h: 30 });
    expect(out.controls[0].leader).toEqual([{ x: 448, y: 140 }, { x: 398, y: 150 }]);
    expect(out.controls[1].box).toEqual({ x: 48, y: 200, w: 200, h: 30 });
    expect(out.controls[2]).toBe(d.controls[2]);
    // The original draft is untouched (editing stays non-destructive).
    expect(d.images[0].width).toBe(400);
    expect(d.controls[0].box!.x).toBe(300);
    const def = draftToDefinition(out);
    expect(def.images[0]).toEqual({ file: 'T.webp', width: 746, height: 300 });
  });

  it('scales everything down when the canvas passes the size limit', () => {
    const d = draft([{ uid: 'a', part: 'p', key: 'Joy_1', label: 'A', kind: 'button', image: 0, box: { x: 400, y: 0, w: 7232, h: 100 }, leader: [{ x: 200, y: 100 }] }], {
      canvas: { margin: 48 },
    });
    // 400 + 7232 + 48 = 7680 wide -> half size.
    const out = applyCanvas(d);
    expect(out.images[0]).toMatchObject({ width: 3840, height: 150 });
    expect(out.controls[0].box).toEqual({ x: 200, y: 0, w: 3616, h: 50 });
    expect(out.controls[0].leader).toEqual([{ x: 100, y: 50 }]);
  });

  it('keeps 16:9 when asked, and uses the rendered images when given', () => {
    const d = draft([{ uid: 'a', part: 'p', key: 'Joy_1', label: 'A', kind: 'button', image: 0, box: { x: 10, y: 10, w: 100, h: 20 } }], { canvas: { aspect169: true } });
    expect(canvasSettings(d)).toMatchObject({ margin: 48, aspect169: true, background: { kind: 'auto' } });
    expect(canvasOutputSize(d, 0)).toEqual({ width: 534, height: 300 });
    const rendered = { ...d.images[0], uid: 'r', type: 'png' as const, width: 534, height: 300 };
    const out = applyCanvas(d, new Map([[0, rendered]]));
    expect(out.images[0]).toBe(rendered);
    expect(out.controls[0].box).toEqual({ x: 77, y: 10, w: 100, h: 20 });
  });
});
