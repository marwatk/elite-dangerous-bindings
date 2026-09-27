/**
 * Full-size keyboard geometry (ANSI 104 with numpad) in key units (u).
 * The ISO variant replaces the wide left Shift with Shift + the extra key
 * next to it (Elite's Key_OEM_102).
 */

export interface KeyCap {
  /** Elite key name. */
  key: string;
  /** Other Elite names drawn on the same cap. */
  aliases?: string[];
  /** Cap text override (default: keys.json label). */
  cap?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

type RowItem = [key: string, w?: number] | number;

const F_ROW: RowItem[] = [
  ['Key_Escape'],
  1,
  ['Key_F1'],
  ['Key_F2'],
  ['Key_F3'],
  ['Key_F4'],
  0.5,
  ['Key_F5'],
  ['Key_F6'],
  ['Key_F7'],
  ['Key_F8'],
  0.5,
  ['Key_F9'],
  ['Key_F10'],
  ['Key_F11'],
  ['Key_F12'],
];

const MAIN_ROWS: RowItem[][] = [
  [
    ['Key_Grave'],
    ['Key_1'],
    ['Key_2'],
    ['Key_3'],
    ['Key_4'],
    ['Key_5'],
    ['Key_6'],
    ['Key_7'],
    ['Key_8'],
    ['Key_9'],
    ['Key_0'],
    ['Key_Minus'],
    ['Key_Equals'],
    ['Key_Backspace', 2],
  ],
  [
    ['Key_Tab', 1.5],
    ['Key_Q'],
    ['Key_W'],
    ['Key_E'],
    ['Key_R'],
    ['Key_T'],
    ['Key_Y'],
    ['Key_U'],
    ['Key_I'],
    ['Key_O'],
    ['Key_P'],
    ['Key_LeftBracket'],
    ['Key_RightBracket'],
    ['Key_BackSlash', 1.5],
  ],
  [
    ['Key_CapsLock', 1.75],
    ['Key_A'],
    ['Key_S'],
    ['Key_D'],
    ['Key_F'],
    ['Key_G'],
    ['Key_H'],
    ['Key_J'],
    ['Key_K'],
    ['Key_L'],
    ['Key_SemiColon'],
    ['Key_Apostrophe'],
    ['Key_Enter', 2.25],
  ],
  [
    ['Key_LeftShift', 2.25],
    ['Key_Z'],
    ['Key_X'],
    ['Key_C'],
    ['Key_V'],
    ['Key_B'],
    ['Key_N'],
    ['Key_M'],
    ['Key_Comma'],
    ['Key_Period'],
    ['Key_Slash'],
    ['Key_RightShift', 2.75],
  ],
  [
    ['Key_LeftControl', 1.25],
    ['Key_LeftWin', 1.25],
    ['Key_LeftAlt', 1.25],
    ['Key_Space', 6.25],
    ['Key_RightAlt', 1.25],
    ['Key_RightWin', 1.25],
    ['Key_Apps', 1.25],
    ['Key_RightControl', 1.25],
  ],
];

/** Total width in units: 15 main + 0.25 gap + 3 nav + 0.25 gap + 4 numpad. */
export const KEYBOARD_WIDTH_U = 22.5;
/** Total height in units: function row + 0.2 gap + 5 rows. */
export const KEYBOARD_HEIGHT_U = 6.2;
/** Top of the first main row. */
const MAIN_Y = 1.2;

const NAV_X = 15.25;
const PAD_X = 18.5;

const CAPS: Record<string, string> = {
  Key_SYSRQ: 'PrtSc',
  Key_ScrollLock: 'Scroll Lock',
  Key_NumLock: 'Num Lock',
  Key_Backspace: 'Backspace',
  Key_LeftWin: 'Win',
  Key_RightWin: 'Win',
  Key_LeftControl: 'Ctrl',
  Key_RightControl: 'Ctrl',
  Key_LeftAlt: 'Alt',
  Key_RightAlt: 'Alt Gr',
  Key_LeftShift: 'Shift',
  Key_RightShift: 'Shift',
  Key_Apps: 'Menu',
  Key_Numpad_0: '0',
  Key_Numpad_1: '1',
  Key_Numpad_2: '2',
  Key_Numpad_3: '3',
  Key_Numpad_4: '4',
  Key_Numpad_5: '5',
  Key_Numpad_6: '6',
  Key_Numpad_7: '7',
  Key_Numpad_8: '8',
  Key_Numpad_9: '9',
  Key_Numpad_Divide: '/',
  Key_Numpad_Multiply: '*',
  Key_Numpad_Subtract: '-',
  Key_Numpad_Add: '+',
  Key_Numpad_Enter: 'Enter',
  Key_Numpad_Decimal: '.',
};

export function keyboardLayout(iso = false): KeyCap[] {
  const caps: KeyCap[] = [];
  const row = (items: RowItem[], y: number, x0 = 0) => {
    let x = x0;
    for (const it of items) {
      if (typeof it === 'number') {
        x += it;
        continue;
      }
      const [key, w = 1] = it;
      caps.push({ key, x, y, w, h: 1 });
      x += w;
    }
  };
  row(F_ROW, 0);
  MAIN_ROWS.forEach((r, i) => {
    if (iso && i === 3) {
      row([['Key_LeftShift', 1.25], ['Key_OEM_102'], ...r.slice(1)], MAIN_Y + i);
    } else row(r, MAIN_Y + i);
  });
  row([['Key_SYSRQ'], ['Key_ScrollLock'], ['Key_Pause']], 0, NAV_X);
  row([['Key_Insert'], ['Key_Home'], ['Key_PageUp']], MAIN_Y, NAV_X);
  row([['Key_Delete'], ['Key_End'], ['Key_PageDown']], MAIN_Y + 1, NAV_X);
  row([['Key_UpArrow']], MAIN_Y + 3, NAV_X + 1);
  row([['Key_LeftArrow'], ['Key_DownArrow'], ['Key_RightArrow']], MAIN_Y + 4, NAV_X);
  row([['Key_NumLock'], ['Key_Numpad_Divide'], ['Key_Numpad_Multiply'], ['Key_Numpad_Subtract']], MAIN_Y, PAD_X);
  row([['Key_Numpad_7'], ['Key_Numpad_8'], ['Key_Numpad_9']], MAIN_Y + 1, PAD_X);
  row([['Key_Numpad_4'], ['Key_Numpad_5'], ['Key_Numpad_6']], MAIN_Y + 2, PAD_X);
  row([['Key_Numpad_1'], ['Key_Numpad_2'], ['Key_Numpad_3']], MAIN_Y + 3, PAD_X);
  row([['Key_Numpad_0', 2], ['Key_Numpad_Decimal']], MAIN_Y + 4, PAD_X);
  caps.push({ key: 'Key_Numpad_Add', x: PAD_X + 3, y: MAIN_Y + 1, w: 1, h: 2 });
  caps.push({ key: 'Key_Numpad_Enter', x: PAD_X + 3, y: MAIN_Y + 3, w: 1, h: 2 });
  for (const c of caps) {
    if (CAPS[c.key]) c.cap = CAPS[c.key];
    if (c.key === 'Key_Numpad_Decimal') c.aliases = ['Key_Numpad_Period'];
  }
  return caps;
}
