/** Log tab: last 300 lines with level colours; auto-scrolls unless the user scrolled up. */
import type { LogLine, LogLevel, StationStore, StoreState } from '../store.js';
import { el, esc } from './dom.js';
import type { TabView } from './tabCore.js';

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error'];
const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const STICKY_PX = 24;

export function createLogTab(store: StationStore): TabView {
  const root = el('div', { class: 'tab-panel log-panel', 'data-tab': 'log' });
  const tools = el('div', { class: 'log-tools' });
  const levelLabel = el('span', { text: 'Min level' });
  const levelSelect = el('select', { 'aria-label': 'Minimum log level' });
  for (const lvl of LEVELS) levelSelect.append(el('option', { value: lvl, text: lvl }));
  levelSelect.value = 'info';
  const counter = el('span', { class: 'dim-text' });
  const jump = el('button', { class: 'jump', type: 'button', text: 'Jump to latest' });
  tools.append(levelLabel, levelSelect, counter, jump);
  const list = el('div', { class: 'log-list' });
  root.append(tools, list);

  let minLevel: LogLevel = 'info';
  let lastSeq = 0;
  let autoScroll = true;
  let rendered: LogLine[] = [];

  const atBottom = (): boolean => root.scrollHeight - root.scrollTop - root.clientHeight < STICKY_PX;

  root.addEventListener('scroll', () => {
    autoScroll = atBottom();
    jump.style.visibility = autoScroll ? 'hidden' : 'visible';
  });
  jump.addEventListener('click', () => {
    autoScroll = true;
    root.scrollTop = root.scrollHeight;
    jump.style.visibility = 'hidden';
  });
  levelSelect.addEventListener('change', () => {
    minLevel = levelSelect.value as LogLevel;
    lastSeq = 0;
    list.replaceChildren();
    rendered = [];
  });
  jump.style.visibility = 'hidden';

  const lineNode = (line: LogLine): HTMLElement => {
    const agent = line.agentId ? store.agentById(line.agentId) : undefined;
    const prefix = agent && !line.message.startsWith(agent.name) ? `<b>${esc(agent.name)}</b> ` : '';
    return el('div', {
      class: `log-line ${line.level}`,
      html: `<span class="t">t${line.tick}</span><span class="m">${prefix}${esc(line.message)}</span>`,
    });
  };

  return {
    el: root,
    update(state: StoreState): void {
      const logs = state.logs;
      const newest = logs[logs.length - 1];
      if (newest === undefined || newest.seq === lastSeq) return;
      const fresh = logs.filter((l) => l.seq > lastSeq && LEVEL_RANK[l.level] >= LEVEL_RANK[minLevel]);
      lastSeq = newest.seq;
      if (fresh.length === 0) return;
      const frag = document.createDocumentFragment();
      for (const line of fresh) frag.append(lineNode(line));
      list.append(frag);
      rendered = rendered.concat(fresh);
      const overflow = rendered.length - logs.length;
      for (let i = 0; i < overflow; i++) list.firstElementChild?.remove();
      if (overflow > 0) rendered = rendered.slice(overflow);
      counter.textContent = `${rendered.length} lines`;
      if (autoScroll && root.classList.contains('active')) root.scrollTop = root.scrollHeight;
    },
  };
}
