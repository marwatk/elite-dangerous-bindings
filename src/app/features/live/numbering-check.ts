import { ActionState } from '../../core/binds/binds-document';
import { boundUses, isAxisKey } from '../../core/binds/analysis';
import { InputCorrection } from '../../core/data/catalog.types';

/**
 * The numbering check: ask the user to operate controls that the open file
 * already binds, compare what the browser reports with what the file says,
 * and suggest a correction (button offset / axis remap) when the difference
 * is consistent.
 */

export type CheckKind = 'button' | 'axis' | 'hat';

export interface CheckTarget {
  /** Elite key expected, e.g. `Joy_5`, `Joy_XAxis` (axis halves reduced to their axis). */
  key: string;
  kind: CheckKind;
  /** Action codes bound to it (for the prompt). */
  actions: string[];
}

export interface CheckResult {
  target: CheckTarget;
  /** What the browser reported, or null when skipped. */
  got: string | null;
}

export interface CheckAnalysis {
  matches: number;
  mismatches: CheckResult[];
  skipped: number;
  allMatch: boolean;
  suggestion: InputCorrection | null;
  explanation: string;
}

export function baseKey(key: string): string {
  return key.replace(/^(Pos|Neg)_/, '');
}

export function kindOfKey(key: string): CheckKind {
  const k = baseKey(key);
  if (/POV\d+(Up|Down|Left|Right)$/.test(k)) return 'hat';
  if (isAxisKey(k) || /^(Pos|Neg)_/.test(key)) return 'axis';
  return 'button';
}

function buttonNumber(key: string | null): number | null {
  const m = key ? /^Joy_(\d+)$/.exec(key) : null;
  return m ? Number(m[1]) : null;
}

/** Pick a handful of distinct bound controls on one device: buttons spread over the range, a couple of axes, one hat. */
export function pickCheckTargets(actions: ActionState[], bindsId: string, deviceIndex: number, max = 5): CheckTarget[] {
  const byKey = new Map<string, CheckTarget>();
  const consider = (device: string, idx: number | undefined, key: string, code: string) => {
    if (device !== bindsId || (idx ?? 0) !== deviceIndex || !key) return;
    const k = baseKey(key);
    const t = byKey.get(k) ?? { key: k, kind: kindOfKey(key), actions: [] };
    if (!t.actions.includes(code)) t.actions.push(code);
    byKey.set(k, t);
  };
  for (const u of boundUses(actions)) {
    consider(u.binding.device, u.binding.deviceIndex, u.binding.key, u.code);
  }
  const all = [...byKey.values()];
  const buttons = all
    .filter((t) => t.kind === 'button')
    .sort((a, b) => (buttonNumber(a.key) ?? 999) - (buttonNumber(b.key) ?? 999) || a.key.localeCompare(b.key));
  const axes = all.filter((t) => t.kind === 'axis').sort((a, b) => a.key.localeCompare(b.key));
  const hats = all.filter((t) => t.kind === 'hat').sort((a, b) => a.key.localeCompare(b.key));

  const spread: CheckTarget[] = [];
  if (buttons.length <= 3) spread.push(...buttons);
  else spread.push(buttons[0], buttons[Math.floor(buttons.length / 2)], buttons[buttons.length - 1]);
  const picked = [...spread, ...axes.slice(0, 2), ...hats.slice(0, 1)];
  // Fill up with more buttons if axes/hats were missing.
  for (const b of buttons) {
    if (picked.length >= max) break;
    if (!picked.includes(b)) picked.push(b);
  }
  return picked.slice(0, max);
}

function inverse(map: Record<string, string> | undefined, key: string): string {
  if (!map) return key;
  const hit = Object.entries(map).find(([, v]) => v === key);
  return hit ? hit[0] : key;
}

/** Compare results and derive a correction on top of `current` (the correction active while checking). */
export function analyzeCheck(results: CheckResult[], current?: InputCorrection): CheckAnalysis {
  const done = results.filter((r) => r.got !== null);
  const mismatches = done.filter((r) => r.got !== r.target.key);
  const matches = done.length - mismatches.length;
  const base: Omit<CheckAnalysis, 'suggestion' | 'explanation'> = {
    matches,
    mismatches,
    skipped: results.length - done.length,
    allMatch: done.length > 0 && mismatches.length === 0,
  };
  if (!done.length) return { ...base, suggestion: null, explanation: 'Nothing was checked.' };
  if (!mismatches.length) {
    return { ...base, suggestion: null, explanation: 'The browser numbers these controls exactly like your file.' };
  }

  const notes: string[] = [];
  const suggestion: InputCorrection = {};

  // Buttons: one consistent offset?
  const btn = done.filter((r) => r.target.kind === 'button' && buttonNumber(r.target.key) !== null && buttonNumber(r.got) !== null);
  const btnMismatch = btn.some((r) => r.got !== r.target.key);
  let unexplained = mismatches.filter((r) => r.target.kind !== 'button' && r.target.kind !== 'axis').length;
  if (btnMismatch) {
    const diffs = new Set(btn.map((r) => buttonNumber(r.target.key)! - buttonNumber(r.got)!));
    const nonNumeric = mismatches.filter((r) => r.target.kind === 'button' && !btn.includes(r)).length;
    unexplained += nonNumeric;
    if (diffs.size === 1) {
      const d = [...diffs][0];
      suggestion.buttonOffset = (current?.buttonOffset ?? 0) + d;
      notes.push(`Buttons are consistently off by ${d > 0 ? '+' : ''}${d}.`);
    } else {
      unexplained += btn.filter((r) => r.got !== r.target.key).length;
      notes.push('Button numbers differ, but not by a constant offset.');
    }
  } else if (current?.buttonOffset) {
    suggestion.buttonOffset = current.buttonOffset;
  }

  // Axes: remap each mismatched axis; complete one-sided swaps.
  const axisMis = mismatches.filter((r) => r.target.kind === 'axis');
  const map: Record<string, string> = { ...(current?.axisMap ?? {}) };
  if (axisMis.length) {
    const checkedExpected = new Set(done.filter((r) => r.target.kind === 'axis').map((r) => r.target.key));
    for (const r of axisMis) {
      if (!r.got || !/Axis$|Stick[XY]$/.test(r.got)) {
        unexplained++;
        continue;
      }
      const raw = inverse(current?.axisMap, r.got);
      map[raw] = r.target.key;
      const rawOfExpected = inverse(current?.axisMap, r.target.key);
      if (!checkedExpected.has(r.got) && !(rawOfExpected in map && map[rawOfExpected] !== r.target.key)) {
        map[rawOfExpected] = r.got;
      }
      notes.push(`${r.target.key} arrives as ${r.got}.`);
    }
  }
  for (const [k, v] of Object.entries(map)) if (k === v) delete map[k];
  if (Object.keys(map).length) suggestion.axisMap = map;

  const useful = suggestion.buttonOffset !== undefined || suggestion.axisMap !== undefined;
  if (unexplained) notes.push('Some differences have no simple fix: check the device ID and DeviceIndex, or rebind those controls.');
  return { ...base, suggestion: useful ? suggestion : null, explanation: notes.join(' ') };
}
