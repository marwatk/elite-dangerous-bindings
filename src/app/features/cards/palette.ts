/**
 * Card colour palettes. Based on EDRefCard's groupStyles / categoryStyles /
 * ModifierStyles, darkened where needed so every colour has at least ~4.5:1
 * contrast on the white card artwork (and survives greyscale printing).
 */

export type ColourScheme = 'modifier' | 'category' | 'group' | 'none';

export const COLOUR_SCHEMES: { value: ColourScheme; label: string }[] = [
  { value: 'modifier', label: 'By modifier' },
  { value: 'category', label: 'By type' },
  { value: 'group', label: 'By group' },
  { value: 'none', label: 'No colours' },
];

/** Card groups in display order: `value` is ActionInfo.group. */
export const CARD_GROUPS: { value: string; label: string }[] = [
  { value: 'Ship', label: 'Ship' },
  { value: 'SRV', label: 'SRV' },
  { value: 'Scanners', label: 'Scanners' },
  { value: 'Fighter', label: 'Fighter' },
  { value: 'OnFoot', label: 'On Foot' },
  { value: 'Multicrew', label: 'Multicrew' },
  { value: 'Head look', label: 'Head Look' },
  { value: 'UI', label: 'UI' },
  { value: 'Galaxy map', label: 'Galaxy Map' },
  { value: 'Camera', label: 'Camera' },
  { value: 'Holo-Me', label: 'Holo-Me' },
  { value: 'Misc', label: 'Miscellaneous' },
];

export const INK = '#111111';
export const MUTED_INK = '#6b6b6b';

export const GROUP_COLOURS: Record<string, string> = {
  Ship: '#c8102e', // Crimson
  SRV: '#6a3fb5', // MediumPurple, darkened
  Scanners: '#8e24aa', // DarkOrchid
  Fighter: '#483d8b', // DarkSlateBlue
  OnFoot: '#1f5fbf', // CornflowerBlue, darkened
  Multicrew: '#2f6690', // SteelBlue, darkened
  'Head look': '#a33a3a', // IndianRed, darkened
  UI: '#b45309', // DarkOrange, darkened
  'Galaxy map': '#1b7a1b', // ForestGreen
  Camera: '#556b2f', // OliveDrab, darkened
  'Holo-Me': '#8b4513', // Sienna
  Misc: INK,
};

export const CATEGORY_COLOURS: Record<string, string> = {
  General: '#483d8b', // DarkSlateBlue
  Combat: '#c8102e', // Crimson
  Social: '#1b7a1b', // ForestGreen
  Navigation: INK,
  UI: '#b45309', // DarkOrange, darkened
  Camera: '#556b2f', // OliveDrab, darkened
};

export const CATEGORY_ORDER = ['General', 'Combat', 'Social', 'Navigation', 'UI', 'Camera'];

/** Index 0 = unmodified. */
export const MODIFIER_COLOURS = [
  INK,
  '#c8102e', // Crimson
  '#1b7a1b', // ForestGreen
  '#483d8b', // DarkSlateBlue
  '#b45309', // DarkOrange
  '#8e24aa', // DarkOrchid
  '#2f6690', // SteelBlue
  '#8b4513', // Sienna
  '#a33a3a', // IndianRed
  '#1f5fbf', // CornflowerBlue
  '#556b2f', // OliveDrab
  '#6a3fb5', // MediumPurple
  '#b5523b', // DarkSalmon
  '#5a6878', // LightSlateGray
];

export function modifierColour(n: number): string {
  return MODIFIER_COLOURS[((n % MODIFIER_COLOURS.length) + MODIFIER_COLOURS.length) % MODIFIER_COLOURS.length];
}

export function groupLabel(group: string): string {
  return CARD_GROUPS.find((g) => g.value === group)?.label ?? group;
}

export interface ColourSubject {
  kind: 'action' | 'modifier';
  group: string;
  category: string;
  modifier: number;
}

export function colourFor(e: ColourSubject, scheme: ColourScheme): string {
  switch (scheme) {
    case 'modifier':
      return modifierColour(e.modifier);
    case 'category':
      return e.kind === 'modifier' ? INK : (CATEGORY_COLOURS[e.category] ?? INK);
    case 'group':
      return e.kind === 'modifier' ? INK : (GROUP_COLOURS[e.group] ?? INK);
    default:
      return INK;
  }
}
