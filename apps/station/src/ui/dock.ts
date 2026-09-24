/**
 * Right dock with five tabs. Updates are throttled: the active tab re-renders
 * when the store revision changes and at most every UPDATE_INTERVAL_MS.
 */
import type { Transport } from '../net.js';
import type { StationStore } from '../store.js';
import { el } from './dom.js';
import { createAirlockTab } from './tabAirlock.js';
import { createCoreTab, type TabView } from './tabCore.js';
import { createCrewTab } from './tabCrew.js';
import { createLogTab } from './tabLog.js';
import { createVenturesTab } from './tabVentures.js';

export type DockTab = 'core' | 'airlock' | 'ventures' | 'crew' | 'log';
export const DOCK_TABS: readonly DockTab[] = ['core', 'airlock', 'ventures', 'crew', 'log'];
const TAB_LABEL: Record<DockTab, string> = { core: 'Core', airlock: 'Airlock', ventures: 'Ventures', crew: 'Crew', log: 'Log' };
const UPDATE_INTERVAL_MS = 150;
const NARROW_PX = 900;

export interface Dock {
  setTab(tab: DockTab): void;
  activeTab(): DockTab;
  toggle(): void;
  isOpen(): boolean;
  update(nowMs: number): void;
}

export function createDock(root: HTMLElement, app: HTMLElement, store: StationStore, transport: Transport): Dock {
  const tabs: Record<DockTab, TabView> = {
    core: createCoreTab(store, transport),
    airlock: createAirlockTab(store, transport),
    ventures: createVenturesTab(store, transport),
    crew: createCrewTab(store),
    log: createLogTab(store),
  };
  const buttons = {} as Record<DockTab, HTMLButtonElement>;
  const badges = {} as Record<DockTab, HTMLSpanElement>;
  const tabBar = el('div', { class: 'dock-tabs', role: 'tablist' });
  const body = el('div', { class: 'dock-body' });
  let active: DockTab = 'core';
  let lastRevision = -1;
  let lastUpdateMs = 0;

  const isNarrow = (): boolean => window.innerWidth < NARROW_PX;

  const setTab = (tab: DockTab): void => {
    active = tab;
    for (const t of DOCK_TABS) {
      buttons[t].classList.toggle('active', t === tab);
      buttons[t].setAttribute('aria-selected', String(t === tab));
      tabs[t].el.classList.toggle('active', t === tab);
    }
    lastRevision = -1;
    tabs[tab].update(store.state);
    if (tab === 'log') tabs.log.el.scrollTop = tabs.log.el.scrollHeight;
  };

  for (const t of DOCK_TABS) {
    const badge = el('span', { class: 'badge' });
    const button = el('button', { class: 'dock-tab', role: 'tab', type: 'button', text: TAB_LABEL[t] });
    button.append(badge);
    button.addEventListener('click', () => setTab(t));
    buttons[t] = button;
    badges[t] = badge;
    tabBar.append(button);
    body.append(tabs[t].el);
  }
  root.append(tabBar, body);

  const isOpen = (): boolean => (isNarrow() ? app.classList.contains('sheet-open') : !app.classList.contains('dock-closed'));

  const toggle = (): void => {
    if (isNarrow()) app.classList.toggle('sheet-open');
    else app.classList.toggle('dock-closed');
    window.dispatchEvent(new Event('resize'));
  };

  setTab('core');

  return {
    setTab,
    activeTab: () => active,
    toggle,
    isOpen,
    update(nowMs: number): void {
      const revision = store.state.revision;
      if (revision === lastRevision || nowMs - lastUpdateMs < UPDATE_INTERVAL_MS) return;
      lastRevision = revision;
      lastUpdateMs = nowMs;
      const pending = store.pendingApprovals().length;
      badges.airlock.textContent = pending > 0 ? String(pending) : '';
      if (isOpen()) tabs[active].update(store.state);
    },
  };
}
