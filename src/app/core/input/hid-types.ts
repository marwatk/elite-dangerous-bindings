/**
 * Minimal WebHID typings (the project has no @types/w3c-web-hid).
 * Only the members the input layer uses. See https://wicg.github.io/webhid/.
 */

export interface HidReportItem {
  isAbsolute?: boolean;
  isArray?: boolean;
  isConstant?: boolean;
  isRange?: boolean;
  hasNull?: boolean;
  /**
   * Extended usages: `(usagePage << 16) | usageId` per the spec. Some
   * implementations/tests give plain 16-bit IDs plus `usagePage`; both work.
   */
  usages?: number[];
  usageMinimum?: number;
  usageMaximum?: number;
  /** Not in the spec; honoured when present (older docs/tools use it). */
  usagePage?: number;
  reportSize?: number;
  reportCount?: number;
  logicalMinimum?: number;
  logicalMaximum?: number;
}

export interface HidReportInfo {
  reportId?: number;
  items?: HidReportItem[];
}

export interface HidCollectionInfo {
  usagePage?: number;
  usage?: number;
  type?: number;
  children?: HidCollectionInfo[];
  inputReports?: HidReportInfo[];
  outputReports?: HidReportInfo[];
  featureReports?: HidReportInfo[];
}

export interface HidInputReportEvent extends Event {
  readonly device: HidDevice;
  readonly reportId: number;
  readonly data: DataView;
}

export interface HidDevice extends EventTarget {
  readonly opened: boolean;
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  readonly collections: HidCollectionInfo[];
  open(): Promise<void>;
  close(): Promise<void>;
  forget?(): Promise<void>;
}

export interface HidDeviceFilter {
  vendorId?: number;
  productId?: number;
  usagePage?: number;
  usage?: number;
}

export interface HidConnectionEvent extends Event {
  readonly device: HidDevice;
}

export interface Hid extends EventTarget {
  getDevices(): Promise<HidDevice[]>;
  requestDevice(options: { filters: HidDeviceFilter[] }): Promise<HidDevice[]>;
}

export function navigatorHid(): Hid | null {
  if (typeof navigator === 'undefined') return null;
  return ((navigator as unknown as { hid?: Hid }).hid ?? null) as Hid | null;
}

/** Top-level collections we treat as game controllers: joystick, gamepad, multi-axis controller. */
export const CONTROLLER_FILTERS: HidDeviceFilter[] = [
  { usagePage: 0x01, usage: 0x04 },
  { usagePage: 0x01, usage: 0x05 },
  { usagePage: 0x01, usage: 0x08 },
];

export function isControllerCollection(c: HidCollectionInfo): boolean {
  return c.usagePage === 0x01 && (c.usage === 0x04 || c.usage === 0x05 || c.usage === 0x08);
}
