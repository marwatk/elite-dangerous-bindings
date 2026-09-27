import { readFileSync } from 'node:fs';
import { allMappedKeys, eliteKeyForEvent } from './keyboard-map';

const known = new Set(
  (JSON.parse(readFileSync('public/data/keys.json', 'utf-8')) as { key: string }[]).map((k) => k.key),
);
const ev = (code: string, key = '') => ({ code, key });

describe('keyboard-map', () => {
  it('only produces key names the game knows', () => {
    const unknown = allMappedKeys().filter((k) => !known.has(k));
    expect(unknown).toEqual([]);
  });

  it('maps physical keys for en-US', () => {
    const cases: [string, string][] = [
      ['KeyA', 'Key_A'],
      ['Digit0', 'Key_0'],
      ['F13', 'Key_F13'],
      ['ArrowUp', 'Key_UpArrow'],
      ['Semicolon', 'Key_SemiColon'],
      ['Quote', 'Key_Apostrophe'],
      ['Backslash', 'Key_BackSlash'],
      ['Backquote', 'Key_Grave'],
      ['Equal', 'Key_Equals'],
      ['BracketLeft', 'Key_LeftBracket'],
      ['IntlBackslash', 'Key_OEM_102'],
      ['ShiftLeft', 'Key_LeftShift'],
      ['ControlRight', 'Key_RightControl'],
      ['AltRight', 'Key_RightAlt'],
      ['MetaLeft', 'Key_LeftWin'],
      ['Numpad7', 'Key_Numpad_7'],
      ['NumpadEnter', 'Key_Numpad_Enter'],
      ['NumpadAdd', 'Key_Numpad_Add'],
      ['NumpadDecimal', 'Key_Numpad_Decimal'],
      ['PageDown', 'Key_PageDown'],
      ['Escape', 'Key_Escape'],
    ];
    for (const [code, key] of cases) expect(eliteKeyForEvent(ev(code), 'en-US', known)).toBe(key);
    expect(eliteKeyForEvent(ev('Fn'), 'en-US', known)).toBeNull();
  });

  it('names keys by character on other layouts', () => {
    expect(eliteKeyForEvent(ev('KeyY', 'z'), 'de-DE', known)).toBe('Key_Z');
    expect(eliteKeyForEvent(ev('Semicolon', 'ö'), 'de-DE', known)).toBe('Key_ö');
    expect(eliteKeyForEvent(ev('Semicolon', 'Ö'), 'de-DE', known)).toBe('Key_ö');
    expect(eliteKeyForEvent(ev('Backslash', '#'), 'de-DE', known)).toBe('Key_Hash');
    expect(eliteKeyForEvent(ev('IntlBackslash', '<'), 'de-DE', known)).toBe('Key_LessThan');
    expect(eliteKeyForEvent(ev('Backquote', 'Dead'), 'de-DE', known)).toBe('Key_Circumflex');
    // Layout-independent keys keep their physical name.
    expect(eliteKeyForEvent(ev('Digit1', '&'), 'fr-FR', known)).toBe('Key_1');
    expect(eliteKeyForEvent(ev('Numpad1', 'End'), 'de-DE', known)).toBe('Key_Numpad_1');
    expect(eliteKeyForEvent(ev('ShiftLeft', 'Shift'), 'de-DE', known)).toBe('Key_LeftShift');
    // Unknown characters fall back to the physical key.
    expect(eliteKeyForEvent(ev('BracketLeft', 'è'), 'it-IT', known)).toBe('Key_LeftBracket');
  });
});
