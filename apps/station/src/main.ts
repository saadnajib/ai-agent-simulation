/**
 * Eternity Station client entry point. Wires the store, transport (WebSocket
 * or in-browser mock), camera, renderers and dock, then runs the frame loop.
 */
import { ROOM_IDS, ROOM_SPECS, buildStationMap, type CrewAgent, type RoomId, type StationMap } from '@eternity/core';
import { createMockTransport } from './mockState.js';
import { createNetClient, defaultWsUrl, type Transport } from './net.js';
import { beginBubblePass, drawAgentBody, drawAgentLabel, drawSpeechBubble, spriteRect, type AgentDrawInput, type SpriteRect } from './render/agents.js';
import { Camera, TILE, attachCameraControls } from './render/camera.js';
import { FxLayer, platformColour } from './render/fx.js';
import { MapLayer, Starfield, drawRoomOverlays, type RoomOverlayState } from './render/map.js';
import { StationStore, resolveAgentPosition } from './store.js';
import { createBottomBar } from './ui/bottombar.js';
import { createDock } from './ui/dock.js';
import { esc } from './ui/dom.js';
import { formatCents, formatSignedCents } from './ui/format.js';
import './style.css';

function must<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (node === null) throw new Error(`Missing element ${selector}`);
  return node;
}

interface Scratch {
  pos: { x: number; y: number; moving: boolean };
  rect: SpriteRect;
  input: AgentDrawInput;
  order: CrewAgent[];
  roomStates: Record<RoomId, RoomOverlayState>;
}

function makeScratch(): Scratch {
  const roomStates = {} as Record<RoomId, RoomOverlayState>;
  for (const id of ROOM_IDS) roomStates[id] = { status: null, hovered: false, selected: false };
  return {
    pos: { x: 0, y: 0, moving: false },
    rect: { x: 0, y: 0, w: 0, h: 0 },
    input: { agent: undefined as unknown as CrewAgent, tileX: 0, tileY: 0, moving: false, selected: false, hovered: false, speech: null, nowMs: 0 },
    order: [],
    roomStates,
  };
}

function boot(): void {
  const app = must<HTMLElement>('#app');
  const canvas = must<HTMLCanvasElement>('#stage');
  const tooltip = must<HTMLElement>('#tooltip');
  const toastHost = must<HTMLElement>('#toast-host');
  const dockRoot = must<HTMLElement>('#dock');
  const barRoot = must<HTMLElement>('#bottombar');
  const ctx = canvas.getContext('2d', { alpha: false });
  if (ctx === null) throw new Error('Canvas 2D is not available in this browser');

  const params = new URLSearchParams(location.search);
  const mock = params.get('mock') === '1';
  const map: StationMap = buildStationMap();
  const store = new StationStore();
  const camera = new Camera(map.width, map.height);
  const mapLayer = new MapLayer(map);
  const starfield = new Starfield();
  const fx = new FxLayer(map, toastHost);
  const scratch = makeScratch();

  const transport: Transport = mock
    ? createMockTransport((event) => store.apply(event))
    : createNetClient({
        url: defaultWsUrl(location),
        onEvent: (event) => store.apply(event),
        onStatus: (status) => store.setConnection(status),
      });
  if (mock) store.setConnection('mock');

  const dock = createDock(dockRoot, app, store, transport);
  const bottomBar = createBottomBar(barRoot, store, transport, {
    onToggleDock: () => dock.toggle(),
    onToggleFollow: () => store.setFollow(!store.state.ui.followSelected),
  });

  // ---------------------------------------------------------------- events
  store.on('sale', (e) => {
    const venture = store.ventureById(e.ventureId);
    const roomId = venture?.roomId ?? 'reactor';
    const centre = fx.roomCentre(roomId);
    fx.spawnFloater(centre.x, centre.y, formatSignedCents(e.netCents), platformColour(e.platform), performance.now());
  });
  store.on('milestone.reached', (e) => {
    fx.showToast(`MILESTONE ${e.label}`, `Lifetime revenue passed ${formatCents(e.cents)} at tick ${e.tick}`);
  });
  store.on('command.rejected', (e) => {
    fx.showToast('COMMAND REJECTED', e.reason);
  });

  // ---------------------------------------------------------------- sizing
  let dpr = 1;
  const resize = (): void => {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    camera.setViewport(rect.width, rect.height);
    camera.fit();
  };
  window.addEventListener('resize', resize);
  resize();

  // ------------------------------------------------------------ hit testing
  const agentAt = (sx: number, sy: number, nowMs: number): CrewAgent | null => {
    const station = store.station;
    if (station === null) return null;
    let hit: CrewAgent | null = null;
    for (const agent of station.agents) {
      resolveAgentPosition(agent, store.state.motions.get(agent.id), nowMs, scratch.pos);
      spriteRect(camera, scratch.pos.x, scratch.pos.y, scratch.rect);
      const r = scratch.rect;
      const pad = 3;
      if (sx >= r.x - pad && sx <= r.x + r.w + pad && sy >= r.y - pad && sy <= r.y + r.h + pad) hit = agent;
    }
    return hit;
  };

  const roomAtScreen = (sx: number, sy: number): RoomId | null => {
    const tile = camera.screenToTile(sx, sy);
    return mapLayer.roomAt(tile.x, tile.y);
  };

  const showTooltip = (html: string, sx: number, sy: number): void => {
    tooltip.innerHTML = html;
    tooltip.hidden = false;
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(rect.left + sx + 14, window.innerWidth - tooltip.offsetWidth - 8);
    const y = Math.min(rect.top + sy + 14, window.innerHeight - tooltip.offsetHeight - 8);
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  };

  const roomTooltip = (roomId: RoomId): string => {
    const spec = ROOM_SPECS[roomId];
    const venture = store.ventureInRoom(roomId);
    const crew = store.station?.agents.filter((a) => a.roomId === roomId).length ?? 0;
    let html = `<h4>${esc(spec.name)}</h4><p>${esc(spec.purpose)}</p><p>${crew} crew present</p>`;
    if (venture !== undefined) {
      const m = venture.metrics;
      html += `<div class="tt-venture"><b>${esc(venture.name)}</b> <span class="pill ${esc(venture.status)}">${esc(venture.status)}</span>` +
        `<div class="muted">${esc(venture.thesis)}</div>` +
        `<div class="mono">profit ${esc(formatSignedCents(m.profitCents))} · ROI ${(m.roi * 100).toFixed(0)}% · sold ${m.unitsSold}</div></div>`;
    }
    return html;
  };

  const agentTooltip = (agent: CrewAgent): string => {
    const task = store.taskById(agent.currentTaskId);
    const venture = store.ventureById(agent.ventureId);
    return `<h4>${esc(agent.name)}</h4><p>${esc(agent.role)} · ${esc(agent.status)} · ${esc(ROOM_SPECS[agent.roomId].name)}</p>` +
      (task ? `<p>${esc(task.title)}</p>` : '') +
      (venture ? `<p>${esc(venture.name)}</p>` : '') +
      `<p class="mono">cost ${esc(formatCents(agent.stats.costCents))} · attributed ${esc(formatCents(agent.stats.revenueAttributedCents))}</p>`;
  };

  attachCameraControls(canvas, camera, {
    onClick(sx, sy) {
      const agent = agentAt(sx, sy, performance.now());
      if (agent !== null) {
        store.selectAgent(store.state.ui.selectedAgentId === agent.id ? null : agent.id);
        return;
      }
      const roomId = roomAtScreen(sx, sy);
      if (roomId !== null) {
        store.selectRoom(roomId);
        if (store.state.ui.selectedRoomId !== null) dock.setTab('ventures');
      } else {
        store.selectAgent(null);
        store.clearRoomSelection();
      }
    },
    onHover(sx, sy) {
      const agent = agentAt(sx, sy, performance.now());
      const roomId = agent === null ? roomAtScreen(sx, sy) : null;
      store.setHover(roomId, agent?.id ?? null);
      if (agent !== null) showTooltip(agentTooltip(agent), sx, sy);
      else if (roomId !== null) showTooltip(roomTooltip(roomId), sx, sy);
      else tooltip.hidden = true;
    },
    onLeave() {
      tooltip.hidden = true;
      store.setHover(null, null);
    },
    onUserMove() {
      if (store.state.ui.followSelected) store.setFollow(false);
    },
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      store.selectAgent(null);
      tooltip.hidden = true;
    }
  });

  // ---------------------------------------------------------------- frame
  const updateRoomStates = (): void => {
    const ui = store.state.ui;
    for (const id of ROOM_IDS) {
      const st = scratch.roomStates[id];
      const venture = store.ventureInRoom(id);
      st.status = venture?.status ?? null;
      st.hovered = ui.hoverRoomId === id;
      st.selected = ui.selectedRoomId === id;
    }
  };

  const drawAgents = (nowMs: number): void => {
    const station = store.station;
    if (station === null) return;
    const ui = store.state.ui;
    const order = scratch.order;
    order.length = 0;
    for (const agent of station.agents) order.push(agent);
    order.sort((a, b) => a.position.y - b.position.y);
    const input = scratch.input;
    input.nowMs = nowMs;
    const pass = (draw: (c: CanvasRenderingContext2D, cam: Camera, i: AgentDrawInput, r: SpriteRect) => void): void => {
      for (const agent of order) {
        resolveAgentPosition(agent, store.state.motions.get(agent.id), nowMs, scratch.pos);
        input.agent = agent;
        input.tileX = scratch.pos.x;
        input.tileY = scratch.pos.y;
        input.moving = scratch.pos.moving;
        input.selected = ui.selectedAgentId === agent.id;
        input.hovered = ui.hoverAgentId === agent.id;
        input.speech = store.speechFor(agent.id);
        draw(ctx, camera, input, scratch.rect);
      }
    };
    pass(drawAgentBody);
    pass(drawAgentLabel);
    beginBubblePass();
    pass(drawSpeechBubble);
  };

  const followSelected = (nowMs: number): void => {
    const ui = store.state.ui;
    if (!ui.followSelected) return;
    const agent = store.agentById(ui.selectedAgentId);
    if (agent === undefined) return;
    resolveAgentPosition(agent, store.state.motions.get(agent.id), nowMs, scratch.pos);
    camera.follow((scratch.pos.x + 0.5) * TILE, (scratch.pos.y + 0.5) * TILE);
  };

  let barRevision = -1;
  const frame = (nowMs: number): void => {
    followSelected(nowMs);
    const w = camera.viewW;
    const h = camera.viewH;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    starfield.draw(ctx, w, h, camera.x, camera.y, nowMs);

    const layer = mapLayer.ensure(camera.tilePx() * dpr);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(layer, camera.x, camera.y, (map.width * mapLayer.scale) / dpr, (map.height * mapLayer.scale) / dpr);

    updateRoomStates();
    drawRoomOverlays(ctx, map, camera, scratch.roomStates, nowMs);
    const treasury = store.station?.treasury;
    fx.drawAmbient(ctx, camera, {
      nowMs,
      tick: store.tick,
      workingAgents: store.workingAgentCount(),
      dailyProfitCents: treasury?.dailyProfitCents ?? 0,
      pendingApprovals: store.pendingApprovals().length,
    });
    drawAgents(nowMs);
    fx.drawOverlay(ctx, camera, nowMs);

    dock.update(nowMs);
    if (store.state.revision !== barRevision) {
      barRevision = store.state.revision;
      bottomBar.update(store.state);
    }
    requestAnimationFrame(frame);
  };

  transport.start();
  requestAnimationFrame(frame);
}

boot();
