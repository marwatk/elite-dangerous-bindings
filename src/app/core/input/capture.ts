import { InputRef, inputId } from '../binds/binds-document';
import { CaptureKind, CaptureOptions, CaptureResult, InputEvent, LiveDevice } from './input.types';

/**
 * The capture state machine, independent of any input backend.
 *
 * Buttons, hats and keys: a newly pressed accepted input becomes the
 * candidate. The capture resolves when the first held control is released:
 * the candidate is the most recently pressed accepted control, and every
 * other control still held becomes a modifier. So "hold Joy_5, press Joy_1"
 * captures Joy_1 with Joy_5 as modifier, and "press Shift, press A" captures
 * Key_A with Key_LeftShift, while a single press captures just that control.
 * With `modifiers: false` the capture resolves immediately on the press.
 *
 * Axes: a resting value is recorded when the capture starts (and tracked
 * during the warm-up); the capture resolves once an axis has been more than
 * `axisThreshold` away from rest, in the same direction, for
 * `stableSamples` consecutive samples.
 */

export interface HeldInput {
  ref: InputRef;
  kind: CaptureKind;
  device: LiveDevice;
}

export interface CaptureTuning {
  /** Ignore input for this long after starting (ms). */
  warmupMs: number;
  axisThreshold: number;
  stableSamples: number;
}

export const DEFAULT_TUNING: CaptureTuning = { warmupMs: 150, axisThreshold: 0.5, stableSamples: 2 };

interface AxisTrack {
  rest: number;
  sign: 0 | 1 | -1;
  count: number;
}

interface Pending {
  opts: CaptureOptions;
  startedAt: number;
  resolve: (r: CaptureResult) => void;
  reject: (e: unknown) => void;
  cleanup: () => void;
  axes: Map<string, AxisTrack>;
  /** Accepted inputs pressed after the warm-up, most recent last. */
  fresh: HeldInput[];
}

export function abortError(message = 'Capture cancelled'): DOMException {
  return new DOMException(message, 'AbortError');
}

function hatPrefix(key: string): string | null {
  const m = /^(.*POV\d+)(Up|Down|Left|Right)$/.exec(key);
  return m ? m[1] : null;
}

export class CaptureController {
  private pending: Pending | null = null;

  constructor(
    /** Currently held buttons/hat directions/keys, across all devices. */
    private readonly held: () => HeldInput[],
    /** Current value of every known axis, keyed by inputId. */
    private readonly axisValues: () => ReadonlyMap<string, number>,
    private readonly now: () => number = () => performance.now(),
    private readonly tuning: CaptureTuning = DEFAULT_TUNING,
  ) {}

  get active(): boolean {
    return this.pending !== null;
  }

  /** What the active capture accepts, or null. */
  get accepting(): readonly CaptureKind[] | null {
    return this.pending?.opts.accept ?? null;
  }

  begin(opts: CaptureOptions): Promise<CaptureResult> {
    this.abort('Superseded by a new capture');
    return new Promise<CaptureResult>((resolve, reject) => {
      if (opts.signal?.aborted) {
        reject(abortError());
        return;
      }
      const onAbort = () => {
        if (this.pending === p) this.finish(null, abortError());
      };
      const p: Pending = {
        opts,
        startedAt: this.now(),
        resolve,
        reject,
        cleanup: () => opts.signal?.removeEventListener('abort', onAbort),
        axes: new Map(),
        fresh: [],
      };
      for (const [id, v] of this.axisValues()) p.axes.set(id, { rest: v, sign: 0, count: 0 });
      opts.signal?.addEventListener('abort', onAbort);
      this.pending = p;
    });
  }

  abort(message = 'Capture cancelled'): void {
    if (this.pending) this.finish(null, abortError(message));
  }

  /** Feed every button/hat/key transition and every axis sample. */
  feed(ev: InputEvent): void {
    const p = this.pending;
    if (!p) return;
    if (ev.kind === 'axis') this.onAxis(p, ev);
    else if (ev.pressed) this.onPress(p, ev);
    else this.onRelease(p, ev);
  }

  private warm(p: Pending, t: number): boolean {
    return t - p.startedAt < this.tuning.warmupMs;
  }

  private onPress(p: Pending, ev: InputEvent): void {
    if (this.warm(p, ev.timestamp) || !p.opts.accept.includes(ev.kind)) return;
    if (ev.device.backend === 'keyboard' && ev.ref.key === 'Key_Escape') return;
    const entry: HeldInput = { ref: ev.ref, kind: ev.kind, device: ev.device };
    if (p.opts.modifiers === false) {
      this.finish({ ref: ev.ref, modifiers: [], kind: ev.kind, device: ev.device });
      return;
    }
    const id = inputId(ev.ref);
    p.fresh = [...p.fresh.filter((h) => inputId(h.ref) !== id), entry];
  }

  private onRelease(p: Pending, ev: InputEvent): void {
    if (p.opts.modifiers === false) return;
    const heldNow = this.held();
    const heldIds = new Set(heldNow.map((h) => inputId(h.ref)));
    const releasedId = inputId(ev.ref);
    // Candidates: fresh presses still held, or the one just released.
    const live = p.fresh.filter((h) => {
      const id = inputId(h.ref);
      return id === releasedId || heldIds.has(id);
    });
    const cand = live.at(-1);
    if (!cand) return;
    const candId = inputId(cand.ref);
    const pov = hatPrefix(cand.ref.key);
    const modifiers: InputRef[] = [];
    const seen = new Set<string>([candId]);
    // The control just released counts too (the modifier may be let go first).
    const released: HeldInput = { ref: ev.ref, kind: ev.kind, device: ev.device };
    for (const h of [...heldNow, released]) {
      const id = inputId(h.ref);
      if (seen.has(id) || h.kind === 'axis') continue;
      if (pov && h.ref.device === cand.ref.device && hatPrefix(h.ref.key) === pov) continue;      if (h.device.backend === 'keyboard' && h.ref.key === 'Key_Escape') continue;
      seen.add(id);
      modifiers.push(stripRef(h.ref));
    }
    this.finish({ ref: stripRef(cand.ref), modifiers, kind: cand.kind, device: cand.device });
  }

  private onAxis(p: Pending, ev: InputEvent): void {
    const id = inputId(ev.ref);
    let t = p.axes.get(id);
    if (!t) {
      p.axes.set(id, (t = { rest: ev.value, sign: 0, count: 0 }));
      return;
    }
    if (this.warm(p, ev.timestamp)) {
      t.rest = ev.value;
      return;
    }
    if (!p.opts.accept.includes('axis')) return;
    const d = ev.value - t.rest;
    if (Math.abs(d) <= this.tuning.axisThreshold) {
      t.sign = 0;
      t.count = 0;
      return;
    }
    const sign: 1 | -1 = d > 0 ? 1 : -1;
    if (t.sign === sign) t.count++;
    else {
      t.sign = sign;
      t.count = 1;
    }
    if (t.count >= this.tuning.stableSamples) {
      this.finish({ ref: stripRef(ev.ref), modifiers: [], kind: 'axis', direction: sign, device: ev.device });
    }
  }

  private finish(result: CaptureResult | null, error?: unknown): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    p.cleanup();
    if (result) p.resolve(result);
    else p.reject(error ?? abortError());
  }
}

function stripRef(r: InputRef): InputRef {
  return r.deviceIndex ? { device: r.device, key: r.key, deviceIndex: r.deviceIndex } : { device: r.device, key: r.key };
}
