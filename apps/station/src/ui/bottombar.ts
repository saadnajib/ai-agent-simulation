/** Bottom bar: clock controls, sim clock, mode badge, connection state, follow and dock toggles. */
import type { Transport } from '../net.js';
import type { StationStore, StoreState } from '../store.js';
import { el, setText } from './dom.js';
import { formatSimClock } from './format.js';

export const SPEEDS = [1, 4, 16, 64] as const;
export type Speed = (typeof SPEEDS)[number];

export interface BottomBar {
  update(state: StoreState): void;
}

export interface BottomBarHandlers {
  onToggleDock(): void;
  onToggleFollow(): void;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

export function createBottomBar(root: HTMLElement, store: StationStore, transport: Transport, handlers: BottomBarHandlers): BottomBar {
  const pause = el('button', { class: 'pause', type: 'button', text: 'Pause', title: 'Space' });
  pause.addEventListener('click', () => {
    const paused = store.state.station?.clock.paused ?? false;
    transport.sendCommand({ type: paused ? 'clock.resume' : 'clock.pause' });
  });

  const speedGroup = el('div', { class: 'group', role: 'group', 'aria-label': 'Speed' });
  const speedButtons = new Map<Speed, HTMLButtonElement>();
  SPEEDS.forEach((speed, i) => {
    const b = el('button', { class: 'speed', type: 'button', text: `${speed}x`, title: `Key ${i + 1}` });
    b.addEventListener('click', () => transport.sendCommand({ type: 'clock.speed', speed }));
    speedButtons.set(speed, b);
    speedGroup.append(b);
  });

  const clock = el('div', { class: 'clock' });
  const clockMain = el('span');
  const clockSub = el('span', { class: 'sub' });
  clock.append(clockMain, clockSub);

  const mode = el('span', { class: 'mode-badge sim', text: 'SIM' });
  const conn = el('div', { class: 'conn connecting' });
  const dot = el('span', { class: 'dot' });
  const connLabel = el('span', { class: 'label', text: 'connecting' });
  conn.append(dot, connLabel);

  const follow = el('button', { class: 'follow', type: 'button', text: 'Follow', title: 'F: follow selected agent' });
  follow.addEventListener('click', handlers.onToggleFollow);
  const dockToggle = el('button', { class: 'dock-toggle', type: 'button', text: 'Dock', title: 'Toggle dock (D)' });
  dockToggle.addEventListener('click', handlers.onToggleDock);
  const hint = el('span', { class: 'hint', text: 'Drag to pan · wheel to zoom · click crew to follow · click room to filter' });

  root.append(
    el('div', { class: 'group' }, [pause]),
    speedGroup,
    el('span', { class: 'sep' }),
    clock,
    el('span', { class: 'spacer' }),
    hint,
    el('span', { class: 'sep' }),
    mode,
    conn,
    el('span', { class: 'sep' }),
    follow,
    dockToggle,
  );

  window.addEventListener('keydown', (e) => {
    if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space') {
      e.preventDefault();
      pause.click();
      return;
    }
    const digit = Number.parseInt(e.key, 10);
    if (digit >= 1 && digit <= SPEEDS.length) {
      const speed = SPEEDS[digit - 1];
      if (speed !== undefined) transport.sendCommand({ type: 'clock.speed', speed });
      return;
    }
    if (e.key === 'f' || e.key === 'F') handlers.onToggleFollow();
    if (e.key === 'd' || e.key === 'D') handlers.onToggleDock();
  });

  return {
    update(state: StoreState): void {
      const station = state.station;
      if (station !== null) {
        const c = station.clock;
        pause.textContent = c.paused ? 'Resume' : 'Pause';
        pause.classList.toggle('paused', c.paused);
        for (const [speed, b] of speedButtons) b.classList.toggle('active', c.speed === speed);
        const { day, time, date } = formatSimClock(c.tick, c.simTime);
        setText(clockMain, `${day} ${time}`);
        setText(clockSub, `tick ${c.tick} · ${date}${c.paused ? ' · paused' : ''}`);
        mode.textContent = station.mode.toUpperCase();
        mode.className = `mode-badge ${station.mode}`;
      } else {
        setText(clockMain, 'awaiting snapshot');
      }
      conn.className = `conn ${state.connection}`;
      setText(connLabel, state.connection);
      follow.classList.toggle('on', state.ui.followSelected);
      follow.disabled = state.ui.selectedAgentId === null;
      const agent = store.agentById(state.ui.selectedAgentId);
      follow.textContent = agent ? `Follow ${agent.name}` : 'Follow';
    },
  };
}
