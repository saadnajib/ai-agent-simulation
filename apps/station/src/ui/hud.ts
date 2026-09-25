/**
 * Console HUD: the thin top strip of bracketed phosphor readouts (treasury,
 * daily figures, clock, listings, approvals, mode) and the decorative data
 * gutter down the left edge. Read-only; updates when the store revision moves.
 */
import type { StationStore, StoreState } from '../store.js';
import { el, setText } from './dom.js';
import { formatCents, formatSignedCents, formatSimClock } from './format.js';

export interface Hud {
  update(state: StoreState): void;
}

interface Cell {
  root: HTMLElement;
  value: HTMLElement;
}

function cell(key: string, label: string, extra = ''): Cell {
  const root = el('div', { class: `hud-cell ${extra}`.trim(), 'data-hud': key });
  const k = el('span', { class: 'hud-k', text: label });
  const value = el('span', { class: 'hud-v', text: '--' });
  root.append(k, value);
  return { root, value };
}

function tone(node: HTMLElement, cents: number): void {
  node.classList.toggle('pos', cents > 0);
  node.classList.toggle('neg', cents < 0);
}

export function createHud(root: HTMLElement, store: StationStore): Hud {
  const brand = el('div', { class: 'hud-brand' }, [el('span', { class: 'hud-led' }), el('span', { text: 'ETERNITY//STN' })]);
  const balance = cell('balance', 'BAL', 'wide');
  const profit = cell('profit', 'P/L 24H');
  const revenue = cell('revenue', 'REV 24H');
  const cost = cell('cost', 'COST 24H');
  const clock = cell('clock', 'DAY');
  const listings = cell('listings', 'LIVE');
  const approvals = cell('approvals', 'AIRLOCK');
  const mode = cell('mode', 'MODE', 'mode');
  const crew = cell('crew', 'CREW');
  root.append(
    brand,
    balance.root,
    profit.root,
    revenue.root,
    cost.root,
    clock.root,
    crew.root,
    listings.root,
    approvals.root,
    el('span', { class: 'hud-spacer' }),
    mode.root,
  );

  return {
    update(state: StoreState): void {
      const station = state.station;
      if (station === null) {
        setText(balance.value, 'awaiting snapshot');
        return;
      }
      const tr = station.treasury;
      setText(balance.value, formatCents(tr.balanceCents));
      tone(balance.value, tr.balanceCents < 0 ? -1 : 0);
      setText(profit.value, formatSignedCents(tr.dailyProfitCents));
      tone(profit.value, tr.dailyProfitCents);
      setText(revenue.value, formatCents(tr.dailyRevenueCents));
      setText(cost.value, formatCents(-tr.dailyCostCents));
      tone(cost.value, tr.dailyCostCents > 0 ? -1 : 0);
      const { day } = formatSimClock(station.clock.tick, station.clock.simTime);
      setText(clock.value, `${day.replace(/^Day\s*/i, '')} · T${station.clock.tick}`);
      let live = 0;
      for (const l of station.listings) if (l.status === 'live') live++;
      setText(listings.value, String(live));
      const pending = store.pendingApprovals().length;
      setText(approvals.value, pending > 0 ? `${pending} PENDING` : 'CLEAR');
      approvals.root.classList.toggle('alert', pending > 0);
      setText(crew.value, `${store.workingAgentCount()}/${station.agents.length}`);
      const demand = station.mode === 'sim' && station.simDemandMultiplier && station.simDemandMultiplier !== 1 ? ` x${station.simDemandMultiplier}` : '';
      setText(mode.value, `${station.mode.toUpperCase()}${demand}`);
      mode.root.classList.toggle('live', station.mode === 'live');
      mode.root.title = demand ? `Simulated demand scaled ${station.simDemandMultiplier}x above the honest baseline.` : '';
    },
  };
}

/** Fills the side gutter with dim fake telemetry. Deterministic, built once, animated by CSS only. */
export function fillGutter(root: HTMLElement, rows = 90): void {
  let s = 20260925;
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const lines: string[] = [];
  for (let i = 0; i < rows; i++) {
    const hex = Math.floor(rnd() * 0xffff).toString(16).toUpperCase().padStart(4, '0');
    const n = Math.floor(rnd() * 999).toString().padStart(3, '0');
    const bar = '|'.repeat(1 + Math.floor(rnd() * 5));
    lines.push(i % 7 === 0 ? `-- ${n}` : `${hex} ${bar}`);
  }
  const col = el('div', { class: 'gutter-scroll' });
  // Two copies so the CSS scroll loops seamlessly.
  col.textContent = `${lines.join('\n')}\n${lines.join('\n')}`;
  root.replaceChildren(col);
}
