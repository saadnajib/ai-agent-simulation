/**
 * Wall-clock driver for the simulation. Advances one tick every
 * 1000 / (tickHz * speed) milliseconds unless paused. Ticks never overlap: if
 * a tick is still being processed when the next is due, the next waits.
 */
import type { Clock } from '@eternity/core';
import { tickToSimTime } from '@eternity/core';

export type Speed = 1 | 4 | 16 | 64;
export const SPEEDS: readonly Speed[] = [1, 4, 16, 64];

export interface ClockOptions {
  tickHz: number;
  tick?: number;
  paused?: boolean;
  speed?: Speed;
}

export class StationClock {
  tick: number;
  paused: boolean;
  speed: Speed;
  private readonly tickHz: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private busy = false;
  private onTick: (() => Promise<void>) | null = null;

  constructor(opts: ClockOptions) {
    this.tickHz = opts.tickHz;
    this.tick = opts.tick ?? 0;
    this.paused = opts.paused ?? false;
    this.speed = opts.speed ?? 1;
  }

  snapshot(): Clock {
    return { tick: this.tick, simTime: tickToSimTime(this.tick), paused: this.paused, speed: this.speed };
  }

  intervalMs(): number {
    return Math.max(1, Math.round(1000 / (this.tickHz * this.speed)));
  }

  start(onTick: () => Promise<void>): void {
    if (this.running) return;
    this.running = true;
    this.onTick = onTick;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
    if (this.running && this.timer) {
      clearTimeout(this.timer);
      this.schedule();
    }
  }

  private schedule(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => void this.fire(), this.intervalMs());
  }

  private async fire(): Promise<void> {
    if (!this.running) return;
    if (!this.paused && !this.busy && this.onTick) {
      this.busy = true;
      try {
        await this.onTick();
      } catch (error) {
        console.error('[clock] tick failed:', error);
      } finally {
        this.busy = false;
      }
    }
    this.schedule();
  }
}
