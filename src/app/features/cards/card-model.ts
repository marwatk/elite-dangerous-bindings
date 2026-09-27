/**
 * Pure card model: which reference cards to draw for a bindings file and what
 * text goes in each control box. Mirrors EDRefCard's parseBindings /
 * createHOTASImage logic (device choice, modifier numbering, redundant
 * specialisations) but works on the app's parsed document and device JSON.
 */
import { ActionState, InputRef, SlotBinding, SlotName, isBound } from '../../core/binds/binds-document';
import { ActionInfo, Box, DeviceDefinition, DeviceSummary } from '../../core/data/catalog.types';

export interface CardOptions {
  /** ActionInfo.group values to show. */
  groups: ReadonlySet<string>;
  /** Use ActionInfo.short when present. */
  compact: boolean;
}

/** One line item in a control box. */
export interface CardEntry {
  kind: 'action' | 'modifier';
  /** Final text, e.g. "Boost", "Boost[2]", "Landing Gear (hold)", "Modifier 2". */
  text: string;
  /** Action code (kind 'action'). */
  code?: string;
  group: string;
  category: string;
  /** Modifier number: 0 = unmodified; for kind 'modifier' the modifier it activates. */
  modifier: number;
  hold: boolean;
  order: number;
}

export interface ModifierInfo {
  number: number;
  /** The keys that must be held (more than one for composite modifiers). */
  keys: InputRef[];
}

/** A control box on a device card and everything drawn in it. */
export interface CardSpot {
  box: Box;
  image: number;
  /** Elite control keys that share this box (axis and its halves). */
  controls: string[];
  entries: CardEntry[];
}

export interface DeviceCard {
  kind: 'device';
  /** `deviceId::deviceIndex` */
  id: string;
  deviceId: string;
  deviceIndex: number;
  name: string;
  /** `bindsId::index` keys this card draws. */
  covers: string[];
  spots: CardSpot[];
}

export interface KeyboardRow {
  entry: CardEntry;
  key: string;
  modifiers: InputRef[];
}

export interface KeyboardCard {
  kind: 'keyboard';
  id: 'Keyboard';
  name: string;
  /** Elite key name -> entries. */
  keys: Map<string, CardEntry[]>;
  /** One row per keyboard binding, for the list style. */
  rows: KeyboardRow[];
}

export type Card = DeviceCard | KeyboardCard;

export type UnplacedReason = 'mouse' | 'unsupported' | 'no-artwork' | 'no-box';

export interface UnplacedInput {
  device: string;
  deviceIndex: number;
  key: string;
  reason: UnplacedReason;
  entries: CardEntry[];
}

export interface CardSet {
  cards: Card[];
  modifiers: ModifierInfo[];
  /** Bindings that are not drawn on any card. */
  unplaced: UnplacedInput[];
}

export interface CardChoice {
  deviceId: string;
  deviceIndex: number;
  covers: string[];
}

export interface CardInputs {
  actions: readonly ActionState[];
  meta: (code: string) => ActionInfo;
  /** All known devices, in catalogue order (catalog.devices()). */
  devices: readonly DeviceSummary[];
  /** Loaded full definitions by device ID. */
  definition: (id: string) => DeviceDefinition | undefined;
  /** The catalogue's preferred device for an ID (catalog.deviceFor), used to break ties. */
  preferred?: (bindsId: string, deviceIndex: number) => DeviceSummary | undefined;
  options: CardOptions;
}

type Ref = { device: string; deviceIndex: number; key: string };

// ------------------------------------------------------------ device aliases

export interface AliasContext {
  hasT16000MThrottle: boolean;
  vpc97SplitMode: boolean;
  vpc0197SplitMode: boolean;
}

/** Facts about the whole file that change how devices are mapped (EDRefCard rewrites). */
export function aliasContext(refs: readonly { device: string; deviceIndex?: number }[]): AliasContext {
  const has = (d: string) => refs.some((r) => r.device === d);
  const anyIndex = (i: number) => refs.some((r) => (r.deviceIndex ?? 0) === i);
  return {
    hasT16000MThrottle: has('T16000MTHROTTLE'),
    vpc97SplitMode: has('33448197') && anyIndex(2),
    vpc0197SplitMode: has('33440197') && anyIndex(1),
  };
}

/**
 * Rewrites EDRefCard applies before choosing a card: a T16000M stick paired
 * with the TFRP throttle uses the combined FCS card; VPC MongoosT-50CM3
 * throttles in 32-button mode report as several devices.
 */
export function aliasRef<T extends { device: string; deviceIndex?: number }>(r: T, ctx: AliasContext): T {
  const idx = r.deviceIndex ?? 0;
  const out = (device: string, deviceIndex: number): T => ({ ...r, device, deviceIndex });
  if (r.device === 'T16000M' && ctx.hasT16000MThrottle) return out('T16000MFCS', idx);
  if (r.device === '33448197' && ctx.vpc97SplitMode) return out(`VPC-MongoosT-50CM3-Throttle-32B${idx}`, 0);
  if (r.device === '33448198') return out(`VPC-MongoosT-50CM3-Throttle-32B-NS${idx}`, 0);
  if (r.device === '33440197' && ctx.vpc0197SplitMode) {
    return out(`VPC-MongoosT-50CM3-Throttle-32B${idx === 0 ? 1 : idx === 1 ? 0 : idx}`, 0);
  }
  return r;
}

// ------------------------------------------------------------ card choice

const BUILTIN = new Set(['Keyboard', 'Mouse']);

/**
 * Choose device cards for the used devices (`bindsId::index` keys), like
 * EDRefCard: a card is a candidate when one of its key devices is used; the
 * cards covering the most used devices win, one card per definition per index.
 * Devices without artwork are never chosen.
 */
export function chooseCards(
  used: readonly { device: string; deviceIndex: number }[],
  devices: readonly DeviceSummary[],
  preferred?: (bindsId: string, deviceIndex: number) => DeviceSummary | undefined,
): CardChoice[] {
  const usedSet = new Set(used.filter((u) => !BUILTIN.has(u.device)).map((u) => `${u.device}::${u.deviceIndex}`));
  if (usedSet.size === 0) return [];
  const indices = [...new Set(used.map((u) => u.deviceIndex))].sort((a, b) => a - b);

  interface Candidate extends CardChoice {
    order: number;
    preferred: boolean;
  }
  const candidates: Candidate[] = [];
  devices.forEach((d, order) => {
    if (!d.images.length) return;
    for (const idx of indices) {
      const handled = d.ids.filter((e) => e.deviceIndex === undefined || e.deviceIndex === idx);
      const keyIds = d.keyBindsIds ? handled.filter((e) => d.keyBindsIds!.includes(e.bindsId)) : handled;
      if (!keyIds.some((e) => usedSet.has(`${e.bindsId}::${idx}`))) continue;
      const covers = [...new Set(handled.map((e) => `${e.bindsId}::${idx}`))].filter((k) => usedSet.has(k));
      const isPreferred = covers.some((k) => {
        const [bindsId] = k.split('::');
        return preferred?.(bindsId, idx)?.id === d.id;
      });
      candidates.push({ deviceId: d.id, deviceIndex: idx, covers, order, preferred: isPreferred });
    }
  });
  candidates.sort(
    (a, b) =>
      b.covers.length - a.covers.length ||
      Number(b.preferred) - Number(a.preferred) ||
      a.deviceIndex - b.deviceIndex ||
      a.order - b.order,
  );
  const covered = new Set<string>();
  const chosen: Candidate[] = [];
  for (const c of candidates) {
    if (c.covers.every((k) => covered.has(k))) continue;
    c.covers.forEach((k) => covered.add(k));
    chosen.push(c);
  }
  chosen.sort((a, b) => a.deviceIndex - b.deviceIndex || a.order - b.order);
  return chosen.map(({ deviceId, deviceIndex, covers }) => ({ deviceId, deviceIndex, covers }));
}

/** Aliased device refs used by the document (bound slots and modifiers). */
export function usedDevices(actions: readonly ActionState[]): { device: string; deviceIndex: number }[] {
  const refs: InputRef[] = [];
  for (const a of actions) {
    for (const s of Object.values(a.slots)) {
      if (s && isBound(s)) {
        refs.push(s);
        s.modifiers.filter(isBound).forEach((m) => refs.push(m));
      }
    }
  }
  const ctx = aliasContext(refs);
  const seen = new Map<string, { device: string; deviceIndex: number }>();
  for (const r of refs) {
    const a = aliasRef(r, ctx);
    const k = `${a.device}::${a.deviceIndex ?? 0}`;
    if (!seen.has(k)) seen.set(k, { device: a.device, deviceIndex: a.deviceIndex ?? 0 });
  }
  return [...seen.values()];
}

// ------------------------------------------------------------ uses

interface Use {
  code: string;
  info: ActionInfo;
  fileOrder: number;
  ref: Ref;
  baseKey: string;
  modifiers: Ref[];
  modSig: string;
  hold: boolean;
}

export function baseKey(key: string): string {
  return key.replace(/^(Pos|Neg)_/, '');
}

function refOf(r: InputRef): Ref {
  return { device: r.device, deviceIndex: r.deviceIndex ?? 0, key: r.key };
}

function refId(r: Ref): string {
  return `${r.device}::${r.deviceIndex}::${r.key}`;
}

/** Bound slots in the selected groups, with redundant specialisations removed. */
export function collectUses(
  actions: readonly ActionState[],
  meta: (code: string) => ActionInfo,
  groups: ReadonlySet<string>,
): Use[] {
  const allRefs: InputRef[] = [];
  for (const a of actions) for (const s of Object.values(a.slots)) if (s && isBound(s)) allRefs.push(s, ...s.modifiers);
  const ctx = aliasContext(allRefs);

  const uses: Use[] = [];
  const seen = new Set<string>();
  actions.forEach((a, fileOrder) => {
    const info = meta(a.code);
    if (!groups.has(info.group)) return;
    for (const slot of ['Primary', 'Secondary', 'Binding'] as SlotName[]) {
      const b: SlotBinding | null | undefined = a.slots[slot];
      if (!b || !isBound(b)) continue;
      const ref = refOf(aliasRef(b, ctx));
      const modifiers = b.modifiers
        .filter(isBound)
        .map((m) => refOf(aliasRef(m, ctx)))
        .sort((x, y) => refId(x).localeCompare(refId(y)));
      const modSig = modifiers.map(refId).join('+');
      const bk = baseKey(ref.key);
      const dedupe = `${a.code}|${ref.device}::${ref.deviceIndex}::${bk}|${modSig}|${b.hold}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      uses.push({ code: a.code, info, fileOrder, ref, baseKey: bk, modifiers, modSig, hold: b.hold });
    }
  });

  // Drop redundant specialisations: X is hidden when bound to the same input
  // and modifiers as one of X.hideIfSameAs (EDRefCard isRedundantSpecialisation).
  const buckets = new Map<string, Set<string>>();
  const bucketOf = (u: Use) => `${u.ref.device}::${u.ref.deviceIndex}::${u.baseKey}|${u.modSig}|${u.hold}`;
  for (const u of uses) {
    const k = bucketOf(u);
    (buckets.get(k) ?? buckets.set(k, new Set()).get(k)!).add(u.code);
  }
  return uses.filter((u) => !(u.info.hideIfSameAs ?? []).some((c) => buckets.get(bucketOf(u))!.has(c)));
}

/** Number each distinct modifier combination in order of first use (EDRefCard style). */
export function numberModifiers(uses: readonly Pick<Use, 'modSig' | 'modifiers'>[]): ModifierInfo[] {
  const out: ModifierInfo[] = [];
  const bySig = new Map<string, ModifierInfo>();
  for (const u of uses) {
    if (!u.modSig || bySig.has(u.modSig)) continue;
    const info: ModifierInfo = {
      number: out.length + 1,
      keys: u.modifiers.map((m) => ({ device: m.device, key: m.key, ...(m.deviceIndex ? { deviceIndex: m.deviceIndex } : {}) })),
    };
    bySig.set(u.modSig, info);
    out.push(info);
  }
  return out;
}

export function modifierSig(keys: readonly InputRef[]): string {
  return keys
    .map(refOf)
    .map(refId)
    .sort((a, b) => a.localeCompare(b))
    .join('+');
}

// ------------------------------------------------------------ build

function entryText(info: ActionInfo, compact: boolean, modifier: number, hold: boolean): string {
  const name = compact ? (info.short ?? info.name) : info.name;
  return `${name}${modifier ? `[${modifier}]` : ''}${hold ? (compact ? ' (H)' : ' (hold)') : ''}`;
}

function modifierEntry(n: number, compact: boolean): CardEntry {
  return {
    kind: 'modifier',
    text: compact ? `Mod ${n}` : `Modifier ${n}`,
    group: 'Modifier',
    category: 'Modifier',
    modifier: n,
    hold: false,
    order: -1,
  };
}

export function sortEntries(entries: CardEntry[]): CardEntry[] {
  const rank = (e: CardEntry) => (e.kind === 'modifier' ? 0 : e.modifier === 0 ? 1 : 2);
  return entries.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (rank(a) === 1 ? 0 : a.modifier - b.modifier) ||
      a.order - b.order ||
      a.text.localeCompare(b.text),
  );
}

function addUnique(list: CardEntry[], e: CardEntry): void {
  if (!list.some((x) => x.text === e.text && x.kind === e.kind && x.modifier === e.modifier)) list.push(e);
}

/** Find the control box for a key on a card, falling back from an axis half to its axis. */
export function findControl(def: DeviceDefinition, cardIndex: number, device: string, deviceIndex: number, key: string) {
  const match = (k: string) =>
    def.controls.find(
      (c) => c.box && c.bindsId === device && c.key === k && (c.deviceIndex ?? cardIndex) === deviceIndex,
    );
  return match(key) ?? match(baseKey(key));
}

export function buildCards(input: CardInputs, choices?: CardChoice[]): CardSet {
  const { actions, meta, devices, definition, options } = input;
  const picked = choices ?? chooseCards(usedDevices(actions), devices, input.preferred);
  const uses = collectUses(actions, meta, options.groups);
  const modifiers = numberModifiers(uses);
  const modNumber = new Map(modifiers.map((m) => [modifierSig(m.keys), m.number]));
  const deviceSummary = new Map(devices.map((d) => [d.id, d]));

  const deviceCards: (DeviceCard & { spotMap: Map<string, CardSpot>; def?: DeviceDefinition })[] = picked.map((c) => ({
    kind: 'device',
    id: `${c.deviceId}::${c.deviceIndex}`,
    deviceId: c.deviceId,
    deviceIndex: c.deviceIndex,
    name: (deviceSummary.get(c.deviceId)?.name ?? c.deviceId) + (c.deviceIndex > 0 ? ` #${c.deviceIndex + 1}` : ''),
    covers: c.covers,
    spots: [],
    spotMap: new Map(),
    def: definition(c.deviceId),
  }));
  const keyboard: KeyboardCard = { kind: 'keyboard', id: 'Keyboard', name: 'Keyboard', keys: new Map(), rows: [] };
  let keyboardUsed = actions.some((a) =>
    Object.values(a.slots).some((s) => s && isBound(s) && (s.device === 'Keyboard' || s.modifiers.some((m) => m.device === 'Keyboard'))),
  );
  const unplaced = new Map<string, UnplacedInput>();

  const cardsFor = (r: Ref) => deviceCards.filter((c) => c.covers.includes(`${r.device}::${r.deviceIndex}`));

  /** Place an entry at an input; returns false when it has no box anywhere. */
  const place = (r: Ref, e: CardEntry): UnplacedReason | null => {
    if (r.device === 'Keyboard') {
      const list = keyboard.keys.get(r.key) ?? [];
      addUnique(list, e);
      keyboard.keys.set(r.key, list);
      return null;
    }
    if (r.device === 'Mouse') return 'mouse';
    const cards = cardsFor(r);
    if (!cards.length) {
      const known = devices.some((d) => d.ids.some((i) => i.bindsId === r.device));
      return known ? 'no-artwork' : 'unsupported';
    }
    let placed = false;
    for (const card of cards) {
      if (!card.def) continue;
      const ctl = findControl(card.def, card.deviceIndex, r.device, r.deviceIndex, r.key);
      if (!ctl?.box) continue;
      const img = ctl.image ?? 0;
      const k = `${img}:${ctl.box.x},${ctl.box.y},${ctl.box.w},${ctl.box.h}`;
      let spot = card.spotMap.get(k);
      if (!spot) {
        spot = { box: ctl.box, image: img, controls: [], entries: [] };
        card.spotMap.set(k, spot);
        card.spots.push(spot);
      }
      if (!spot.controls.includes(r.key)) spot.controls.push(r.key);
      addUnique(spot.entries, e);
      placed = true;
    }
    // Definitions still loading count as placed so nothing flickers into the list.
    return placed || cards.some((c) => !c.def) ? null : 'no-box';
  };

  for (const u of uses) {
    const n = u.modSig ? (modNumber.get(u.modSig) ?? 0) : 0;
    const e: CardEntry = {
      kind: 'action',
      text: entryText(u.info, options.compact, n, u.hold),
      code: u.code,
      group: u.info.group,
      category: u.info.category,
      modifier: n,
      hold: u.hold,
      order: u.info.order * 10_000 + u.fileOrder,
    };
    const reason = place(u.ref, e);
    if (reason) {
      const k = `${u.ref.device}::${u.ref.deviceIndex}::${u.ref.key}`;
      const item = unplaced.get(k) ?? { ...u.ref, reason, entries: [] };
      addUnique(item.entries, e);
      unplaced.set(k, item);
    }
    if (u.ref.device === 'Keyboard') keyboard.rows.push({ entry: e, key: u.ref.key, modifiers: u.modifiers });
  }

  // "Modifier N" on each key of each modifier combination.
  for (const m of modifiers) {
    for (const k of m.keys) {
      const r = refOf(k);
      if (r.device === 'Keyboard') keyboardUsed = true;
      place(r, modifierEntry(m.number, options.compact));
    }
  }

  for (const c of deviceCards) c.spots.forEach((s) => sortEntries(s.entries));
  for (const list of keyboard.keys.values()) sortEntries(list);
  keyboard.rows.sort((a, b) => a.entry.order - b.entry.order || a.entry.modifier - b.entry.modifier);

  const cards: Card[] = deviceCards.map(({ spotMap: _s, def: _d, ...card }) => card);
  if (keyboardUsed) cards.push(keyboard);
  const unplacedList = [...unplaced.values()].map((u) => ({ ...u, entries: sortEntries(u.entries) }));
  return { cards, modifiers, unplaced: unplacedList };
}

/** Modifier numbers referenced on a card (for its legend). */
export function modifiersOnCard(card: Card): Set<number> {
  const set = new Set<number>();
  const add = (list: CardEntry[]) => list.forEach((e) => e.modifier && set.add(e.modifier));
  if (card.kind === 'device') card.spots.forEach((s) => add(s.entries));
  else card.keys.forEach(add);
  return set;
}

/** Entries on a card, flattened. */
export function cardEntries(card: Card): CardEntry[] {
  return card.kind === 'device' ? card.spots.flatMap((s) => s.entries) : [...card.keys.values()].flat();
}

