/** Airlock tab: pending approvals, high risk first, with approve / reject actions. */
import type { ApprovalRequest, RiskLevel } from '@eternity/core';
import type { Transport } from '../net.js';
import type { StationStore, StoreState } from '../store.js';
import { el, esc, reconcileList } from './dom.js';
import type { TabView } from './tabCore.js';

const RISK_RANK: Record<RiskLevel, number> = { high: 0, medium: 1, low: 2 };

export function sortApprovals(list: readonly ApprovalRequest[]): ApprovalRequest[] {
  return [...list].sort((a, b) => RISK_RANK[a.risk] - RISK_RANK[b.risk] || b.requestedAtTick - a.requestedAtTick);
}

function payloadJson(payload: Record<string, unknown>): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return '[unserialisable payload]';
  }
}

export function createAirlockTab(store: StationStore, transport: Transport): TabView {
  const root = el('div', { class: 'tab-panel', 'data-tab': 'airlock' });
  const head = el('div', { class: 'section' });
  const title = el('h3');
  const count = el('span', { text: 'Airlock queue' });
  const approveLow = el('button', { class: 'ok', type: 'button', text: 'Approve all low-risk' });
  approveLow.addEventListener('click', () => {
    transport.sendCommand({ type: 'approval.decide-all', decision: 'approved', maxRisk: 'low' });
  });
  title.append(count, approveLow);
  const intro = el('p', { class: 'card-sub', style: 'margin:0 0 8px', text: 'Nothing spends money, touches an account or goes public until you approve it here.' });
  head.append(title, intro);
  const list = el('div');
  const listEmpty = el('div', { class: 'empty', text: 'Airlock clear. The crew keeps working until something needs you.' });
  const decided = el('div', { class: 'section' });
  const decidedTitle = el('h3', { text: 'Recently decided' });
  const decidedList = el('div');
  decided.append(decidedTitle, decidedList);
  root.append(head, list, listEmpty, decided);

  root.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    const button = target?.closest<HTMLButtonElement>('button[data-decision]');
    if (button === null || button === undefined) return;
    const card = button.closest<HTMLElement>('[data-key]');
    const approvalId = card?.dataset['key'];
    const decision = button.dataset['decision'];
    if (approvalId === undefined || (decision !== 'approved' && decision !== 'rejected')) return;
    transport.sendCommand({ type: 'approval.decide', approvalId, decision });
    button.disabled = true;
  });

  const renderCard = (node: HTMLElement, a: ApprovalRequest): void => {
    const venture = store.ventureById(a.ventureId);
    const requester = store.agentById(a.requestedBy);
    const manual = a.manualInstructions
      ? `<details><summary>Manual instructions</summary><div class="manual">${esc(a.manualInstructions)}</div></details>`
      : '';
    const pending = a.status === 'pending';
    const actions = pending
      ? `<div class="btn-row"><button class="ok" data-decision="approved" type="button">Approve</button>` +
        `<button class="danger" data-decision="rejected" type="button">Reject</button></div>`
      : `<div class="card-sub" style="margin-top:6px">${esc(a.status)}${a.note ? ` · ${esc(a.note)}` : ''}</div>`;
    node.className = `card${pending ? '' : ' dim'}`;
    node.innerHTML =
      `<div class="card-head"><span class="row" style="gap:6px;min-width:0"><span class="pill kind">${esc(a.kind)}</span>` +
      `<span class="pill risk-${esc(a.risk)}">${esc(a.risk)} risk</span></span>` +
      `<span class="card-sub">t${a.requestedAtTick}</span></div>` +
      `<div class="card-title" title="${esc(a.title)}">${esc(a.title)}</div>` +
      `<div class="card-sub">${esc(a.summary)}</div>` +
      `<div class="card-sub" style="margin-top:4px">${venture ? `${esc(venture.name)} · ` : ''}requested by ${esc(requester?.name ?? a.requestedBy)}</div>` +
      manual +
      `<details><summary>Payload</summary><pre class="payload">${esc(payloadJson(a.payload))}</pre></details>` +
      actions;
  };

  const spec = {
    key: (a: ApprovalRequest) => a.id,
    signature: (a: ApprovalRequest) => `${a.status}:${a.risk}:${a.note ?? ''}:${a.title}`,
    create: () => el('div', { class: 'card' }),
    render: renderCard,
  };

  return {
    el: root,
    update(state: StoreState): void {
      const station = state.station;
      if (station === null) return;
      const pending = sortApprovals(station.approvals.filter((a) => a.status === 'pending'));
      const lowCount = pending.filter((a) => a.risk === 'low').length;
      count.textContent = `Airlock queue · ${pending.length} pending`;
      approveLow.disabled = lowCount === 0;
      approveLow.textContent = lowCount > 0 ? `Approve all low-risk (${lowCount})` : 'Approve all low-risk';
      reconcileList(list, pending, spec);
      listEmpty.hidden = pending.length > 0;
      const recent = station.approvals
        .filter((a) => a.status !== 'pending')
        .sort((a, b) => b.requestedAtTick - a.requestedAtTick)
        .slice(0, 8);
      decided.style.display = recent.length > 0 ? '' : 'none';
      reconcileList(decidedList, recent, spec);
    },
  };
}
