/** Crew tab: every agent in a table sorted by role; click a row to select and follow. */
import { AGENT_ROLES, ROOM_SPECS, type CrewAgent } from '@eternity/core';
import { ROLE_PALETTE } from '../render/agents.js';
import type { StationStore, StoreState } from '../store.js';
import { el, esc, reconcileList } from './dom.js';
import { formatCents, truncate } from './format.js';
import type { TabView } from './tabCore.js';

const ROLE_RANK = new Map(AGENT_ROLES.map((r, i) => [r, i] as const));

export function sortCrew(list: readonly CrewAgent[]): CrewAgent[] {
  return [...list].sort((a, b) => (ROLE_RANK.get(a.role) ?? 99) - (ROLE_RANK.get(b.role) ?? 99) || a.name.localeCompare(b.name));
}

export function createCrewTab(store: StationStore): TabView {
  const root = el('div', { class: 'tab-panel', 'data-tab': 'crew' });
  const summary = el('div', { class: 'card-sub', style: 'margin-bottom:8px' });
  const table = el('table', { class: 'crew' });
  table.innerHTML =
    '<colgroup><col style="width:92px"><col style="width:60px"><col><col style="width:56px"><col style="width:56px"></colgroup>' +
    '<thead><tr><th>Crew</th><th>Status</th><th>Task</th><th class="num">Cost</th><th class="num">Rev</th></tr></thead>';
  const body = el('tbody');
  table.append(body);
  root.append(summary, table);

  body.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement | null)?.closest<HTMLElement>('tr[data-key]');
    const id = row?.dataset['key'];
    if (id === undefined) return;
    store.selectAgent(store.state.ui.selectedAgentId === id ? null : id);
  });

  const render = (node: HTMLElement, a: CrewAgent): void => {
    const task = store.taskById(a.currentTaskId);
    const venture = store.ventureById(a.ventureId);
    const taskText = task ? task.title : a.status === 'idle' ? 'idle' : a.status === 'resting' ? 'resting' : '';
    const where = ROOM_SPECS[a.roomId]?.name ?? a.roomId;
    node.classList.toggle('selected', store.state.ui.selectedAgentId === a.id);
    node.title = `${a.name} · ${a.role} · ${where}${venture ? ` · ${venture.name}` : ''} · brain ${a.brain} · ${a.stats.tasksCompleted} done / ${a.stats.tasksFailed} failed`;
    node.innerHTML =
      `<td><span class="role-dot" style="background:${ROLE_PALETTE[a.role].suit}"></span>${esc(a.name)}` +
      `<div class="sub">${esc(a.role)}</div></td>` +
      `<td class="status-${esc(a.status)}">${esc(a.status)}</td>` +
      `<td title="${esc(taskText)}">${esc(truncate(taskText, 40))}</td>` +
      `<td class="num">${esc(formatCents(a.stats.costCents))}</td>` +
      `<td class="num">${esc(formatCents(a.stats.revenueAttributedCents))}</td>`;
  };

  return {
    el: root,
    update(state: StoreState): void {
      const station = state.station;
      if (station === null) return;
      const working = store.workingAgentCount();
      const totalCost = station.agents.reduce((s, a) => s + a.stats.costCents, 0);
      const totalRev = station.agents.reduce((s, a) => s + a.stats.revenueAttributedCents, 0);
      summary.textContent = `${station.agents.length} crew · ${working} working · spent ${formatCents(totalCost)} · attributed ${formatCents(totalRev)}. Click a row to follow.`;
      const selected = state.ui.selectedAgentId ?? '';
      reconcileList(body, sortCrew(station.agents), {
        key: (a) => a.id,
        signature: (a) => `${a.status}:${a.currentTaskId ?? ''}:${a.roomId}:${a.stats.costCents}:${a.stats.revenueAttributedCents}:${a.id === selected}`,
        create: () => el('tr'),
        render,
      });
    },
  };
}
