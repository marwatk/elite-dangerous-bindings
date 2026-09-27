/** Building the control list: from counts, templates, button maps or presses. */
import { ControlKind } from '../../../core/data/catalog.types';
import { kindForKey } from '../../../core/devices/device-files';
import { DraftControl, newUid } from './draft';

export interface ControlSpec {
  key: string;
  label: string;
  kind: ControlKind;
}

/** Browser axis order -> Elite axis keys. */
export const AXIS_KEYS = ['Joy_XAxis', 'Joy_YAxis', 'Joy_ZAxis', 'Joy_RXAxis', 'Joy_RYAxis', 'Joy_RZAxis', 'Joy_UAxis', 'Joy_VAxis'];
const HAT_DIRS = ['Up', 'Right', 'Down', 'Left'];

/** A readable default label for an Elite control key. */
export function defaultLabel(key: string): string {
  const half = /^(Pos|Neg)_(.*)$/.exec(key);
  if (half) return `${defaultLabel(half[2])} ${half[1] === 'Pos' ? '+' : '−'}`;
  let m = /^Joy_(\d+)$/.exec(key);
  if (m) return `Button ${m[1]}`;
  m = /^Joy_(R?)([XYZUV])Axis$/.exec(key);
  if (m) return `${m[1] ? 'Rotary ' : ''}${m[2]} axis`;
  m = /^Joy_POV(\d+)(Up|Down|Left|Right)$/.exec(key);
  if (m) return `Hat ${m[1]} ${m[2]}`;
  return key
    .replace(/^(Joy|GamePad|Pad)_/, '')
    .replace(/(?<=[a-z0-9])(?=[A-Z])/g, ' ')
    .trim();
}

/** Controls for a device with this many buttons, axes and hats (browser order). */
export function controlsFromCounts(buttons: number, axes: number, hats: number): ControlSpec[] {
  const out: ControlSpec[] = [];
  for (let i = 0; i < Math.min(axes, AXIS_KEYS.length); i++) {
    out.push({ key: AXIS_KEYS[i], label: defaultLabel(AXIS_KEYS[i]), kind: 'axis' });
  }
  for (let h = 1; h <= Math.min(hats, 4); h++) {
    for (const dir of HAT_DIRS) {
      const key = `Joy_POV${h}${dir}`;
      out.push({ key, label: defaultLabel(key), kind: 'hat' });
    }
  }
  for (let b = 1; b <= Math.min(buttons, 128); b++) out.push({ key: `Joy_${b}`, label: `Button ${b}`, kind: 'button' });
  return out;
}

/** A control spec from just a key (e.g. pressed on the device). */
export function specForKey(key: string): ControlSpec {
  return { key, label: defaultLabel(key), kind: kindForKey(key) };
}

const KIND_ORDER: Record<ControlKind, number> = { button: 0, hat: 1, axis: 2 };

/** Natural order: buttons 1..N, then hats, then axes (halves after their axis). */
export function compareControls(a: { key: string; kind: ControlKind }, b: { key: string; kind: ControlKind }): number {
  const base = (k: string) => k.replace(/^(Pos|Neg)_/, '');
  return (
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    base(a.key).localeCompare(base(b.key), 'en', { numeric: true }) ||
    a.key.length - b.key.length ||
    a.key.localeCompare(b.key)
  );
}

/**
 * Add controls that aren't in the part yet. With `relabel`, existing
 * controls take the incoming labels (e.g. from a .buttonMap).
 */
export function mergeControls(
  existing: DraftControl[],
  incoming: ControlSpec[],
  part: string,
  relabel = false,
): { controls: DraftControl[]; added: number; relabelled: number } {
  const byKey = new Map(existing.filter((c) => c.part === part).map((c) => [c.key, c]));
  let added = 0;
  let relabelled = 0;
  const controls = existing.map((c) => {
    const inc = c.part === part && relabel ? incoming.find((i) => i.key === c.key) : undefined;
    if (inc && inc.label && inc.label !== c.label) {
      relabelled++;
      return { ...c, label: inc.label };
    }
    return c;
  });
  for (const spec of incoming) {
    if (byKey.has(spec.key)) continue;
    const c: DraftControl = { uid: newUid(), part, key: spec.key, label: spec.label, kind: spec.kind };
    byKey.set(spec.key, c);
    controls.push(c);
    added++;
  }
  return { controls, added, relabelled };
}

/** A short list of Elite's in-game icon tokens (EDCD EliteCustomButtonNames). */
export const ICON_TOKENS: { token: string; label: string }[] = [
  { token: '[x52prox]', label: 'Stick X' },
  { token: '[x52proy]', label: 'Stick Y' },
  { token: '[x52prorz]', label: 'Stick twist' },
  { token: '[x52prorx]', label: 'Rotary X' },
  { token: '[x52prory]', label: 'Rotary Y' },
  { token: '[x52z]', label: 'Throttle' },
  { token: '[x52prou]', label: 'U axis' },
  { token: '[ps4PadU]', label: 'Hat up' },
  { token: '[ps4PadR]', label: 'Hat right' },
  { token: '[ps4PadD]', label: 'Hat down' },
  { token: '[ps4PadL]', label: 'Hat left' },
  { token: '[x360LThumb]', label: 'Thumbstick' },
  { token: '[ps4RXAxis]', label: 'Right stick X' },
  { token: '[ps4RYAxis]', label: 'Right stick Y' },
  { token: '[ps4Circle]', label: 'Circle' },
  { token: '[ps4Triangle]', label: 'Triangle' },
  { token: '[ps4Square]', label: 'Square' },
];

const TOKEN = /\s*\[[A-Za-z0-9_]+\]\s*/g;

/** Label without icon tokens (for display where icons can't render). */
export function stripIconTokens(label: string): string {
  return label.replace(TOKEN, ' ').replace(/\s+/g, ' ').trim();
}

/** Set (or with null, remove) the icon token in a label. */
export function withIconToken(label: string, token: string | null): string {
  const base = stripIconTokens(label);
  return token ? `${base} ${token}`.trim() : base;
}

export function iconTokenOf(label: string): string | null {
  return /\[[A-Za-z0-9_]+\]/.exec(label)?.[0] ?? null;
}
