/** Core tab: HERMES status, directives, treasury, log-scale progress, honest ETA, instruct box. */
import type { OverseerDirective, Treasury } from '@eternity/core';
import type { Transport } from '../net.js';
import type { StationStore, StoreState } from '../store.js';
import { el, esc, reconcileList, setText } from './dom.js';
import { formatAgo, formatCents, formatDuration, formatEta, formatSignedCents, logProgress } from './format.js';

export interface TabView {
  el: HTMLElement;
  update(state: StoreState): void;
}

const DIRECTIVES_SHOWN = 5;

function signClass(cents: number): string {
  return cents > 0 ? 'v pos' : cents < 0 ? 'v neg' : 'v';
}

function stat(label: string, value: string, cls = 'v'): string {
  return `<div class="stat"><span class="k">${esc(label)}</span><span class="${cls}">${esc(value)}</span></div>`;
}

export function createCoreTab(store: StationStore, transport: Transport): TabView {
  const root = el('div', { class: 'tab-panel', 'data-tab': 'core' });

  const hermes = el('div', { class: 'hermes-line' });
  const eye = el('span', { class: 'hermes-eye' });
  const hermesText = el('div', { style: 'min-width:0;flex:1' });
  const hermesStatus = el('div', { class: 'status' });
  const hermesThinking = el('div', { class: 'thinking' });
  hermesText.append(hermesStatus, hermesThinking);
  hermes.append(eye, hermesText);

  const treasurySection = el('div', { class: 'section' });
  const treasuryTitle = el('h3', { text: 'Treasury' });
  const balance = el('div', { class: 'treasury-balance' });
  const stats = el('div', { class: 'grid-2' });
  const progress = el('div', { class: 'progress' });
  const track = el('div', { class: 'track' });
  const fill = el('div', { class: 'fill' });
  track.append(fill);
  const ticks = el('div');
  progress.append(track, ticks);
  const eta = el('div', { class: 'eta' });
  treasurySection.append(treasuryTitle, balance, stats, progress, eta);

  const instructSection = el('div', { class: 'section' });
  const instructTitle = el('h3', { text: 'Instruct HERMES' });
  const form = el('form', { class: 'inline' });
  const input = el('input', { type: 'text', maxlength: '4000', placeholder: 'e.g. Stop spawning music ventures until one pays back' });
  const send = el('button', { type: 'submit', class: 'primary', text: 'Send' });
  form.append(input, send);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text.length === 0) return;
    transport.sendCommand({ type: 'overseer.instruct', text });
    input.value = '';
  });
  instructSection.append(instructTitle, form);

  const directivesSection = el('div', { class: 'section' });
  const directivesTitle = el('h3', { text: 'Recent directives' });
  const directives = el('div');
  const directivesEmpty = el('div', { class: 'empty', text: 'No directives yet. HERMES speaks every epoch.' });
  directivesSection.append(directivesTitle, directives, directivesEmpty);

  root.append(hermes, treasurySection, instructSection, directivesSection);

  let lastTreasurySig = '';
  let lastMilestoneSig = '';

  const renderMilestones = (treasury: Treasury): void => {
    const sig = treasury.milestones.map((m) => `${m.cents}:${m.reachedAtTick ?? ''}`).join('|') + treasury.targetCents;
    if (sig === lastMilestoneSig) return;
    lastMilestoneSig = sig;
    ticks.replaceChildren();
    treasury.milestones.forEach((m, i) => {
      const pct = logProgress(m.cents, treasury.targetCents) * 100;
      const reached = m.reachedAtTick !== undefined;
      const tick = el('span', { class: `tick${reached ? ' reached' : ''}`, style: `left:${pct.toFixed(2)}%` });
      const label = el('span', {
        class: `tick-label${i % 2 === 1 ? ' alt' : ''}${reached ? ' reached' : ''}`,
        style: `left:${pct.toFixed(2)}%`,
        text: m.label,
      });
      ticks.append(tick, label);
    });
  };

  const renderTreasury = (treasury: Treasury, tick: number): void => {
    const sig = JSON.stringify(treasury);
    if (sig !== lastTreasurySig) {
      lastTreasurySig = sig;
      balance.textContent = formatCents(treasury.balanceCents);
      balance.classList.toggle('neg', treasury.balanceCents < 0);
      stats.innerHTML = [
        stat('Target', formatCents(treasury.targetCents)),
        stat('Lifetime revenue', formatCents(treasury.lifetimeRevenueCents), 'v pos'),
        stat('Lifetime cost', formatCents(-treasury.lifetimeCostCents), 'v neg'),
        stat('Daily profit', formatSignedCents(treasury.dailyProfitCents), signClass(treasury.dailyProfitCents)),
        stat('Daily revenue', formatCents(treasury.dailyRevenueCents)),
        stat('Daily cost', formatCents(-treasury.dailyCostCents)),
        stat('Token budget left today', formatCents(treasury.dailyTokenBudgetRemainingCents)),
        stat('Runway', treasury.runwayTicks === null ? 'profitable' : formatDuration(treasury.runwayTicks)),
      ].join('');
      const pct = logProgress(treasury.balanceCents, treasury.targetCents) * 100;
      fill.style.width = `${pct.toFixed(2)}%`;
      const etaText = formatEta(treasury.etaTicksToTarget);
      eta.textContent = `ETA to target: ${etaText}`;
      eta.classList.toggle('never', treasury.etaTicksToTarget === null);
      eta.title = `Balance ${formatCents(treasury.balanceCents)} of ${formatCents(treasury.targetCents)} at tick ${tick}`;
    }
    renderMilestones(treasury);
  };

  const renderDirectives = (list: OverseerDirective[], tick: number): void => {
    const recent = list.slice(-DIRECTIVES_SHOWN).reverse();
    reconcileList(directives, recent, {
      key: (d) => d.id,
      signature: (d) => `${d.actions.length}:${d.rationale.length}:${tick - d.tick > 48 ? 'old' : tick - d.tick}`,
      create: () => el('div', { class: 'directive' }),
      render: (node, d) => {
        const kinds = new Map<string, number>();
        for (const a of d.actions) kinds.set(a.type, (kinds.get(a.type) ?? 0) + 1);
        const breakdown = [...kinds].map(([k, n]) => `${n} ${k}`).join(', ');
        node.innerHTML =
          `<div class="meta"><span>Tick ${d.tick} · ${esc(formatAgo(d.tick, tick))}</span>` +
          `<span title="${esc(breakdown)}">${d.actions.length} action${d.actions.length === 1 ? '' : 's'}</span></div>` +
          `<div class="rationale">${esc(d.rationale)}</div>`;
      },
    });
    directivesEmpty.hidden = recent.length > 0;
  };

  return {
    el: root,
    update(state: StoreState): void {
      const station = state.station;
      if (station === null) {
        setText(hermesStatus, 'HERMES offline: waiting for snapshot');
        return;
      }
      const overseer = station.agents.find((a) => a.role === 'overseer');
      const alive = station.ventures.filter((v) => v.status !== 'killed').length;
      const working = store.workingAgentCount();
      const name = overseer?.name ?? 'HERMES';
      const status = overseer?.status ?? 'offline';
      setText(hermesStatus, `${name} · ${status} · ${alive} ventures · ${working}/${station.agents.length} crew working · epoch every ${station.policy.epochTicks}h`);
      const thinking = state.overseerThinking || overseer?.speech || '';
      setText(hermesThinking, thinking.length > 0 ? thinking : 'Watching the ledger.');
      hermesThinking.title = thinking;
      renderTreasury(station.treasury, station.clock.tick);
      renderDirectives(station.directives, station.clock.tick);
    },
  };
}
