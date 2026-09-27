import {
  XmlDocument,
  XmlElement,
  childElement,
  childElements,
  createElement,
  getAttr,
  insertChild,
  parseXml,
  removeAttr,
  removeChild,
  serializeXml,
  setAttr,
} from './xml';

/** Elite's value for an empty slot. */
export const NO_DEVICE = '{NoDevice}';

export type SlotName = 'Primary' | 'Secondary' | 'Binding';

/** One physical input: a key, button, hat direction or axis on a device. */
export interface InputRef {
  /** Elite device ID as written in the file: `Keyboard`, `231D0200`, `SaitekX56Joystick`... */
  device: string;
  /** Elite control name: `Key_A`, `Joy_3`, `Joy_POV1Up`, `Joy_XAxis`, `GamePad_FaceDown`... */
  key: string;
  /** Distinguishes identical devices; omitted means 0. */
  deviceIndex?: number;
}

export interface SlotBinding extends InputRef {
  modifiers: InputRef[];
  /** The `<Hold Value="1"/>` flag: only fires while held. */
  hold: boolean;
}

export type ActionKind = 'button' | 'axis';

export interface ActionState {
  code: string;
  kind: ActionKind;
  /** Button actions: Primary and Secondary. Axis actions: Binding. */
  slots: Partial<Record<SlotName, SlotBinding | null>>;
  toggleOn: boolean | null;
  inverted: boolean | null;
  deadzone: number | null;
}

export class BindsFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BindsFormatError';
  }
}

export function isBound(slot: SlotBinding | InputRef | null | undefined): boolean {
  return !!slot && slot.device !== NO_DEVICE && slot.device !== '' && slot.key !== '';
}

export function inputId(ref: InputRef): string {
  return `${ref.device}::${ref.deviceIndex ?? 0}::${ref.key}`;
}

export function sameInput(a: InputRef, b: InputRef): boolean {
  return a.device === b.device && (a.deviceIndex ?? 0) === (b.deviceIndex ?? 0) && a.key === b.key;
}

/** Elite writes floats with 8 decimals, e.g. `0.05000000`. */
export function formatFloat(n: number): string {
  return n.toFixed(8);
}

/**
 * A `.binds` file, edited in place. Unknown content is preserved and
 * `serialize()` on an unedited document returns the original text exactly.
 */
export class BindsDocument {
  private constructor(private readonly xml: XmlDocument) {}

  static parse(text: string): BindsDocument {
    const xml = parseXml(text);
    if (xml.root.name !== 'Root') {
      throw new BindsFormatError(`Not a bindings file: root element is <${xml.root.name}>, expected <Root>`);
    }
    return new BindsDocument(xml);
  }

  static async fromBlob(blob: Blob): Promise<BindsDocument> {
    const buf = await blob.arrayBuffer();
    return BindsDocument.parse(new TextDecoder('utf-8', { ignoreBOM: true }).decode(buf));
  }

  serialize(): string {
    return serializeXml(this.xml);
  }

  clone(): BindsDocument {
    return BindsDocument.parse(this.serialize());
  }

  // ------------------------------------------------------------ metadata

  get presetName(): string {
    return getAttr(this.xml.root, 'PresetName') ?? '';
  }

  set presetName(name: string) {
    setAttr(this.xml.root, 'PresetName', name);
  }

  get majorVersion(): number | null {
    const v = getAttr(this.xml.root, 'MajorVersion');
    return v === undefined ? null : Number(v);
  }

  get minorVersion(): number | null {
    const v = getAttr(this.xml.root, 'MinorVersion');
    return v === undefined ? null : Number(v);
  }

  setVersion(major: number, minor: number): void {
    setAttr(this.xml.root, 'MajorVersion', String(major), 'PresetName');
    setAttr(this.xml.root, 'MinorVersion', String(minor), 'MajorVersion');
  }

  /** File name the game expects, e.g. `Custom.4.2.binds`. */
  get fileName(): string {
    const v = this.majorVersion === null ? '' : `.${this.majorVersion}.${this.minorVersion ?? 0}`;
    return `${this.presetName || 'Custom'}${v}.binds`;
  }

  get keyboardLayout(): string | null {
    const el = childElement(this.xml.root, 'KeyboardLayout');
    if (!el) return null;
    return el.children.map((c) => (c.type === 'text' ? c.raw : '')).join('').trim();
  }

  // ------------------------------------------------------------ enumeration

  /** Codes of all root-level elements that hold bindings, in file order. */
  actionCodes(): string[] {
    return childElements(this.xml.root)
      .filter((el) => actionKindOf(el) !== null)
      .map((el) => el.name);
  }

  /** Codes of root-level `<X Value="..."/>` settings, in file order. */
  settingCodes(): string[] {
    return childElements(this.xml.root)
      .filter((el) => el.selfClosing && getAttr(el, 'Value') !== undefined)
      .map((el) => el.name);
  }

  hasAction(code: string): boolean {
    const el = childElement(this.xml.root, code);
    return !!el && actionKindOf(el) !== null;
  }

  actions(): ActionState[] {
    return childElements(this.xml.root)
      .map((el) => readAction(el))
      .filter((a): a is ActionState => a !== null);
  }

  getAction(code: string): ActionState | null {
    const el = childElement(this.xml.root, code);
    return el ? readAction(el) : null;
  }

  // ------------------------------------------------------------ settings

  getSetting(code: string): string | null {
    const el = childElement(this.xml.root, code);
    return el ? (getAttr(el, 'Value') ?? null) : null;
  }

  setSetting(code: string, value: string): void {
    const el = childElement(this.xml.root, code);
    if (el) {
      setAttr(el, 'Value', value);
    } else {
      insertChild(this.xml, this.xml.root, createElement(code, { Value: value }));
    }
  }

  // ------------------------------------------------------------ edits

  /**
   * Write one slot. `null` (or an unbound ref) clears it to `{NoDevice}` and
   * removes its modifiers and Hold flag. Other settings on the action, such as
   * Inverted and Deadzone, are left alone.
   */
  setSlot(code: string, slot: SlotName, binding: SlotBinding | null): void {
    const action = this.requireAction(code);
    let el = childElement(action, slot);
    if (!el) {
      el = createElement(slot, { Device: NO_DEVICE, Key: '' });
      // Primary before Secondary; Binding first.
      const order = slot === 'Secondary' ? (childElement(action, 'Primary') ? 1 : 0) : 0;
      insertChild(this.xml, action, el, order);
    }
    const bound = binding && isBound(binding);
    setAttr(el, 'Device', bound ? binding.device : NO_DEVICE);
    const idx = bound ? (binding.deviceIndex ?? 0) : 0;
    if (idx > 0) setAttr(el, 'DeviceIndex', String(idx), 'Device');
    else if (getAttr(el, 'DeviceIndex') !== undefined) {
      if (bound) setAttr(el, 'DeviceIndex', '0', 'Device');
      else removeAttr(el, 'DeviceIndex');
    }
    setAttr(el, 'Key', bound ? binding.key : '');

    // Replace modifier and Hold children.
    for (const child of childElements(el)) {
      if (child.name === 'Modifier' || child.name === 'Hold') removeChild(child);
    }
    if (bound) {
      for (const m of binding.modifiers) {
        const attrs: Record<string, string> = { Device: m.device };
        if ((m.deviceIndex ?? 0) > 0) attrs['DeviceIndex'] = String(m.deviceIndex);
        attrs['Key'] = m.key;
        insertChild(this.xml, el, createElement('Modifier', attrs));
      }
      if (binding.hold) insertChild(this.xml, el, createElement('Hold', { Value: '1' }));
    }
  }

  setToggleOn(code: string, on: boolean): void {
    this.setActionValue(code, 'ToggleOn', on ? '1' : '0');
  }

  setInverted(code: string, inverted: boolean): void {
    this.setActionValue(code, 'Inverted', inverted ? '1' : '0');
  }

  setDeadzone(code: string, deadzone: number): void {
    this.setActionValue(code, 'Deadzone', formatFloat(Math.max(0, Math.min(1, deadzone))));
  }

  /** Clear every slot of every action that uses `device` (and index, if given). */
  clearDevice(device: string, deviceIndex?: number): number {
    let n = 0;
    for (const a of this.actions()) {
      for (const [name, slot] of Object.entries(a.slots) as [SlotName, SlotBinding | null][]) {
        if (slot && slot.device === device && (deviceIndex === undefined || (slot.deviceIndex ?? 0) === deviceIndex)) {
          this.setSlot(a.code, name, null);
          n++;
        }
      }
    }
    return n;
  }

  /**
   * Re-target every reference to `from` (in slots and modifiers) to `to`,
   * e.g. when the same hardware has a different ID on another PC.
   */
  replaceDevice(from: string, to: string, fromIndex?: number, toIndex?: number): number {
    let n = 0;
    const matches = (r: InputRef) =>
      r.device === from && (fromIndex === undefined || (r.deviceIndex ?? 0) === fromIndex);
    const move = (r: InputRef): InputRef => ({ ...r, device: to, deviceIndex: toIndex ?? r.deviceIndex });
    for (const a of this.actions()) {
      for (const [name, slot] of Object.entries(a.slots) as [SlotName, SlotBinding | null][]) {
        if (!slot || !isBound(slot)) continue;
        const hit = matches(slot) || slot.modifiers.some(matches);
        if (!hit) continue;
        const next: SlotBinding = {
          ...(matches(slot) ? move(slot) : slot),
          modifiers: slot.modifiers.map((m) => (matches(m) ? move(m) : m)),
          hold: slot.hold,
        };
        this.setSlot(a.code, name, next);
        n++;
      }
    }
    return n;
  }

  /** Every device ID referenced by a bound slot or modifier. */
  devicesUsed(): { device: string; deviceIndex: number }[] {
    const seen = new Map<string, { device: string; deviceIndex: number }>();
    const add = (r: InputRef) => {
      if (!isBound(r)) return;
      const k = `${r.device}::${r.deviceIndex ?? 0}`;
      if (!seen.has(k)) seen.set(k, { device: r.device, deviceIndex: r.deviceIndex ?? 0 });
    };
    for (const a of this.actions()) {
      for (const s of Object.values(a.slots)) {
        if (s) {
          add(s);
          s.modifiers.forEach(add);
        }
      }
    }
    return [...seen.values()];
  }

  // ------------------------------------------------------------ internals

  private requireAction(code: string): XmlElement {
    const el = childElement(this.xml.root, code);
    if (!el) throw new BindsFormatError(`Action ${code} is not in this file`);
    return el;
  }

  private setActionValue(code: string, name: string, value: string): void {
    const action = this.requireAction(code);
    const el = childElement(action, name);
    if (el) setAttr(el, 'Value', value);
    else insertChild(this.xml, action, createElement(name, { Value: value }));
  }
}

function actionKindOf(el: XmlElement): ActionKind | null {
  if (childElement(el, 'Binding')) return 'axis';
  if (childElement(el, 'Primary') || childElement(el, 'Secondary')) return 'button';
  return null;
}

function readRef(el: XmlElement): InputRef {
  const ref: InputRef = { device: getAttr(el, 'Device') ?? NO_DEVICE, key: getAttr(el, 'Key') ?? '' };
  const idx = getAttr(el, 'DeviceIndex');
  if (idx !== undefined && idx !== '0') ref.deviceIndex = Number(idx);
  return ref;
}

function readSlot(el: XmlElement | undefined): SlotBinding | null {
  if (!el) return null;
  const hold = childElement(el, 'Hold');
  return {
    ...readRef(el),
    modifiers: childElements(el, 'Modifier').map(readRef),
    hold: !!hold && getAttr(hold, 'Value') === '1',
  };
}

function readFlag(action: XmlElement, name: string): boolean | null {
  const el = childElement(action, name);
  return el ? getAttr(el, 'Value') === '1' : null;
}

function readAction(el: XmlElement): ActionState | null {
  const kind = actionKindOf(el);
  if (!kind) return null;
  const slots: ActionState['slots'] =
    kind === 'axis'
      ? { Binding: readSlot(childElement(el, 'Binding')) }
      : { Primary: readSlot(childElement(el, 'Primary')), Secondary: readSlot(childElement(el, 'Secondary')) };
  const dz = childElement(el, 'Deadzone');
  return {
    code: el.name,
    kind,
    slots,
    toggleOn: readFlag(el, 'ToggleOn'),
    inverted: readFlag(el, 'Inverted'),
    deadzone: dz ? Number(getAttr(dz, 'Value') ?? 0) : null,
  };
}
