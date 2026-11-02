/**
 * Byte-accurate progress with speed and ETA.
 *
 * `uploadedBytes` = bytes in committed units + bytes currently in flight.
 * A failed part resets its in-flight bytes, so progress can move backwards —
 * that is the honest number. Speed is computed from a separate monotonic
 * "bytes put on the wire" counter so retries do not produce negative speeds.
 */

export interface ProgressSample {
  uploadedBytes: number;
  totalBytes: number;
  speedBps: number;
  etaSeconds: number | null;
}

export class ProgressTracker {
  readonly totalBytes: number;
  private committed = 0;
  private inFlight = new Map<number, number>();
  private wireBytes = 0;
  private samples: Array<{ t: number; bytes: number }> = [];
  private lastSpeed = 0;
  private readonly now: () => number;
  private readonly windowMs: number;

  constructor(totalBytes: number, opts: { now?: () => number; windowMs?: number } = {}) {
    this.totalBytes = totalBytes;
    this.now = opts.now ?? (() => Date.now());
    this.windowMs = opts.windowMs ?? 5000;
  }

  /** Bytes already on the server before this run (resumed parts). Not counted toward speed. */
  addPreCommitted(bytes: number) {
    this.committed += bytes;
  }

  update(unit: number, loaded: number) {
    const prev = this.inFlight.get(unit) ?? 0;
    if (loaded > prev) this.wireBytes += loaded - prev;
    this.inFlight.set(unit, loaded);
  }

  /** Mark a unit (part) as durably uploaded. */
  commit(unit: number, size: number) {
    const prev = this.inFlight.get(unit) ?? 0;
    if (size > prev) this.wireBytes += size - prev;
    this.inFlight.delete(unit);
    this.committed += size;
  }

  /** Drop in-flight bytes for a unit (failure, retry or pause). */
  reset(unit: number) {
    this.inFlight.delete(unit);
  }

  resetAllInFlight() {
    this.inFlight.clear();
  }

  get uploadedBytes(): number {
    let sum = this.committed;
    for (const v of this.inFlight.values()) sum += v;
    return Math.min(this.totalBytes, sum);
  }

  sample(): ProgressSample {
    const t = this.now();
    this.samples.push({ t, bytes: this.wireBytes });
    while (this.samples.length > 2 && t - this.samples[0].t > this.windowMs) this.samples.shift();
    const first = this.samples[0];
    const dt = t - first.t;
    if (dt >= 250) this.lastSpeed = Math.max(0, ((this.wireBytes - first.bytes) * 1000) / dt);
    const uploaded = this.uploadedBytes;
    const remaining = this.totalBytes - uploaded;
    const eta = remaining <= 0 ? 0 : this.lastSpeed > 0 ? remaining / this.lastSpeed : null;
    return { uploadedBytes: uploaded, totalBytes: this.totalBytes, speedBps: this.lastSpeed, etaSeconds: eta };
  }

  /** Forget speed history (e.g. after a pause) so the first samples are not skewed. */
  resetSpeed() {
    this.samples = [];
    this.lastSpeed = 0;
  }
}
