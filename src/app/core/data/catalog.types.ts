/** Types for the static data in public/data and devices/. */

export type ActionGroup =
  | 'Ship'
  | 'SRV'
  | 'Scanners'
  | 'Fighter'
  | 'OnFoot'
  | 'Multicrew'
  | 'Head look'
  | 'UI'
  | 'Galaxy map'
  | 'Camera'
  | 'Holo-Me'
  | 'Misc';

/** EDRefCard's colour category. */
export type ActionCategory = 'General' | 'Combat' | 'Social' | 'Navigation' | 'UI';

export interface ActionInfo {
  code: string;
  /** Short card name, e.g. "Hyperspace/Supercruise". */
  name: string;
  /** Descriptive table name, e.g. "Toggle Frame Shift Drive". */
  longName: string;
  group: ActionGroup | string;
  category: ActionCategory | string;
  /** Table grouping, e.g. "Ship Controls". */
  area: string;
  /** Table sub-grouping, e.g. "Flight Rotation". */
  section: string;
  type: 'digital' | 'analogue';
  order: number;
  /** Digital action that also accepts an axis (e.g. GalMap Up). */
  hasAnalogue?: boolean;
  /** Hide on cards when bound to the same input as one of these codes. */
  hideIfSameAs?: string[];
  /** Very short label, e.g. "FSD". */
  short?: string;
  /** Known from older game versions; not in the current template. */
  legacy?: boolean;
  /** Game contexts the action is live in (computed by contextsFor at load). */
  contexts?: string[];
}

export interface SettingInfo {
  code: string;
  name: string;
}

export interface KeyInfo {
  /** Elite key name, e.g. `Key_LeftAlt`. */
  key: string;
  label: string;
}

export interface UsbId {
  /** 4 upper-case hex digits. */
  vid: string;
  pid: string;
}

export interface DeviceIdEntry {
  bindsId: string;
  deviceIndex?: number;
  usb?: UsbId;
}

export interface DeviceImage {
  file: string;
  width: number;
  height: number;
}

export type ControlKind = 'button' | 'axis' | 'hat';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A point on a device image, in image pixels (top-left origin). */
export interface ImagePoint {
  x: number;
  y: number;
}

export interface DeviceControl {
  bindsId: string;
  deviceIndex?: number;
  key: string;
  label: string;
  kind: ControlKind;
  image?: number;
  box?: Box;
  /**
   * Leader line from the box to the control: the last point is the anchor on
   * the control, earlier points are elbows. The line starts on the box edge
   * nearest the first point (computed when drawn). Needs `box`.
   */
  leader?: ImagePoint[];
}

export type GroupLayoutKind = 'stack' | 'row';

/** One control in a group, and the marker that says which it is (↑, ●, +, "Fwd"…). */
export interface GroupMember {
  bindsId: string;
  deviceIndex?: number;
  key: string;
  marker: string;
}

/**
 * Controls that share one label box (a hat, rocker, encoder, ministick…):
 * the box is split into one row (stack) or cell (row) per member, with the
 * group's label in a column on the left. Members keep their entry in
 * `controls` (names) but have no box of their own.
 */
export interface ControlGroup {
  id: string;
  label: string;
  /** Default "stack". */
  layout?: GroupLayoutKind;
  /** Default true. */
  showLabel?: boolean;
  image?: number;
  box: Box;
  leader?: ImagePoint[];
  members: GroupMember[];
}

export interface InputCorrection {
  buttonOffset?: number;
  /** Browser axis index -> Elite axis key. */
  axisMap?: Record<string, string>;
}

export type DeviceSource = 'edrefcard2' | 'edcd' | 'user';

export interface DeviceSummary {
  id: string;
  name: string;
  source: DeviceSource;
  ids: DeviceIdEntry[];
  keyBindsIds?: string[];
  images: DeviceImage[];
  controlCount: number;
  /** Set for devices made in this browser with the layout editor. */
  local?: boolean;
}

export interface DeviceDefinition {
  $schema?: string;
  id: string;
  name: string;
  source: DeviceSource;
  ids: DeviceIdEntry[];
  keyBindsIds?: string[];
  images: DeviceImage[];
  /** Draw box outlines on cards (artwork without printed boxes, e.g. photos). */
  drawBoxes?: boolean;
  controls: DeviceControl[];
  groups?: ControlGroup[];
  inputCorrections?: Record<string, InputCorrection>;
}

export interface GenericControl {
  key: string;
  label: string;
  kind: ControlKind;
}
