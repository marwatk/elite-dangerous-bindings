import Ajv from 'ajv/dist/2020';
import schema from '../../../../../schemas/device.schema.json';
import { deviceJson, schemaErrors } from '../../../core/devices/device-files';
import { EditorDraft, definitionToDraft, draftToDefinition, emptyDraft, placeableControls } from './draft';
import { cleanGroups, createGroup, groupSpecFor, ungroup, updateGroup } from './groups';

const validate = new Ajv({ allErrors: true }).compile(schema);
const blob = () => new Blob([new Uint8Array([1])], { type: 'image/webp' });

function draft(): EditorDraft {
  const keys = ['Joy_1', 'Joy_POV1Up', 'Joy_POV1Right', 'Joy_POV1Down', 'Joy_POV1Left', 'Joy_5', 'Joy_6', 'Joy_7'];
  return {
    ...emptyDraft(),
    id: 'T',
    name: 'T',
    ids: [{ uid: 'p', bindsId: '12345678' }, { uid: 'q', bindsId: 'NamedStick', aliasOf: 'p' }],
    images: [{ uid: 'i', name: 'x', blob: blob(), type: 'webp', width: 1000, height: 600 }],
    controls: keys.map((key, i) => ({
      uid: `c${i}`,
      part: 'p',
      key,
      label: key === 'Joy_6' ? 'Rocker fwd' : key === 'Joy_1' ? 'Trigger' : key.startsWith('Joy_POV') ? `Hat 1 ${key.slice(8)}` : `Button ${key.slice(4)}`,
      kind: key.startsWith('Joy_POV') ? ('hat' as const) : ('button' as const),
      ...(key === 'Joy_POV1Up' ? { image: 0, box: { x: 10, y: 10, w: 100, h: 20 }, leader: [{ x: 500, y: 300 }] } : {}),
    })),
  };
}

describe('control groups', () => {
  it('groups controls with auto markers and names, taking over the first box', () => {
    let d = draft();
    const spec = groupSpecFor(d, ['c1', 'c2', 'c3', 'c4', 'c5'], 'H1');
    expect(spec.members.map((m) => m.marker)).toEqual(['↑', '→', '↓', '←', '']);
    spec.members[4].marker = '●';
    d = createGroup(d, spec, 'g1');
    expect(d.groups).toHaveLength(1);
    expect(d.groups![0]).toMatchObject({ uid: 'g1', part: 'p', label: 'H1', layout: 'stack', showLabel: true, box: { x: 10, y: 10, w: 100, h: 20 }, image: 0 });
    expect(d.controls.slice(1, 6).map((c) => c.label)).toEqual(['H1 ↑', 'H1 →', 'H1 ↓', 'H1 ←', 'H1 ●']);
    expect(d.controls[1].box).toBeUndefined();
    // The checklist has one item for the group, where its first member was.
    expect(placeableControls(d).map((c) => c.uid)).toEqual(['c0', 'g1', 'c6', 'c7']);
  });

  it('keeps names the user chose and follows label and marker changes', () => {
    let d = createGroup(draft(), { label: 'Rocker', layout: 'row', showLabel: true, members: [{ control: 'c6', marker: 'Fwd' }, { control: 'c7', marker: 'Back' }] }, 'g');
    expect(d.controls[6].label).toBe('Rocker fwd');
    expect(d.controls[7].label).toBe('Rocker Back');
    d = updateGroup(d, 'g', { label: 'R1', members: [{ control: 'c7', marker: '−' }, { control: 'c6', marker: '+' }] });
    expect(d.groups![0].members.map((m) => m.control)).toEqual(['c7', 'c6']);
    expect(d.controls[7].label).toBe('R1 −');
    expect(d.controls[6].label).toBe('Rocker fwd');
    d = ungroup(d, 'g');
    expect(d.groups).toEqual([]);
    expect(d.controls[7].label).toBe('Button 7');
  });

  it('moves controls between groups and drops removed members', () => {
    let d = createGroup(draft(), groupSpecFor(draft(), ['c1', 'c2'], 'A'), 'a');
    d = createGroup(d, groupSpecFor(d, ['c2', 'c3'], 'B'), 'b');
    expect(d.groups!.map((g) => [g.uid, g.members.map((m) => m.control)])).toEqual([
      ['a', ['c1']],
      ['b', ['c2', 'c3']],
    ]);
    d = cleanGroups({ ...d, controls: d.controls.filter((c) => c.uid !== 'c1') });
    expect(d.groups!.map((g) => g.uid)).toEqual(['b']);
  });

  it('exports groups for every Elite ID (aliases too) with drawBoxes, and reads them back', () => {
    let d = draft();
    const spec = groupSpecFor(d, ['c1', 'c2', 'c3', 'c4', 'c5'], 'H1');
    spec.members[4].marker = '●';
    d = createGroup(d, spec, 'g1');
    d = createGroup(d, { label: 'Rocker', layout: 'row', showLabel: false, members: [{ control: 'c6', marker: '+' }, { control: 'c7', marker: '−' }] }, 'g2');
    d = { ...d, groups: d.groups!.map((g) => (g.uid === 'g2' ? { ...g, image: 0, box: { x: 300, y: 300, w: 400, h: 40 } } : g)) };
    const def = draftToDefinition(d);
    expect(def.drawBoxes).toBe(true);
    expect(def.groups!.map((g) => [g.id, g.members[0].bindsId, g.members.length])).toEqual([
      ['H1', '12345678', 5],
      ['Rocker', '12345678', 2],
      ['H1-2', 'NamedStick', 5],
      ['Rocker-2', 'NamedStick', 2],
    ]);
    expect(def.groups![1]).toMatchObject({ layout: 'row', showLabel: false });
    expect(def.controls.filter((c) => c.key === 'Joy_POV1Up').every((c) => !c.box)).toBe(true);
    const json = JSON.parse(deviceJson(def));
    expect(validate(json)).toBe(true);
    expect(schemaErrors(json)).toEqual([]);
    // And back: the alias's copies are not separate groups.
    const back = definitionToDraft(json, [blob()]);
    expect(back.groups!.map((g) => [g.id, g.label, g.layout, g.showLabel, g.members.map((m) => m.marker).join('')])).toEqual([
      ['H1', 'H1', 'stack', true, '↑→↓←●'],
      ['Rocker', 'Rocker', 'row', false, '+−'],
    ]);
    expect(back.ids[1].aliasOf).toBe(back.ids[0].uid);
    expect(draftToDefinition(back).groups).toEqual(def.groups);
  });
});
