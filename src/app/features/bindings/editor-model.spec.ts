import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ActionState, BindsDocument, SlotBinding } from '../../core/binds/binds-document';
import { CaptureResult, LiveDevice } from '../../core/input/input.types';
import {
  acceptFor,
  actionsWithDraft,
  addModifier,
  applyDraft,
  captureToSlot,
  controlClass,
  controlsForDevice,
  draftEdits,
  draftFrom,
  filterPickItems,
  isCompatible,
  removeModifier,
  slotsEqual,
  withInput,
} from './editor-model';

const CUSTOM = readFileSync(resolve(process.cwd(), 'src/testing/fixtures/Custom.4.2.binds'), 'utf-8');

const dev: LiveDevice = {
  id: 'hid:044F:B108:0',
  name: 'T.Flight HOTAS X',
  backend: 'webhid',
  bindsId: 'ThrustMasterTFlightHOTASX',
  deviceIndex: 0,
  candidates: ['ThrustMasterTFlightHOTASX'],
  connected: true,
  buttons: 12,
  axes: 5,
  hats: 1,
};

function result(partial: Partial<CaptureResult>): CaptureResult {
  return {
    ref: { device: 'ThrustMasterTFlightHOTASX', key: 'Joy_1' },
    modifiers: [],
    kind: 'button',
    device: dev,
    ...partial,
  };
}

const BUTTON = { kind: 'button' as const };
const ANALOGUE_OK = { kind: 'button' as const, hasAnalogue: true };
const AXIS = { kind: 'axis' as const };

describe('controlClass / isCompatible', () => {
  it('classifies Elite control names', () => {
    expect(controlClass('Joy_XAxis')).toBe('axis');
    expect(controlClass('GamePad_LStickX')).toBe('axis');
    expect(controlClass('Pos_Joy_XAxis')).toBe('half');
    expect(controlClass('Joy_POV1Up')).toBe('hat');
    expect(controlClass('Key_A')).toBe('key');
    expect(controlClass('Joy_3')).toBe('button');
    expect(controlClass('Mouse_ZAxis')).toBe('axis');
  });

  it('allows axes only for axis actions, never whole axes for plain button actions', () => {
    expect(isCompatible('Joy_XAxis', AXIS)).toBe(true);
    expect(isCompatible('Joy_1', AXIS)).toBe(false);
    expect(isCompatible('Pos_Joy_XAxis', AXIS)).toBe(false);
    expect(isCompatible('Joy_XAxis', BUTTON)).toBe(false);
    expect(isCompatible('Joy_XAxis', ANALOGUE_OK)).toBe(true);
    expect(isCompatible('Neg_Joy_XAxis', BUTTON)).toBe(true);
    expect(isCompatible('Key_A', BUTTON)).toBe(true);
    expect(isCompatible('Joy_POV1Up', BUTTON)).toBe(true);
    expect(isCompatible('Joy_XAxis', AXIS, 'modifier')).toBe(false);
    expect(isCompatible('Key_LeftShift', AXIS, 'modifier')).toBe(true);
  });

  it('asks capture for the right kinds', () => {
    expect(acceptFor(AXIS)).toEqual(['axis']);
    expect(acceptFor(BUTTON)).toEqual(['button', 'hat', 'key', 'axis']);
    expect(acceptFor(BUTTON, 'modifier')).toEqual(['button', 'hat', 'key']);
  });
});

describe('captureToSlot', () => {
  it('uses a button press with its modifiers', () => {
    const out = captureToSlot(
      result({ modifiers: [{ device: 'Keyboard', key: 'Key_LeftShift' }, { device: 'Keyboard', key: 'Key_LeftShift' }] }),
      BUTTON,
      null,
    );
    expect(out.binding).toEqual({
      device: 'ThrustMasterTFlightHOTASX',
      key: 'Joy_1',
      modifiers: [{ device: 'Keyboard', key: 'Key_LeftShift' }],
      hold: false,
    });
    expect(out.suggestInverted).toBe(false);
    expect(out.fullAxis).toBeNull();
  });

  it('turns an axis capture on a digital action into the half it moved towards', () => {
    const pos = captureToSlot(result({ ref: { device: 'D', key: 'Joy_XAxis' }, kind: 'axis', direction: 1 }), BUTTON, null);
    expect(pos.binding.key).toBe('Pos_Joy_XAxis');
    expect(pos.fullAxis).toBeNull();
    const neg = captureToSlot(result({ ref: { device: 'D', key: 'Joy_XAxis' }, kind: 'axis', direction: -1 }), BUTTON, null);
    expect(neg.binding.key).toBe('Neg_Joy_XAxis');
    expect(neg.suggestInverted).toBe(false);
  });

  it('offers the whole axis for digital actions that accept analogue input', () => {
    const out = captureToSlot(result({ ref: { device: 'D', key: 'Joy_ZAxis' }, kind: 'axis', direction: 1 }), ANALOGUE_OK, null);
    expect(out.binding.key).toBe('Pos_Joy_ZAxis');
    expect(out.fullAxis?.key).toBe('Joy_ZAxis');
  });

  it('suggests Inverted when an axis action was moved negatively', () => {
    const neg = captureToSlot(result({ ref: { device: 'D', key: 'Joy_YAxis' }, kind: 'axis', direction: -1 }), AXIS, null);
    expect(neg.binding.key).toBe('Joy_YAxis');
    expect(neg.suggestInverted).toBe(true);
    const pos = captureToSlot(result({ ref: { device: 'D', key: 'Joy_YAxis' }, kind: 'axis', direction: 1 }), AXIS, null);
    expect(pos.suggestInverted).toBe(false);
  });

  it('keeps the slot Hold flag, drops a modifier equal to the input, and normalises DeviceIndex 0', () => {
    const prev: SlotBinding = { device: 'Keyboard', key: 'Key_A', modifiers: [], hold: true };
    const out = captureToSlot(
      result({ ref: { device: 'D', key: 'Joy_2', deviceIndex: 0 }, modifiers: [{ device: 'D', key: 'Joy_2' }, { device: 'D', key: 'Joy_5', deviceIndex: 1 }] }),
      BUTTON,
      prev,
    );
    expect(out.binding).toEqual({ device: 'D', key: 'Joy_2', modifiers: [{ device: 'D', key: 'Joy_5', deviceIndex: 1 }], hold: true });
    expect('deviceIndex' in out.binding).toBe(false);
  });
});

describe('slot helpers', () => {
  const base: SlotBinding = { device: 'Keyboard', key: 'Key_A', modifiers: [{ device: 'Keyboard', key: 'Key_LeftShift' }], hold: true };

  it('replaces the input but keeps modifiers and hold', () => {
    expect(withInput(base, { device: 'Keyboard', key: 'Key_B' })).toEqual({ ...base, key: 'Key_B' });
    expect(withInput(null, { device: 'Mouse', key: 'Mouse_1' })).toEqual({ device: 'Mouse', key: 'Mouse_1', modifiers: [], hold: false });
    // A modifier that becomes the input itself is dropped.
    expect(withInput(base, { device: 'Keyboard', key: 'Key_LeftShift' }).modifiers).toEqual([]);
  });

  it('adds and removes modifiers without duplicates', () => {
    const one = addModifier(base, { device: 'Keyboard', key: 'Key_LeftShift' });
    expect(one).toBe(base);
    const two = addModifier(base, { device: 'Mouse', key: 'Mouse_4' });
    expect(two.modifiers.length).toBe(2);
    expect(removeModifier(two, 0).modifiers).toEqual([{ device: 'Mouse', key: 'Mouse_4' }]);
    expect(addModifier(base, { device: 'Keyboard', key: 'Key_A' })).toBe(base);
  });

  it('compares slots, treating empty and {NoDevice} alike', () => {
    expect(slotsEqual(null, { device: '{NoDevice}', key: '', modifiers: [], hold: false })).toBe(true);
    expect(slotsEqual(base, { ...base })).toBe(true);
    expect(slotsEqual(base, { ...base, hold: false })).toBe(false);
    expect(slotsEqual(base, { ...base, modifiers: [] })).toBe(false);
  });
});

describe('drafts', () => {
  it('applies only what changed, as a single batch of document edits', () => {
    const doc = BindsDocument.parse(CUSTOM);
    const orig = doc.getAction('PitchAxisRaw')!;
    const draft = draftFrom(orig);
    expect(draftEdits(orig, draft)).toEqual([]);
    draft.slots.Binding = { device: 'Mouse', key: 'Mouse_YAxis', modifiers: [], hold: false };
    draft.inverted = false;
    draft.deadzone = 0.1;
    draft.clearOthers = [{ code: 'RollAxisRaw', slot: 'Binding' }];
    expect(draftEdits(orig, draft).map((e) => e.kind)).toEqual(['slot', 'inverted', 'deadzone', 'clearOther']);
    expect(applyDraft(doc, orig, draft)).toBe(4);
    const after = doc.getAction('PitchAxisRaw')!;
    expect(after.slots.Binding?.key).toBe('Mouse_YAxis');
    expect(after.inverted).toBe(false);
    expect(after.deadzone).toBeCloseTo(0.1);
    expect(doc.getAction('RollAxisRaw')!.slots.Binding?.device).toBe('{NoDevice}');
    expect(doc.serialize()).toContain('<Deadzone Value="0.10000000" />');
  });

  it('leaves untouched flags alone (no new elements)', () => {
    const doc = BindsDocument.parse(CUSTOM);
    const orig = doc.getAction('BackwardKey')!;
    const draft = draftFrom(orig);
    draft.slots.Secondary = { device: 'Keyboard', key: 'Key_Down', modifiers: [], hold: false };
    applyDraft(doc, orig, draft);
    const out = doc.serialize().split('\n');
    const before = CUSTOM.split('\n');
    expect(out.length).toBe(before.length);
    expect(out.filter((l, i) => l !== before[i]).length).toBe(1);
  });

  it('shows conflicts as they would be after the draft', () => {
    const doc = BindsDocument.parse(CUSTOM);
    const actions: ActionState[] = doc.actions();
    const orig = doc.getAction('BackwardKey')!;
    const draft = draftFrom(orig);
    draft.slots.Primary = null;
    draft.clearOthers = [{ code: 'LandingGearToggle', slot: 'Primary' }];
    const next = actionsWithDraft(actions, orig, draft);
    expect(next.find((a) => a.code === 'BackwardKey')!.slots.Primary).toBeNull();
    expect(next.find((a) => a.code === 'LandingGearToggle')!.slots.Primary).toBeNull();
    expect(next.find((a) => a.code === 'LandingGearToggle')!.slots.Secondary).toBeDefined();
    // Original list untouched.
    expect(actions.find((a) => a.code === 'LandingGearToggle')!.slots.Primary?.key).toBe('Key_K');
  });
});

describe('picker lists', () => {
  const generic = [
    { key: 'Joy_XAxis', label: 'Stick X', kind: 'axis' as const },
    { key: 'Joy_1', label: 'Stick 1', kind: 'button' as const },
    { key: 'Joy_POV1Up', label: 'Hat 1 Up', kind: 'hat' as const },
  ];

  it('uses keys for the keyboard and adds axis halves for devices', () => {
    const keys = controlsForDevice('Keyboard', 0, undefined, [{ key: 'Key_A', label: 'A' }], generic);
    expect(keys).toEqual([{ key: 'Key_A', label: 'A', cls: 'key' }]);
    const items = controlsForDevice('Unknown123', 0, undefined, [], generic);
    expect(items.map((i) => i.key)).toEqual(['Joy_XAxis', 'Joy_1', 'Joy_POV1Up', 'Pos_Joy_XAxis', 'Neg_Joy_XAxis']);
  });

  it('prefers the device definition for that bindsId and index', () => {
    const def = {
      controls: [
        { bindsId: 'A', key: 'Joy_1', label: 'Trigger', kind: 'button' as const },
        { bindsId: 'B', key: 'Joy_2', label: 'Other device', kind: 'button' as const },
        { bindsId: 'A', key: 'Joy_3', label: 'Second unit', kind: 'button' as const, deviceIndex: 1 },
      ],
    };
    expect(controlsForDevice('A', 0, def, [], generic).map((i) => i.label)).toEqual(['Trigger']);
    expect(controlsForDevice('A', 1, def, [], generic).map((i) => i.label)).toEqual(['Trigger', 'Second unit']);
    expect(controlsForDevice('C', 0, def, [], generic).length).toBe(5);
  });

  it('filters by compatibility and search text', () => {
    const items = controlsForDevice('X', 0, undefined, [], generic);
    expect(filterPickItems(items, AXIS, 'binding', '').map((i) => i.key)).toEqual(['Joy_XAxis']);
    expect(filterPickItems(items, BUTTON, 'binding', '').map((i) => i.key)).toEqual([
      'Joy_1',
      'Joy_POV1Up',
      'Pos_Joy_XAxis',
      'Neg_Joy_XAxis',
    ]);
    expect(filterPickItems(items, BUTTON, 'binding', 'hat up').map((i) => i.key)).toEqual(['Joy_POV1Up']);
  });
});
