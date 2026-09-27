export interface GameVersion {
  major: number;
  minor: number;
  label: string;
}

export const GAME_VERSIONS: GameVersion[] = [
  { major: 4, minor: 2, label: '4.2 – Odyssey (current)' },
  { major: 4, minor: 1, label: '4.1 – Odyssey' },
  { major: 4, minor: 0, label: '4.0 – Odyssey' },
  { major: 3, minor: 0, label: '3.0 – Horizons' },
];

export const BINDINGS_FOLDER = '%LOCALAPPDATA%\\Frontier Developments\\Elite Dangerous\\Options\\Bindings';

/** Characters Windows doesn't allow in file names. */
const INVALID = /[\\/:*?"<>|\u0000-\u001f]/;

export function presetNameError(name: string): string | null {
  if (!name.trim()) return 'Enter a preset name';
  if (INVALID.test(name)) return 'A preset name can’t contain \\ / : * ? " < > |';
  if (/\.$|^\./.test(name)) return 'A preset name can’t start or end with a dot';
  if (name.length > 100) return 'Keep the preset name under 100 characters';
  return null;
}

/** Same rule as `BindsDocument.fileName`. */
export function bindsFileName(preset: string, major: number, minor: number): string {
  return `${preset || 'Custom'}.${major}.${minor}.binds`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** `Custom.4.2.binds` -> `Custom.4.2.20260926-101500.bak` (local time). */
export function backupFileName(fileName: string, when: Date): string {
  const base = fileName.replace(/\.binds$/i, '');
  const stamp =
    `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}-` +
    `${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`;
  return `${base}.${stamp}.bak`;
}
