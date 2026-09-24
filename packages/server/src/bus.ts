/**
 * Typed event bus over StationEvent. The station emits, the API broadcasts,
 * tests subscribe.
 */
import type { StationEvent, StationEventType, EventOf } from '@eternity/core';

export type AnyHandler = (event: StationEvent) => void;
export type Handler<T extends StationEventType> = (event: EventOf<T>) => void;
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class StationBus {
  private readonly byType = new Map<StationEventType, Set<AnyHandler>>();
  private readonly any = new Set<AnyHandler>();

  on<T extends StationEventType>(type: T, handler: Handler<T>): () => void {
    let set = this.byType.get(type);
    if (!set) {
      set = new Set();
      this.byType.set(type, set);
    }
    const wrapped = handler as AnyHandler;
    set.add(wrapped);
    return () => set?.delete(wrapped);
  }

  onAny(handler: AnyHandler): () => void {
    this.any.add(handler);
    return () => this.any.delete(handler);
  }

  emit(event: StationEvent): void {
    const typed = this.byType.get(event.type);
    if (typed) for (const handler of typed) safeCall(handler, event);
    for (const handler of this.any) safeCall(handler, event);
  }

  log(level: LogLevel, message: string, tick: number, agentId?: string): void {
    const event: StationEvent = agentId
      ? { type: 'log', level, message, agentId, tick }
      : { type: 'log', level, message, tick };
    this.emit(event);
  }
}

function safeCall(handler: AnyHandler, event: StationEvent): void {
  try {
    handler(event);
  } catch (error) {
    // A misbehaving subscriber must never take the simulation down.
    console.error(`[bus] handler for ${event.type} threw:`, error);
  }
}
