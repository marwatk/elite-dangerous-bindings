import { InputRef } from '../binds/binds-document';
import { UsbId } from '../data/catalog.types';

export type InputBackend = 'webhid' | 'gamepad' | 'keyboard';

/** What a capture accepts. `key` is the computer keyboard. */
export type CaptureKind = 'button' | 'axis' | 'hat' | 'key';

/** A controller the browser can currently see (or saw earlier this session). */
export interface LiveDevice {
  /** Stable session key, e.g. `hid:231D:0200:1` or `gp:0`. */
  id: string;
  /** Product name reported by the browser. */
  name: string;
  backend: InputBackend;
  usb?: UsbId;
  /**
   * Elite device ID events are reported under. Prefers an ID already used in
   * the open file, then the catalogue's mapping, then the 8-digit hex form.
   */
  bindsId: string;
  /** Elite DeviceIndex, for identical devices. */
  deviceIndex: number;
  /** Every plausible Elite ID for this device, best first. */
  candidates: string[];
  connected: boolean;
  buttons: number;
  axes: number;
  hats: number;
  /** Caveats about how this device is read (e.g. Gamepad API button banks). */
  notes?: string[];
}

export interface InputEvent {
  device: LiveDevice;
  /** In Elite terms: `device` is the bindsId, `key` is `Joy_3`, `Joy_XAxis`, `Joy_POV1Up`, `Key_A`... */
  ref: InputRef;
  kind: CaptureKind;
  /** Buttons, hats and keys: 1 pressed / 0 released. Axes: -1..1. */
  value: number;
  /** Buttons/hats/keys: currently down. Axes: moved past the capture threshold from rest. */
  pressed: boolean;
  timestamp: number;
}

export interface CaptureOptions {
  accept: CaptureKind[];
  /** Record controls held at the moment of capture as modifiers. Default true. */
  modifiers?: boolean;
  signal?: AbortSignal;
}

export interface CaptureResult {
  ref: InputRef;
  modifiers: InputRef[];
  kind: CaptureKind;
  /** Axes: the direction it was moved from rest. */
  direction?: 1 | -1;
  device: LiveDevice;
}
