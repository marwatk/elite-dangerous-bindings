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

const messages = (d: EditorDraft) =>
  validateDraft(d, ctx)
    .filter((i) => i.level !== 'hint')
    .map((i) => `${i.level}: ${i.message}`);

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
    // Boxes beside the photo are fine: the canvas grows (50 px over + 48 px margin).
    expect(find(/beside the photo/)).toMatchObject({ level: 'hint', uids: ['c'] });
    expect(find(/beside the photo/)?.message).toMatch(/grows to 1098 × 500 px/);
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

  it('hints (only) at boxes without a leader line on user images', () => {
    const hints = (d: EditorDraft) => validateDraft(d, ctx).filter((i) => i.level === 'hint');
    const h = hints(draft());
    expect(h.length).toBe(1);
    expect(h[0].uids).toEqual(['a', 'b']);
    expect(h[0].message).toMatch(/Optional: 2 box\(es\) have no line/);
    const lined = draft();
    lined.controls = lined.controls.map((c) => ({ ...c, leader: [{ x: 500, y: 300 }] }));
    expect(hints(lined)).toEqual([]);
    // EDRefCard artwork has its lines printed on it.
    const ref = draft({ baseSource: 'edrefcard2' });
    ref.images = ref.images.map((i) => ({ ...i, file: 'x.webp' }));
    expect(hints(ref)).toEqual([]);
  });

  it('checks groups: members, markers and placement', () => {
    const d = draft({
      controls: [
        { uid: 'a', part: 'p', key: 'Joy_POV1Up', label: 'H1 ↑', kind: 'hat' },
        { uid: 'b', part: 'p', key: 'Joy_POV1Down', label: 'H1 ↓', kind: 'hat' },
        { uid: 'c', part: 'p', key: 'Joy_5', label: 'H1 ●', kind: 'button' },
      ],
      groups: [{ uid: 'g', part: 'p', label: 'H1', layout: 'stack', showLabel: true, members: [{ control: 'a', marker: '↑' }, { control: 'b', marker: '↓' }, { control: 'c', marker: '●' }] }],
    });
    // Unplaced: the group is one item to place.
    expect(validateDraft(d, ctx).find((i) => /have no box/.test(i.message))).toMatchObject({ level: 'warning', uids: ['g'] });
    d.groups![0].box = { x: 10, y: 100, w: 300, h: 90 };
    d.groups![0].image = 0;
    expect(messages(d)).toEqual([]);
    d.groups![0].members[2].marker = '↓';
    d.groups![0].members[1].marker = '';
    const m = messages(d);
    expect(m.some((x) => /1 member\(s\) have no marker/.test(x))).toBe(true);
    d.groups![0].members[1].marker = '↓';
    expect(messages(d).some((x) => /marker ↓ is used twice/.test(x))).toBe(true);
    d.groups![0].members = d.groups![0].members.slice(0, 1);
    expect(messages(d).some((x) => /needs at least 2 controls/.test(x))).toBe(true);
  });
});
