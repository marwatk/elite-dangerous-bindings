/** How a global `<X Value=""/>` setting is edited. */
export type SettingType = 'decimal' | 'integer' | 'enum' | 'text';

export interface SettingField {
  code: string;
  name: string;
  value: string;
  type: SettingType;
  /** Decimals to write for `decimal` settings (Elite uses 8). */
  decimals: number;
  /** Known values for `enum` settings ('' means "not set"). */
  options: string[];
}

const DECIMAL = /^-?\d+\.(\d+)$/;
const INTEGER = /^-?\d+$/;

/**
 * Family of a setting, so settings that take the same kind of value can share
 * suggestions (every mouse-axis mode takes `Bindings_MouseYaw` etc.).
 */
export function settingFamily(code: string): string {
  if (/Mouse.*[XY]Mode$|Mouse[XY]Mode$|CameraMouse$|Buggy(Steering|Rolling)?[XY]?Mode$/.test(code) && /Mouse/.test(code))
    return 'mouseAxis';
  if (/^YawToRollMode/.test(code)) return 'yawToRoll';
  if (/PanelFocusOptions$/.test(code)) return 'panelFocus';
  if (/MuteButtonMode$/.test(code)) return 'mute';
  if (/^ThrottleRange/.test(code)) return 'throttleRange';
  return code;
}

/**
 * Work out an editor for each setting from the values seen in this file and
 * (optionally) a reference file such as the empty template. Duplicate codes
 * (the game writes MouseGUI twice) appear once.
 */
export function describeSettings(
  codes: readonly string[],
  value: (code: string) => string | null,
  name: (code: string) => string,
  reference: ReadonlyMap<string, string> = new Map(),
): SettingField[] {
  const unique = [...new Set(codes)];
  const valuesByFamily = new Map<string, Set<string>>();
  const note = (code: string, v: string | null | undefined) => {
    if (!v || DECIMAL.test(v) || INTEGER.test(v)) return;
    const fam = settingFamily(code);
    const set = valuesByFamily.get(fam) ?? new Set<string>();
    set.add(v);
    valuesByFamily.set(fam, set);
  };
  for (const c of unique) note(c, value(c));
  for (const [c, v] of reference) note(c, v);

  return unique.map((code) => {
    const v = value(code) ?? '';
    const ref = reference.get(code);
    const sample = v !== '' ? v : (ref ?? '');
    let type: SettingType = 'text';
    let decimals = 0;
    const dm = DECIMAL.exec(sample);
    if (dm) {
      type = 'decimal';
      decimals = dm[1].length;
    } else if (INTEGER.test(sample)) {
      type = 'integer';
    } else if (valuesByFamily.has(settingFamily(code))) {
      type = 'enum';
    }
    const options = type === 'enum' ? ['', ...[...valuesByFamily.get(settingFamily(code))!].sort()] : [];
    if (type === 'enum' && v && !options.includes(v)) options.push(v);
    return { code, name: name(code), value: v, type, decimals, options };
  });
}

/** Format a number the way the file writes this setting (e.g. `0.50000000`). */
export function formatSettingNumber(field: Pick<SettingField, 'type' | 'decimals'>, n: number): string {
  if (!Number.isFinite(n)) return '';
  if (field.type === 'integer') return String(Math.round(n));
  if (field.type === 'decimal') return n.toFixed(field.decimals || 8);
  return String(n);
}

/** Friendlier text for an enum value: `Bindings_MousePitchInverted` -> "Mouse Pitch Inverted". */
export function enumLabel(v: string): string {
  if (!v) return 'Not set';
  return v
    .replace(/^(Bindings|FocusOption|mute)_/, '')
    .replace(/_/g, ' ')
    .replace(/(?<=[a-z])(?=[A-Z])/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
}
