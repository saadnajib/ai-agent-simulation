/** Ventures tab: one card per venture with P&L, ROI, budget share and controls, plus a spawn form. */
import { ROOM_SPECS, VENTURE_KINDS, type Venture, type VentureKind } from '@eternity/core';
import type { Transport } from '../net.js';
import type { StationStore, StoreState } from '../store.js';
import { clamp01, el, esc, reconcileList } from './dom.js';
import { formatCents, formatInt, formatPct, formatRoi, formatSignedCents } from './format.js';
import type { TabView } from './tabCore.js';

const STATUS_RANK: Record<Venture['status'], number> = { scaling: 0, active: 1, incubating: 2, paused: 3, killed: 4 };

const KIND_LABEL: Record<VentureKind, string> = {
  'pod-store': 'Print-on-demand store',
  'game-assets': 'Game asset packs',
  'thumbnail-service': 'Thumbnail gigs',
  'affiliate-blog': 'Affiliate blog',
  'software-templates': 'Software templates',
  'music-packs': 'Music packs',
};

export function sortVentures(list: readonly Venture[]): Venture[] {
  return [...list].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.metrics.profitCents - a.metrics.profitCents);
}

function ventureButtons(v: Venture): string {
  const buttons: string[] = [];
  if (v.status === 'paused') buttons.push('<button data-status="active" type="button" class="ok">Resume</button>');
  else if (v.status !== 'killed') buttons.push('<button data-status="paused" type="button">Pause</button>');
  if (v.status !== 'killed') buttons.push('<button data-status="killed" type="button" class="danger">Kill</button>');
  else buttons.push('<button data-status="incubating" type="button">Revive</button>');
  return `<div class="btn-row">${buttons.join('')}</div>`;
}

export function createVenturesTab(store: StationStore, transport: Transport): TabView {
  const root = el('div', { class: 'tab-panel', 'data-tab': 'ventures' });
  const filterBar = el('div', { class: 'row between section', style: 'margin-bottom:8px' });
  const filterLabel = el('span', { class: 'muted', text: 'All rooms' });
  const clearFilter = el('button', { type: 'button', text: 'Clear filter', style: 'display:none' });
  clearFilter.addEventListener('click', () => store.selectRoom(null));
  filterBar.append(filterLabel, clearFilter);

  const list = el('div');
  const empty = el('div', { class: 'empty', text: 'No ventures here yet. Spawn one below or wait for HERMES.' });

  const spawn = el('div', { class: 'section' });
  const spawnTitle = el('h3', { text: 'Spawn venture' });
  const form = el('form', { class: 'stack' });
  const kindSelect = el('select', { 'aria-label': 'Venture kind' });
  for (const kind of VENTURE_KINDS) kindSelect.append(el('option', { value: kind, text: KIND_LABEL[kind] }));
  const thesis = el('input', { type: 'text', minlength: '3', maxlength: '300', placeholder: 'Thesis, e.g. minimalist line-art cat tees for vets', required: 'true' });
  const row = el('div', { class: 'row' });
  const submit = el('button', { type: 'submit', class: 'primary', text: 'Spawn' });
  const hint = el('span', { class: 'dim-text', text: 'HERMES assigns budget from the next epoch.' });
  row.append(submit, hint);
  form.append(kindSelect, thesis, row);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = thesis.value.trim();
    if (text.length < 3) return;
    transport.sendCommand({ type: 'venture.spawn', kind: kindSelect.value as VentureKind, thesis: text });
    thesis.value = '';
  });
  spawn.append(spawnTitle, form);
  root.append(filterBar, list, empty, spawn);

  list.addEventListener('click', (e) => {
    const target = e.target as HTMLElement | null;
    const button = target?.closest<HTMLButtonElement>('button[data-status]');
    if (button === null || button === undefined) return;
    const ventureId = button.closest<HTMLElement>('[data-key]')?.dataset['key'];
    const status = button.dataset['status'] as Venture['status'] | undefined;
    if (ventureId === undefined || status === undefined) return;
    if (status === 'killed' && !window.confirm('Kill this venture? Its crew is released and its listings are delisted.')) return;
    transport.sendCommand({ type: 'venture.set-status', ventureId, status, reason: 'Set by operator from the dock' });
    button.disabled = true;
  });

  const render = (node: HTMLElement, v: Venture): void => {
    const m = v.metrics;
    const room = ROOM_SPECS[v.roomId];
    const profitClass = m.profitCents > 0 ? 'v pos' : m.profitCents < 0 ? 'v neg' : 'v';
    const roiClass = m.roi > 0 ? 'v pos' : m.roi < 0 ? 'v neg' : 'v';
    const share = clamp01(v.budgetShare);
    const lastSale = m.ticksSinceLastSale === null ? 'no sales yet' : `last sale ${m.ticksSinceLastSale}h ago`;
    node.className = `card${v.status === 'killed' ? ' dim' : ''}`;
    node.innerHTML =
      `<div class="card-head"><span class="card-title" title="${esc(v.name)}">${esc(v.name)}</span><span class="pill ${esc(v.status)}">${esc(v.status)}</span></div>` +
      `<div class="card-sub"><span class="pill kind">${esc(KIND_LABEL[v.kind])}</span> · ${esc(room.name)} · crew ${v.crew.length}</div>` +
      `<div class="card-sub" style="margin:6px 0" title="${esc(v.thesis)}">${esc(v.thesis)}</div>` +
      `<div class="row between" style="margin-bottom:3px"><span class="k dim-text" style="font-size:10px;letter-spacing:.08em;text-transform:uppercase">Budget share</span><span class="mono">${esc(formatPct(share))}</span></div>` +
      `<div class="bar${v.status === 'scaling' ? ' gold' : ''}"><i style="width:${(share * 100).toFixed(1)}%"></i></div>` +
      `<div class="grid-2" style="margin-top:8px">` +
      `<div class="stat"><span class="k">Revenue</span><span class="v pos">${esc(formatCents(m.revenueCents))}</span></div>` +
      `<div class="stat"><span class="k">Cost</span><span class="v neg">${esc(formatCents(-m.costCents))}</span></div>` +
      `<div class="stat"><span class="k">Profit</span><span class="${profitClass}">${esc(formatSignedCents(m.profitCents))}</span></div>` +
      `<div class="stat"><span class="k">ROI · trailing</span><span class="${roiClass}">${esc(formatRoi(m.roi))} · ${esc(formatRoi(m.trailingRoi))}</span></div>` +
      `<div class="stat"><span class="k">Published / sold</span><span class="v">${esc(formatInt(m.unitsPublished))} / ${esc(formatInt(m.unitsSold))}</span></div>` +
      `<div class="stat"><span class="k">Clicks · conv</span><span class="v">${esc(formatInt(m.clicks))} · ${esc(formatPct(m.conversionRate, 1))}</span></div>` +
      `</div>` +
      `<div class="card-sub" style="margin-top:6px">${esc(lastSale)}${v.statusReason ? ` · ${esc(v.statusReason)}` : ''}</div>` +
      ventureButtons(v);
  };

  return {
    el: root,
    update(state: StoreState): void {
      const station = state.station;
      if (station === null) return;
      const roomFilter = state.ui.selectedRoomId;
      const filtered = roomFilter === null ? station.ventures : station.ventures.filter((v) => v.roomId === roomFilter);
      filterLabel.textContent = roomFilter === null ? `All rooms · ${station.ventures.length} ventures` : `${ROOM_SPECS[roomFilter].name} · ${filtered.length} ventures`;
      clearFilter.style.display = roomFilter === null ? 'none' : '';
      reconcileList(list, sortVentures(filtered), {
        key: (v) => v.id,
        signature: (v) => `${v.status}:${v.budgetShare.toFixed(3)}:${JSON.stringify(v.metrics)}:${v.crew.length}:${v.statusReason ?? ''}`,
        create: () => el('div', { class: 'card' }),
        render,
      });
      empty.hidden = filtered.length > 0;
    },
  };
}
