import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BindsDocument, SlotBinding } from '../../core/binds/binds-document';
import { draftFrom } from './editor-model';
import { applyLinks, linkKey, linkSections, linkWrites, linkedAxisOptions } from './link-model';

const text = readFileSync(resolve(process.cwd(), 'src/testing/fixtures/X52.4.2.binds'), 'utf-8');
const load = () => {
  const doc = BindsDocument.parse(text);
  return { doc, actions: new Map(doc.actions().map((a) => [a.code, a])) };
};
const joy = (key: string): SlotBinding => ({ device: 'SaitekX52', key, modifiers: [], hold: false });

describe('link model', () => {
  it('builds sections only for changed slots', () => {
    const { actions } = load();
    const orig = actions.get('IncreaseEnginesPower')!;
    const draft = draftFrom(orig);
    expect(linkSections(orig, draft, actions)).toEqual([]);
    draft.slots.Secondary = joy('Joy_16');
    const sections = linkSections(orig, draft, actions);
    expect(sections.map((s) => s.slot)).toEqual(['Secondary']);
    expect(sections[0].groups.some((g) => g.kind === 'equivalent')).toBe(true);
  });

  it('turns checked suggestions into writes, honouring user overrides', () => {
    const { actions } = load();
    const orig = actions.get('IncreaseEnginesPower')!;
    const draft = { ...draftFrom(orig), slots: { ...orig.slots, Secondary: joy('Joy_16') } };
    const sections = linkSections(orig, draft, actions);
    const defaults = linkWrites(sections, (_, suggested) => suggested);
    expect(defaults).toContainEqual({ code: 'IncreaseEnginesPower_Buggy', slot: 'Secondary', binding: joy('Joy_16') });
    const key = linkKey('Secondary', { code: 'IncreaseEnginesPower_Buggy', slot: 'Secondary' });
    const none = linkWrites(sections, (k, suggested) => (k === key ? false : suggested));
    expect(none.find((w) => w.code === 'IncreaseEnginesPower_Buggy')).toBeUndefined();
  });

  it('applies writes and keeps in-step axis options following', () => {
    const { doc, actions } = load();
    // Ship pitch (inverted) -> new axis, un-inverted. SRV pitch was inverted too (follows);
    // galaxy map pitch was not inverted (unchanged).
    const orig = actions.get('PitchAxisRaw')!;
    const draft = { ...draftFrom(orig), slots: { Binding: joy('Joy_RYAxis') }, inverted: false };
    const sections = linkSections(orig, draft, actions);
    const writes = linkWrites(sections, (_, s) => s);
    expect(writes.map((w) => w.code)).toEqual(expect.arrayContaining(['BuggyPitchAxis', 'CamPitchAxis']));
    applyLinks(doc, writes, actions, orig, draft);
    expect(doc.getAction('BuggyPitchAxis')!.slots.Binding!.key).toBe('Joy_RYAxis');
    expect(doc.getAction('BuggyPitchAxis')!.inverted).toBe(false);
    expect(doc.getAction('CamPitchAxis')!.slots.Binding!.key).toBe('Joy_RYAxis');
    expect(doc.getAction('CamPitchAxis')!.inverted).toBe(false);
    expect(doc.getAction('PitchCamera')!.inverted).toBe(false); // was inverted like ship pitch: follows
  });

  it('leaves axis options alone when the edited command did not change them', () => {
    const { actions } = load();
    const orig = actions.get('ThrottleAxis')!;
    const draft = { ...draftFrom(orig), slots: { Binding: joy('Joy_UAxis') } };
    expect(linkedAxisOptions(actions.get('DriveSpeedAxis')!, orig, draft)).toEqual({ inverted: true, deadzone: 0 });
  });
});
