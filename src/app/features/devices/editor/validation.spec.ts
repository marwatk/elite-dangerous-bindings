import { EditorDraft, emptyDraft } from './draft';
import { ValidationContext, validateDraft } from './validation';

const ctx: ValidationContext = {
  bundledIds: new Set(['SaitekX56']),
  localIds: new Set(['Mine']),
  handledBy: (b) => (b === 'SaitekX56Joystick' ? 'SaitekX56' : undefined),
};

function draft(patch: Partial<EditorDraft> = {}): EditorDraft {
  return {
    ...emptyDraft(),
    name: 'Test',
    id: 'Test',
    ids: [{ uid: 'p', bindsId: '12345678' }],
    images: [{ uid: 'i', name: 'x', blob: new Blob([]), type: 'webp', width: 1000, height: 500 }],
    controls: [
      { uid: 'a', part: 'p', key: 'Joy_1', label: 'Trigger', kind: 'button', image: 0, box: { x: 10, y: 10, w: 100, h: 20 } },
      { uid: 'b', part: 'p', key: 'Joy_2', label: 'Pinky', kind: 'button', image: 0, box: { x: 10, y: 40, w: 100, h: 20 } },
    ],
    ...patch,
  };
}

const messages = (d: EditorDraft) => validateDraft(d, ctx).map((i) => `${i.level}: ${i.message}`);

describe('validateDraft', () => {
  it('passes a complete draft', () => {
    expect(messages(draft())).toEqual([]);
  });

  it('requires a name, a valid id and device IDs', () => {
    const m = messages(draft({ name: ' ', id: 'bad id', ids: [] }));
    expect(m.some((x) => x.startsWith('error') && /name/.test(x))).toBe(true);
    expect(m.some((x) => /letters, digits and dashes/.test(x))).toBe(true);
    expect(m.some((x) => /at least one Elite device ID/.test(x))).toBe(true);
  });

  it('rejects a bundled id unless editing it, and warns about replacing a local one', () => {
    expect(messages(draft({ id: 'SaitekX56' })).some((x) => x.startsWith('error') && /bundled/.test(x))).toBe(true);
    expect(messages(draft({ id: 'SaitekX56', baseId: 'SaitekX56' }))).toEqual([]);
    expect(messages(draft({ id: 'Mine' })).some((x) => x.startsWith('warning') && /replace/.test(x))).toBe(true);
  });

  it('warns about IDs handled by another bundled device', () => {
    const m = messages(draft({ ids: [{ uid: 'p', bindsId: 'SaitekX56Joystick' }] }));
    expect(m.some((x) => /already handled by the bundled device "SaitekX56"/.test(x))).toBe(true);
  });

  it('finds unplaced, overlapping and off-image boxes and duplicate labels', () => {
    const d = draft({
      controls: [
        { uid: 'a', part: 'p', key: 'Joy_1', label: 'Same', kind: 'button', image: 0, box: { x: 10, y: 10, w: 100, h: 20 } },
        { uid: 'b', part: 'p', key: 'Joy_2', label: 'Same', kind: 'button', image: 0, box: { x: 50, y: 15, w: 100, h: 20 } },
        { uid: 'c', part: 'p', key: 'Joy_3', label: 'Edge', kind: 'button', image: 0, box: { x: 950, y: 10, w: 100, h: 20 } },
        { uid: 'd', part: 'p', key: 'Joy_4', label: 'Nowhere', kind: 'button' },
      ],
    });
    const issues = validateDraft(d, ctx);
    const find = (re: RegExp) => issues.find((i) => re.test(i.message));
    expect(find(/have no box/)?.uids).toEqual(['d']);
    expect(find(/Overlapping/)?.uids?.sort()).toEqual(['a', 'b']);
    expect(find(/off the image/)?.uids).toEqual(['c']);
    expect(find(/Duplicate label "Same"/)?.uids).toEqual(['a', 'b']);
  });

  it('reports duplicate keys and boxes on a removed image as errors', () => {
    const d = draft({
      controls: [
        { uid: 'a', part: 'p', key: 'Joy_1', label: 'A', kind: 'button' },
        { uid: 'b', part: 'p', key: 'Joy_1', label: 'B', kind: 'button', image: 3, box: { x: 1, y: 1, w: 5, h: 5 } },
      ],
    });
    const errs = validateDraft(d, ctx).filter((i) => i.level === 'error').map((i) => i.message);
    expect(errs.some((m) => /Joy_1 is listed 2 times/.test(m))).toBe(true);
    expect(errs.some((m) => /removed image/.test(m))).toBe(true);
  });
});
