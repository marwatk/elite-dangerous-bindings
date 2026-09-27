/**
 * KeyboardEvent.code -> Elite `Key_*` names (checked against
 * public/data/keys.json and real .binds files).
 *
 * Layout: `code` is the physical key position, named after the US layout,
 * which is exactly what Elite writes for an en-US `<KeyboardLayout>`. On
 * other layouts Elite names keys by the character they produce (`Key_ä`,
 * `Key_Hash`, `Key_LessThan`, and `Key_Z` for the key labelled Z on a German
 * keyboard). For those files we use `event.key` for letters and punctuation
 * when it maps to a known Elite name, and fall back to the physical code.
 * Digits, numpad, function and modifier keys always use the physical code.
 */

const CODE_TO_KEY: Record<string, string> = {
  Escape: 'Key_Escape',
  Tab: 'Key_Tab',
  CapsLock: 'Key_CapsLock',
  Space: 'Key_Space',
  Enter: 'Key_Enter',
  Backspace: 'Key_Backspace',
  Insert: 'Key_Insert',
  Delete: 'Key_Delete',
  Home: 'Key_Home',
  End: 'Key_End',
  PageUp: 'Key_PageUp',
  PageDown: 'Key_PageDown',
  ArrowUp: 'Key_UpArrow',
  ArrowDown: 'Key_DownArrow',
  ArrowLeft: 'Key_LeftArrow',
  ArrowRight: 'Key_RightArrow',
  Minus: 'Key_Minus',
  Equal: 'Key_Equals',
  BracketLeft: 'Key_LeftBracket',
  BracketRight: 'Key_RightBracket',
  Backslash: 'Key_BackSlash',
  Semicolon: 'Key_SemiColon',
  Quote: 'Key_Apostrophe',
  Backquote: 'Key_Grave',
  Comma: 'Key_Comma',
  Period: 'Key_Period',
  Slash: 'Key_Slash',
  IntlBackslash: 'Key_OEM_102',
  IntlRo: 'Key_ABNT_C1',
  IntlYen: 'Key_Yen',
  KanaMode: 'Key_Kana',
  Convert: 'Key_Convert',
  NonConvert: 'Key_NoConvert',
  Lang2: 'Key_Kanji',
  ShiftLeft: 'Key_LeftShift',
  ShiftRight: 'Key_RightShift',
  ControlLeft: 'Key_LeftControl',
  ControlRight: 'Key_RightControl',
  AltLeft: 'Key_LeftAlt',
  AltRight: 'Key_RightAlt',
  MetaLeft: 'Key_LeftWin',
  MetaRight: 'Key_RightWin',
  OSLeft: 'Key_LeftWin',
  OSRight: 'Key_RightWin',
  ContextMenu: 'Key_Apps',
  NumLock: 'Key_NumLock',
  ScrollLock: 'Key_ScrollLock',
  Pause: 'Key_Pause',
  PrintScreen: 'Key_SYSRQ',
  NumpadAdd: 'Key_Numpad_Add',
  NumpadSubtract: 'Key_Numpad_Subtract',
  NumpadMultiply: 'Key_Numpad_Multiply',
  NumpadDivide: 'Key_Numpad_Divide',
  NumpadDecimal: 'Key_Numpad_Decimal',
  NumpadComma: 'Key_Numpad_Comma',
  NumpadEnter: 'Key_Numpad_Enter',
  NumpadEqual: 'Key_Numpad_Equals',
  AudioVolumeMute: 'Key_Mute',
  AudioVolumeDown: 'Key_VolumeDown',
  AudioVolumeUp: 'Key_VolumeUp',
  MediaTrackNext: 'Key_NextTrack',
  MediaTrackPrevious: 'Key_PrevTrack',
  MediaStop: 'Key_MediaStop',
  MediaPlayPause: 'Key_PlayPause',
  MediaSelect: 'Key_MediaSelect',
  LaunchMail: 'Key_Mail',
  LaunchApp1: 'Key_MyComputer',
  LaunchApp2: 'Key_Calculator',
  BrowserBack: 'Key_WebBack',
  BrowserForward: 'Key_WebForward',
  BrowserRefresh: 'Key_WebRefresh',
  BrowserStop: 'Key_WebStop',
  BrowserSearch: 'Key_WebSearch',
  BrowserFavorites: 'Key_WebFavourites',
  BrowserHome: 'Key_WebHome',
  Sleep: 'Key_Sleep',
  Power: 'Key_Power',
  WakeUp: 'Key_Wake',
};
for (let c = 65; c <= 90; c++) CODE_TO_KEY[`Key${String.fromCharCode(c)}`] = `Key_${String.fromCharCode(c)}`;
for (let d = 0; d <= 9; d++) {
  CODE_TO_KEY[`Digit${d}`] = `Key_${d}`;
  CODE_TO_KEY[`Numpad${d}`] = `Key_Numpad_${d}`;
}
for (let f = 1; f <= 24; f++) CODE_TO_KEY[`F${f}`] = `Key_F${f}`;

/** Character (event.key) -> Elite name, for non-US layouts. */
const CHAR_TO_KEY: Record<string, string> = {
  '-': 'Key_Minus',
  '=': 'Key_Equals',
  '[': 'Key_LeftBracket',
  ']': 'Key_RightBracket',
  '\\': 'Key_BackSlash',
  ';': 'Key_SemiColon',
  "'": 'Key_Apostrophe',
  '`': 'Key_Grave',
  ',': 'Key_Comma',
  '.': 'Key_Period',
  '/': 'Key_Slash',
  '+': 'Key_Plus',
  '#': 'Key_Hash',
  '<': 'Key_LessThan',
  '>': 'Key_GreaterThan',
  ':': 'Key_Colon',
  _: 'Key_Underline',
  '(': 'Key_LeftParenthesis',
  ')': 'Key_RightParenthesis',
  '@': 'Key_AT',
  '^': 'Key_Circumflex',
  '´': 'Key_Acute',
  ä: 'Key_ä',
  ö: 'Key_ö',
  ü: 'Key_ü',
  ß: 'Key_ß',
};

/** Dead keys give `event.key === 'Dead'`; these are the usual ones on German-style layouts. */
const DEAD_KEYS: Record<string, string> = {
  Backquote: 'Key_Circumflex',
  Equal: 'Key_Acute',
};

/** Keys whose physical position never depends on the layout. */
const LAYOUT_INDEPENDENT = /^(Digit|Numpad|F\d|Arrow|Shift|Control|Alt|Meta|OS)|^(Escape|Tab|CapsLock|Space|Enter|Backspace|Insert|Delete|Home|End|PageUp|PageDown|NumLock|ScrollLock|Pause|PrintScreen|ContextMenu)$/;

export function isUsLayout(layout: string | null | undefined): boolean {
  return !layout || /^en-us$/i.test(layout.trim());
}

/**
 * Elite key name for a keyboard event, or null for keys Elite can't bind.
 * `layout` is the file's `<KeyboardLayout>` (e.g. `en-US`, `de-DE`).
 */
export function eliteKeyForEvent(
  ev: Pick<KeyboardEvent, 'code' | 'key'>,
  layout?: string | null,
  known?: ReadonlySet<string>,
): string | null {
  const byCode = CODE_TO_KEY[ev.code] ?? null;
  if (isUsLayout(layout) || LAYOUT_INDEPENDENT.test(ev.code)) return byCode;
  const ok = (k: string | undefined) => !!k && (!known || known.has(k));
  const ch = ev.key ?? '';
  if (ch === 'Dead' && ok(DEAD_KEYS[ev.code])) return DEAD_KEYS[ev.code];
  if (ch.length === 1) {
    if (/^[a-z]$/i.test(ch)) return `Key_${ch.toUpperCase()}`;
    const lower = ch.toLowerCase();
    if (ok(CHAR_TO_KEY[lower])) return CHAR_TO_KEY[lower];
    if (ok(CHAR_TO_KEY[ch])) return CHAR_TO_KEY[ch];
  }
  return byCode;
}

/** Elite name for a physical key code (US naming), or null. */
export function eliteKeyForCode(code: string): string | null {
  return CODE_TO_KEY[code] ?? null;
}

export function allMappedKeys(): string[] {
  return [...new Set(Object.values(CODE_TO_KEY))];
}
