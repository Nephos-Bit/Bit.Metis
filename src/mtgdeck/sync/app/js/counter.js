// Lebenspunktezähler „Partie läuft“: the phone lies in the middle of the table, every player gets a panel turned
// towards their seat (layouts per player count, like the usual counter apps), tap the upper half for +1 and the
// lower half for -1 (hold to repeat), commander damage per opponent, poison, monarch and initiative, turn counter,
// dice, coin, starting player. A running game survives reloads (localStorage) and ends in the game form with
// result, turn, how it was decided, opponents and who started already filled in. Nothing touches the server
// until the game is saved there.

import { currentDeck, oppBy, oppName, shortName, state } from "./data.js";
import { gameSheet } from "./forms.js";
import { closeSheet, openSheet, presentRaw, redraw as redrawSheet, toast } from "./ui.js";
import { $, $$, esc, icon, load, save, uid, vibrate } from "./util.js";

const KEY = "amtisch.counter";
const REMATCH_HOURS = 8;
const HOLD_AFTER = 420, HOLD_EVERY = 110;  // hold a half: first repeat after 420 ms, then every 110 ms
const HISTORY_MAX = 40;
const LIFE_OPTIONS = [40, 30, 20];
// flat panel colours like Lotus; a player can pick another one in the player sheet
export const PALETTE = ["#f6c544", "#e63b4a", "#f2a6f2", "#3b43e8", "#2ec27e", "#ff8a2a", "#b86fcf", "#2b38ae", "#b38a0a", "#b3003e", "#19b6c9", "#f1f1f4"];
/** Black or white text on a colour: black on everything but the really dark ones (relative luminance). */
export function ink(hex) {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const n = parseInt(hex.slice(1), 16);
  const l = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.08 ? "ink-dark" : "ink-light";
}

// ---------- layouts: rows × cols grid, cells [row, col, rowSpan, colSpan, rotation]; 0 = facing the bottom edge,
// 180 = the top edge, -90 = the left edge, 90 = the right edge; ``mine`` = the index of my own cell. Like Lotus:
// the first one per player count is the recommended one (phone flat in the middle, everyone at their edge).
const L = (key, name, rows, cols, cells, mine) => ({ key, name, rows, cols, mine, cells: cells.map(([r, c, rs, cs, rot]) => ({ r, c, rs, cs, rot })) });
export const LAYOUTS = {
  2: [L("across", "Gegenüber", 2, 1, [[1, 1, 1, 1, 180], [2, 1, 1, 1, 0]], 1),
      L("sides", "Seitlich gegenüber", 1, 2, [[1, 1, 1, 1, -90], [1, 2, 1, 1, 90]], 1),
      L("mine", "Beide zu mir", 2, 1, [[1, 1, 1, 1, 0], [2, 1, 1, 1, 0]], 1)],
  3: [L("sides", "Zwei seitlich, ich unten", 2, 2, [[1, 1, 1, 1, -90], [1, 2, 1, 1, 90], [2, 1, 1, 2, 0]], 2),
      L("across", "Rund um den Tisch", 2, 2, [[1, 1, 1, 2, 180], [2, 1, 1, 1, -90], [2, 2, 1, 1, 0]], 2),
      L("long", "An den Längsseiten", 2, 2, [[1, 1, 2, 1, -90], [1, 2, 1, 1, 90], [2, 2, 1, 1, 90]], 2),
      L("mine", "Alle zu mir", 3, 1, [[1, 1, 1, 1, 0], [2, 1, 1, 1, 0], [3, 1, 1, 1, 0]], 2)],
  4: [L("sides", "An den Seiten", 2, 2, [[1, 1, 1, 1, -90], [1, 2, 1, 1, 90], [2, 1, 1, 1, -90], [2, 2, 1, 1, 90]], 3),
      L("across", "Zwei gegenüber, zwei bei mir", 2, 2, [[1, 1, 1, 1, 180], [1, 2, 1, 1, 180], [2, 1, 1, 1, 0], [2, 2, 1, 1, 0]], 3),
      L("corners", "Jeder an seiner Kante", 2, 2, [[1, 1, 1, 1, 180], [1, 2, 1, 1, 90], [2, 1, 1, 1, -90], [2, 2, 1, 1, 0]], 3),
      L("mine", "Alle zu mir", 2, 2, [[1, 1, 1, 1, 0], [1, 2, 1, 1, 0], [2, 1, 1, 1, 0], [2, 2, 1, 1, 0]], 3)],
  5: [L("sides", "Vier seitlich, ich unten", 3, 2, [[1, 1, 1, 1, -90], [1, 2, 1, 1, 90], [2, 1, 1, 1, -90], [2, 2, 1, 1, 90], [3, 1, 1, 2, 0]], 4),
      L("end", "Einer am Kopfende", 3, 2, [[1, 1, 1, 2, 180], [2, 1, 1, 1, -90], [2, 2, 1, 1, 90], [3, 1, 1, 1, -90], [3, 2, 1, 1, 90]], 4),
      L("across", "Rund um den Tisch", 3, 2, [[1, 1, 1, 1, 180], [1, 2, 1, 1, 180], [2, 1, 1, 1, -90], [2, 2, 1, 1, 90], [3, 1, 1, 2, 0]], 4),
      L("mine", "Alle zu mir", 3, 2, [[1, 1, 1, 1, 0], [1, 2, 1, 1, 0], [2, 1, 1, 1, 0], [2, 2, 1, 1, 0], [3, 1, 1, 2, 0]], 4)],
  6: [L("sides", "An den Seiten", 3, 2, [[1, 1, 1, 1, -90], [1, 2, 1, 1, 90], [2, 1, 1, 1, -90], [2, 2, 1, 1, 90], [3, 1, 1, 1, -90], [3, 2, 1, 1, 90]], 5),
      L("ends", "Je einer an den Kopfenden", 4, 2, [[1, 1, 1, 2, 180], [2, 1, 1, 1, -90], [2, 2, 1, 1, 90], [3, 1, 1, 1, -90], [3, 2, 1, 1, 90], [4, 1, 1, 2, 0]], 5),
      L("across", "Drei gegenüber, drei bei mir", 2, 3, [[1, 1, 1, 1, 180], [1, 2, 1, 1, 180], [1, 3, 1, 1, 180], [2, 1, 1, 1, 0], [2, 2, 1, 1, 0], [2, 3, 1, 1, 0]], 5),
      L("mine", "Alle zu mir", 3, 2, [[1, 1, 1, 1, 0], [1, 2, 1, 1, 0], [2, 1, 1, 1, 0], [2, 2, 1, 1, 0], [3, 1, 1, 1, 0], [3, 2, 1, 1, 0]], 5)],
};
const layoutOf = (c) => LAYOUTS[c.players.length].find((l) => l.key === c.layout) || LAYOUTS[c.players.length][0];

// ---------- state ----------
let c = null;           // the running game, or null
let el = null;          // the full-screen element while shown
let closeScreen = null; // closes the full screen (from presentRaw)
let hold = null;        // the running hold-to-repeat
let dmgTo = null;       // commander-damage mode: the id of the player taking the damage, or null
const deltas = new Map();  // player id → {sum, timer}

export const runningGame = () => c || (c = load(KEY, null));
const persist = () => save(KEY, c);
const alive = () => c.players.filter((p) => !p.out);
const me = () => c.players.find((p) => p.me);
const playerTitle = (p) => p.name || shortName(p.commander) || "Spieler";

function snapshot() {
  c.history.push(JSON.stringify({ players: c.players, turn: c.turn, active: c.active, monarch: c.monarch, initiative: c.initiative }));
  if (c.history.length > HISTORY_MAX) c.history.shift();
}
function undoLast() {
  const last = c.history.pop();
  if (!last) { toast("Nichts zum Zurücknehmen"); return false; }
  Object.assign(c, JSON.parse(last));
  persist();
  return true;
}

// ---------- setup ----------
function defaultOpponents() {
  const last = state.snap.games[0];
  if (last && Date.now() - new Date(last.played).getTime() < REMATCH_HOURS * 3600e3) {
    return (last.opponent_ids || []).map((id, i) => ({ id, commander: last.opponents?.[i] || oppBy(id)?.commanders?.[0] || "" })).filter((o) => o.id || o.commander);
  }
  return [];
}
let setup = null;

/** The setup sheet: who plays, how the panels lie, starting life. Ends in the full-screen counter. */
export function startCounter() {
  if (runningGame()) return resumeCounter();
  const deck = currentDeck();
  setup = { deck: deck?.slug || null, opps: defaultOpponents(), life: 40, layout: null, seat: null, random: true };
  openSheet(setupPage, { full: false });
}

function setupPage({ push }) {
  const count = setup.opps.length + 1;
  const layouts = LAYOUTS[Math.min(Math.max(count, 2), 6)];
  if (!layouts.some((l) => l.key === setup.layout)) { setup.layout = layouts[0].key; setup.seat = null; }
  const deck = state.snap.decks.find((d) => d.slug === setup.deck);
  const recent = recentOpponents().filter((o) => !setup.opps.some((x) => x.id === o.id)).slice(0, 8);
  return {
    title: "Partie starten",
    body: `
      <p class="hint-small">Das Handy liegt in der Mitte, jedes Feld zeigt zu seinem Spieler. Oben + und unten − tippen, gedrückt halten zählt weiter.</p>
      <div class="field-label">Mitspieler <span class="hint">${count} am Tisch</span></div>
      <div class="chips" id="lc-opps">
        <span class="chip me">${icon("table", "xs")} ${esc(deck ? shortName(deck.commanders[0]) : "Ich")}</span>
        ${setup.opps.map((o, i) => `<button class="chip on" type="button" data-remove="${i}" aria-label="${esc(shortName(o.commander))} entfernen">${esc(shortName(o.commander || oppName(oppBy(o.id))))} ${icon("x", "xs")}</button>`).join("")}
        ${count < 6 ? `<button class="chip add" type="button" id="lc-add">${icon("plus")}Gegner</button>` : ""}
      </div>
      ${recent.length && count < 6 ? `<div class="chips scroll" id="lc-recent">${recent.map((o) => `<button class="chip" type="button" data-pick="${esc(o.id)}">${esc(shortName(o.commanders[0] || oppName(o)))}</button>`).join("")}</div>` : ""}
      <div class="field-label">Anordnung <span class="hint">tipp auf das Feld, wo du sitzt</span></div>
      ${galleryHtml(layouts, setup.layout, setup.seat)}
      <div class="field-label">Startleben</div>
      <div class="chips" id="lc-life">${LIFE_OPTIONS.map((n) => `<button class="chip" type="button" data-life="${n}" aria-pressed="${setup.life === n}">${n}</button>`).join("")}</div>
      <label class="toggle-row"><span class="main"><span class="title">Startspieler auslosen</span></span><input type="checkbox" id="lc-random" ${setup.random ? "checked" : ""}></label>`,
    foot: `<button class="btn primary big" type="button" id="lc-start" ${count >= 2 ? "" : "disabled"}>${count >= 2 ? "Los geht’s" : "Mindestens einen Gegner wählen"}</button>`,
    bind(root) {
      for (const b of $$("[data-remove]", root)) b.addEventListener("click", () => { setup.opps.splice(Number(b.dataset.remove), 1); redrawSheet(); });
      for (const b of $$("[data-pick]", root)) b.addEventListener("click", () => { const o = oppBy(b.dataset.pick); setup.opps.push({ id: o.id, commander: o.commanders[0] || "" }); vibrate(); redrawSheet(); });
      $("#lc-add", root)?.addEventListener("click", () => push(pickPage));
      for (const b of $$("[data-seat]", root)) b.addEventListener("click", () => { setup.layout = b.dataset.layout; setup.seat = Number(b.dataset.seat); vibrate(); redrawSheet(); });
      for (const b of $$("[data-life]", root)) b.addEventListener("click", () => { setup.life = Number(b.dataset.life); redrawSheet(); });
      $("#lc-random", root).addEventListener("change", (e) => { setup.random = e.target.checked; });
      $("#lc-start", root).addEventListener("click", () => { begin(); });
      paintGrid(root);
    },
  };
}

function recentOpponents() {
  const seen = new Map();
  for (const g of state.snap.games) for (const id of g.opponent_ids || []) if (!seen.has(id) && oppBy(id)) seen.set(id, oppBy(id));
  for (const o of state.snap.opponents) if (!seen.has(o.id)) seen.set(o.id, o);
  return [...seen.values()];
}

function pickPage({ pop }) {
  let q = "";
  const list = () => recentOpponents().filter((o) => !setup.opps.some((x) => x.id === o.id)).filter((o) => !q || `${oppName(o)} ${o.player || ""}`.toLowerCase().includes(q.toLowerCase()));
  return {
    title: "Gegner wählen",
    back: pop,
    body: `<div class="search">${icon("search")}<input class="input" type="search" id="lc-q" placeholder="Commander oder Spieler" autocomplete="off"></div>
      <div class="group" id="lc-pick-list">${pickRows(list())}</div>
      <p class="hint-small">Jemand ohne Gegnerdeck? Unten eintragen – er bekommt ein Feld ohne Namen.</p>
      <div class="chips"><button class="chip" type="button" id="lc-anon">${icon("plus")}Unbekannter Spieler</button></div>`,
    bind(root) {
      const bindRows = () => { for (const b of $$("[data-pick]", root)) b.addEventListener("click", () => { const o = oppBy(b.dataset.pick); setup.opps.push({ id: o.id, commander: o.commanders[0] || "" }); vibrate(); pop(); }); };
      bindRows();
      $("#lc-q", root).addEventListener("input", (e) => { q = e.target.value; $("#lc-pick-list", root).innerHTML = pickRows(list()); bindRows(); });
      $("#lc-anon", root).addEventListener("click", () => { setup.opps.push({ id: null, commander: "" }); pop(); });
    },
  };
}
const pickRows = (opps) => opps.length ? opps.map((o) => `<button class="row" type="button" data-pick="${esc(o.id)}">
    <span class="main"><span class="title">${esc(shortName(o.commanders[0] || oppName(o)))}</span><span class="subtitle">${esc([o.player, o.commanders.join(" + ")].filter(Boolean).join(" · "))}</span></span>${icon("chev-r", "sm chev")}</button>`).join("")
  : `<p class="hint-small">Keine Gegnerdecks – trag welche unter „Gegner“ ein.</p>`;

/** The layout gallery: one mini grid per layout, the bar marks the edge a player sits at, my cell is coloured. */
function galleryHtml(layouts, selected, seat) {
  return `<div class="lc-gallery">${layouts.map((l) => `<div class="lc-mini ${selected === l.key ? "selected" : ""}" role="group" aria-label="${esc(l.name)}" data-grid="${l.rows} ${l.cols}">${
    assignCells(l, selected === l.key ? seat : null).map((cell, i) => `<button class="lc-seat ${cell.mine && selected === l.key ? "me" : ""}" type="button" data-layout="${l.key}" data-seat="${i}" data-area="${area(cell)}" data-rot="${cell.rot}" aria-label="${esc(l.name)}, Platz ${i + 1}">${cell.mine && selected === l.key ? "ich" : ""}</button>`).join("")}</div>`).join("")}</div>
  <p class="hint-small lc-gallery-name">${esc(layouts.find((l) => l.key === selected)?.name || "")}</p>`;
}

/** Where a cell's player sits, as an angle around the table (screen coordinates: increasing = clockwise). */
function seatAngle(cell, layout) {
  const cx = (cell.c - 1 + cell.cs / 2) / layout.cols, cy = (cell.r - 1 + cell.rs / 2) / layout.rows;
  const [sx, sy] = cell.rot === 0 ? [cx, 1.3] : cell.rot === 180 ? [cx, -0.3] : cell.rot === -90 ? [-0.3, cy] : [1.3, cy];
  return Math.atan2(sy - 0.5, sx - 0.5);
}

/** Cells with ``seat``: 0 = me, then the opponents clockwise around the table from my seat. */
function assignCells(layout, seat = null) {
  const cells = layout.cells.map((x) => ({ ...x }));
  const mine = cells[Number.isInteger(seat) && seat >= 0 && seat < cells.length ? seat : layout.mine];
  mine.mine = true;
  mine.seat = 0;
  const a0 = seatAngle(mine, layout);
  cells.filter((x) => !x.mine)
    .map((x) => ({ x, a: (seatAngle(x, layout) - a0 + 4 * Math.PI) % (2 * Math.PI) }))
    .sort((p, q) => p.a - q.a)
    .forEach((o, i) => { o.x.seat = i + 1; });
  return cells;
}

function begin() {
  const deck = state.snap.decks.find((d) => d.slug === setup.deck);
  const mine = { id: uid(), me: true, oppId: null, name: deck?.name || "Ich", commander: deck?.commanders?.[0] || "", colors: deck?.colors || "" };
  const others = setup.opps.map((o, i) => {
    const opp = o.id ? oppBy(o.id) : null;
    return { id: uid(), me: false, oppId: o.id, name: opp?.player ? opp.player : (opp ? "" : `Spieler ${i + 2}`), commander: o.commander || opp?.commanders?.[0] || "", colors: opp?.colors || "" };
  });
  const players = [mine, ...others].map((p, i) => ({ ...p, color: PALETTE[i % PALETTE.length], life: setup.life, poison: 0, dmg: {}, out: null, outBy: null }));
  c = { id: uid(), deck: setup.deck, started: new Date().toISOString(), life: setup.life, layout: setup.layout, seat: setup.seat, turn: 1, active: 0, monarch: null, initiative: null, players, history: [], outs: 0 };
  if (setup.random) c.active = Math.floor(Math.random() * players.length);
  c.starter = c.active;
  closeSheet();
  persist();
  show();
  if (setup.random) setTimeout(() => toast(`${playerTitle(players[c.active])} fängt an`, { ok: true }), 350);
}

// ---------- the full screen ----------
export function resumeCounter() {
  if (!runningGame()) return startCounter();
  show();
}

function show() {
  closeScreen = presentRaw(render(), {
    bind(root) { el = root; bindAll(); fit(); },
    onClose() { stopHold(); el = null; closeScreen = null; },
  });
}

function render() {
  const layout = layoutOf(c);
  const cells = assignCells(layout, c.seat);
  const order = [c.players.find((p) => p.me), ...c.players.filter((p) => !p.me)];
  const panels = cells.map((cell) => ({ cell, p: order[cell.seat] }));
  const menu = dmgTo
    ? `<button class="lc-menu dmg" type="button" id="lc-menu" aria-label="Zurück zum Spiel">${icon("sword")}</button>`
    : `<button class="lc-menu" type="button" id="lc-menu" aria-label="Menü: Zug, Würfel, Partie beenden">${icon("sliders")}<span class="lc-turn">${c.turn}</span></button>`;
  return `<div class="lc ${dmgTo ? "dmg-mode" : ""}" data-grid="${layout.rows} ${layout.cols}">
    ${panels.map(({ cell, p }) => `<div class="lc-cell" data-area="${area(cell)}" data-rot="${cell.rot}" data-cell="${p.id}">${pad(p)}</div>`).join("")}
    ${menu}
  </div>`;
}

/** Commander-damage mode (like Lotus): the hit player's panel says so, every other panel counts the damage its
 *  commander has dealt to them – plus/minus like life, and the life goes down with it. */
function dmgPad(p) {
  const to = c.players.find((x) => x.id === dmgTo);
  if (p.id === dmgTo) return `<div class="lc-pad receiver ink-light" data-p="${p.id}" data-color="#2a2a35">
    <div class="lc-face">
      <div class="lc-big">Commander-Schaden</div>
      <div class="lc-sub">den ${esc(playerTitle(p))} bekommen hat · Leben <b data-rlife>${p.life}</b></div>
      <button class="btn pill" type="button" data-dmg-back>Zurück zum Spiel</button>
    </div>
  </div>`;
  const n = to.dmg[p.id] || 0;
  const who = shortName(p.commander) || playerTitle(p);
  return `<div class="lc-pad dmg ink-light ${n >= 21 ? "lethal" : ""}" data-p="${p.id}" data-color="${esc(color(p))}">
    <button class="lc-half plus" type="button" data-dmg-step="1" data-src="${p.id}" aria-label="Schaden von ${esc(who)}: plus eins"></button>
    <button class="lc-half minus" type="button" data-dmg-step="-1" data-src="${p.id}" aria-label="Schaden von ${esc(who)}: minus eins"></button>
    <div class="lc-face">
      <div class="lc-name static">${icon("sword", "xs")}${esc(who)}</div>
      <div class="lc-life" data-dmgval="${p.id}">${n}</div>
      <div class="lc-delta" data-delta="dmg-${p.id}" hidden></div>
      <div class="lc-sub">von 21</div>
    </div>
  </div>`;
}

const color = (p) => p.color || PALETTE[c.players.indexOf(p) % PALETTE.length];

function pad(p) {
  if (dmgTo && (p.id === dmgTo || !p.out)) return dmgPad(p);
  const dmgSum = Object.values(p.dmg).reduce((a, b) => a + b, 0);
  const active = c.players[c.active]?.id === p.id;
  return `<div class="lc-pad ${ink(color(p))} ${p.out ? "out" : ""} ${active ? "active" : ""}" data-p="${p.id}" data-color="${esc(color(p))}">
    <button class="lc-half plus" type="button" data-life="1" data-p="${p.id}" aria-label="${esc(playerTitle(p))}: plus eins"></button>
    <button class="lc-half minus" type="button" data-life="-1" data-p="${p.id}" aria-label="${esc(playerTitle(p))}: minus eins"></button>
    <div class="lc-face">
      <button class="lc-name" type="button" data-player="${p.id}">${c.monarch === p.id ? icon("crown", "xs") : ""}${c.initiative === p.id ? icon("flag", "xs") : ""}${esc(playerTitle(p))}${p.me ? "" : p.commander && p.name ? ` <small>${esc(shortName(p.commander))}</small>` : ""}</button>
      <div class="lc-life">${p.life}</div>
      <div class="lc-delta" data-delta="${p.id}" hidden></div>
      <div class="lc-chips">
        <button class="lc-chip ${dmgSum ? "on" : ""}" type="button" data-dmg="${p.id}" aria-label="Commander-Schaden">${icon("sword", "xs")}${dmgSum || ""}</button>
        <button class="lc-chip ${p.poison ? "on" : ""}" type="button" data-poison="${p.id}" aria-label="Gift">${icon("skull", "xs")}${p.poison || ""}</button>
      </div>
    </div>
    ${p.out ? `<div class="lc-outlay">${p.outBy === "poison" ? "vergiftet" : p.outBy === "commander" ? "Commander-Schaden" : "raus"}<small>tippen = zurück</small></div>` : ""}
  </div>`;
}

/** Grid placement and panel colours via CSSOM (the app's CSP allows no inline styles). */
function paintGrid(root) {
  for (const g of $$("[data-grid]", root)) {
    const [rows, cols] = g.dataset.grid.split(" ");
    g.style.setProperty("--rows", rows);
    g.style.setProperty("--cols", cols);
  }
  for (const x of $$("[data-area]", root)) x.style.gridArea = x.dataset.area;
  for (const x of $$("[data-color]", root)) x.style.background = x.dataset.color;
}
const area = (cell) => `${cell.r} / ${cell.c} / span ${cell.rs} / span ${cell.cs}`;

/** Size the panels: a cell's pad is rotated into it, so for ±90° width and height swap. */
function fit() {
  if (!el) return;
  paintGrid(el);
  for (const cell of $$(".lc-cell", el)) {
    const w = cell.clientWidth, h = cell.clientHeight, rot = Number(cell.dataset.rot);
    const pad = cell.firstElementChild;
    const [pw, ph] = Math.abs(rot) === 90 ? [h, w] : [w, h];
    pad.style.setProperty("--pw", `${pw - 6}px`);
    pad.style.setProperty("--ph", `${ph - 6}px`);
    pad.style.setProperty("--rot", `${rot}deg`);
    pad.classList.toggle("wide", pw > ph * 1.3);  // a flat panel: name, number and chips side by side
  }
}
addEventListener("resize", () => fit());

function rerender() {
  if (!el) return;
  stopHold();
  el.innerHTML = render();
  bindAll();
  fit();
}

function bindAll() {
  const holdable = (b, run) => {
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); startHold(run); });
    for (const ev of ["pointerup", "pointercancel", "pointerleave"]) b.addEventListener(ev, stopHold);
    b.addEventListener("contextmenu", (e) => e.preventDefault());
  };
  for (const b of $$("[data-life]", el)) holdable(b, () => {
    const p = c.players.find((x) => x.id === b.dataset.p);
    if (!p || p.out) return;
    snapshotOnce(p.id);
    change(p, Number(b.dataset.life));
  });
  for (const b of $$("[data-dmg-step]", el)) holdable(b, () => changeDmg(b.dataset.src, Number(b.dataset.dmgStep)));
  for (const b of $$("[data-dmg-back]", el)) b.addEventListener("click", leaveDmg);
  for (const b of $$("[data-player]", el)) b.addEventListener("click", () => playerSheet(b.dataset.player));
  for (const b of $$("[data-dmg]", el)) b.addEventListener("click", () => enterDmg(b.dataset.dmg));
  for (const b of $$("[data-poison]", el)) b.addEventListener("click", () => poisonSheet(b.dataset.poison));
  for (const pad of $$(".lc-pad.out", el)) pad.addEventListener("click", (e) => { if (!e.target.closest("button")) revive(pad.dataset.p); });
  $("#lc-menu", el).addEventListener("click", () => (dmgTo ? leaveDmg() : menuSheet()));
}

// ---------- life: tap and hold ----------
function startHold(run) {
  stopHold();
  run();
  hold = { timer: setTimeout(function tick() { run(); hold.timer = setTimeout(tick, HOLD_EVERY); }, HOLD_AFTER) };
}
function stopHold() { if (hold) { clearTimeout(hold.timer); hold = null; } }

const bursts = new Map();  // one undo step per burst of taps on a player
function snapshotOnce(pid) {
  if (bursts.has(pid)) { clearTimeout(bursts.get(pid)); } else snapshot();
  bursts.set(pid, setTimeout(() => bursts.delete(pid), 1500));
}

function change(p, step) {
  p.life += step;
  vibrate(6);
  updateLife(p);
  showDelta(p.id, step);
  checkOut(p);
  persist();
}
function updateLife(p) {
  const pad = el?.querySelector(`.lc-pad[data-p="${p.id}"]`);
  if (pad) pad.querySelector(".lc-life").textContent = p.life;
}
function showDelta(pid, step) {
  const d = deltas.get(pid) || { sum: 0, timer: null };
  d.sum += step;
  clearTimeout(d.timer);
  const node = el?.querySelector(`[data-delta="${pid}"]`);
  if (node) { node.textContent = (d.sum > 0 ? "+" : "") + d.sum; node.hidden = false; }
  d.timer = setTimeout(() => { deltas.delete(pid); if (node) node.hidden = true; }, 1400);
  deltas.set(pid, d);
}

function checkOut(p) {
  if (p.out) return;
  const by = p.life <= 0 ? "life" : p.poison >= 10 ? "poison" : Object.values(p.dmg).some((n) => n >= 21) ? "commander" : null;
  if (!by) return;
  p.out = ++c.outs;
  p.outBy = by;
  vibrate(30);
  if (c.players[c.active]?.id === p.id) nextActive();
  persist();
  rerender();
  const left = alive();
  if (left.length === 1) setTimeout(() => toast(`${playerTitle(left[0])} hat gewonnen?`, { action: { label: "Partie beenden", run: finishSheet }, ms: 8000 }), 250);
}
function revive(pid) {
  const p = c.players.find((x) => x.id === pid);
  snapshot();
  p.out = null; p.outBy = null;
  if (p.life <= 0) p.life = 1;
  if (p.poison >= 10) p.poison = 9;
  for (const k of Object.keys(p.dmg)) if (p.dmg[k] >= 21) p.dmg[k] = 20;
  persist();
  rerender();
}
function nextActive() {
  const n = c.players.length;
  for (let i = 1; i <= n; i++) { const j = (c.active + i) % n; if (!c.players[j].out) { c.active = j; return; } }
}

// ---------- sheets on top of the counter ----------
function playerSheet(pid) {
  const p = c.players.find((x) => x.id === pid);
  openSheet(() => ({
    title: playerTitle(p),
    body: `
      <div class="group">
        <button class="row" type="button" id="lc-monarch"><span class="res draw" aria-hidden="true">${icon("crown", "sm")}</span><span class="main"><span class="title">Monarch</span><span class="subtitle">${c.monarch === pid ? "hat die Krone" : c.monarch ? `${esc(playerTitle(c.players.find((x) => x.id === c.monarch)))} hat sie` : "niemand"}</span></span><span class="trail">${c.monarch === pid ? icon("check", "sm") : ""}</span></button>
        <button class="row" type="button" id="lc-init"><span class="res win" aria-hidden="true">${icon("flag", "sm")}</span><span class="main"><span class="title">Initiative</span><span class="subtitle">${c.initiative === pid ? "hat sie" : "niemand / jemand anders"}</span></span><span class="trail">${c.initiative === pid ? icon("check", "sm") : ""}</span></button>
        <button class="row" type="button" id="lc-active"><span class="res ai" aria-hidden="true">${icon("clock", "sm")}</span><span class="main"><span class="title">Ist am Zug</span><span class="subtitle">${c.players[c.active]?.id === pid ? "jetzt dran" : "als aktiven Spieler setzen"}</span></span></button>
        <button class="row" type="button" id="lc-set-life"><span class="res draw" aria-hidden="true">${icon("edit", "sm")}</span><span class="main"><span class="title">Leben setzen</span><span class="subtitle">${p.life} – genauen Wert eintippen</span></span></button>
        ${p.out ? `<button class="row" type="button" id="lc-revive"><span class="res win" aria-hidden="true">${icon("plus", "sm")}</span><span class="main"><span class="title">Zurück ins Spiel</span></span></button>`
          : `<button class="row" type="button" id="lc-out"><span class="res loss" aria-hidden="true">${icon("x", "sm")}</span><span class="main"><span class="title">Ausgeschieden</span><span class="subtitle">aufgegeben, Combo, alternative Siegbedingung</span></span></button>`}
      </div>
      <div class="field-label">Farbe des Felds</div>
      <div class="lc-swatches">${PALETTE.map((h) => `<button class="lc-swatch" type="button" data-color="${h}" data-pick-color="${h}" aria-pressed="${color(p) === h}" aria-label="Farbe ${h}"></button>`).join("")}</div>`,
    bind(root) {
      paintGrid(root);
      for (const b of $$("[data-pick-color]", root)) b.addEventListener("click", () => { p.color = b.dataset.pickColor; vibrate(); persist(); rerender(); redrawSheet(); });
      $("#lc-monarch", root).addEventListener("click", () => { snapshot(); c.monarch = c.monarch === pid ? null : pid; done(); });
      $("#lc-init", root).addEventListener("click", () => { snapshot(); c.initiative = c.initiative === pid ? null : pid; done(); });
      $("#lc-active", root).addEventListener("click", () => { c.active = c.players.indexOf(p); done(); });
      $("#lc-set-life", root).addEventListener("click", () => { closeSheet(); setTimeout(() => lifeSheet(pid), 260); });
      $("#lc-revive", root)?.addEventListener("click", () => { closeSheet(); revive(pid); });
      $("#lc-out", root)?.addEventListener("click", () => { snapshot(); p.out = ++c.outs; p.outBy = "other"; if (c.players[c.active]?.id === pid) nextActive(); done(); });
    },
  }));
  const done = () => { persist(); closeSheet(); rerender(); };
}

function lifeSheet(pid) {
  const p = c.players.find((x) => x.id === pid);
  openSheet(() => ({
    title: `Leben von ${playerTitle(p)}`,
    body: `<div class="lc-stepper big"><button class="btn" type="button" data-step="-5" aria-label="fünf weniger">−5</button><button class="btn" type="button" data-step="-1" aria-label="eins weniger">−</button><b id="lc-lv">${p.life}</b><button class="btn" type="button" data-step="1" aria-label="eins mehr">+</button><button class="btn" type="button" data-step="5" aria-label="fünf mehr">+5</button></div>
      <div class="chips center">${[c.life, 20, 10, 1].map((n) => `<button class="chip" type="button" data-set="${n}">${n}</button>`).join("")}</div>`,
    foot: `<button class="btn primary big" type="button" id="lc-done">Fertig</button>`,
    bind(root) {
      snapshot();
      const showv = () => { $("#lc-lv", root).textContent = p.life; persist(); };
      for (const b of $$("[data-step]", root)) b.addEventListener("click", () => { p.life += Number(b.dataset.step); vibrate(6); showv(); });
      for (const b of $$("[data-set]", root)) b.addEventListener("click", () => { p.life = Number(b.dataset.set); vibrate(6); showv(); });
      $("#lc-done", root).addEventListener("click", () => { closeSheet(); checkOut(p); rerender(); });
    },
  }));
}

function enterDmg(pid) {
  const p = c.players.find((x) => x.id === pid);
  if (!p || p.out) return;
  snapshot();
  dmgTo = pid;
  rerender();
}
function leaveDmg() {
  const to = c.players.find((x) => x.id === dmgTo);
  dmgTo = null;
  rerender();
  if (to) checkOut(to);
}
function changeDmg(src, step) {
  const to = c.players.find((x) => x.id === dmgTo);
  if (!to) return;
  const next = Math.max(0, (to.dmg[src] || 0) + step);
  const applied = next - (to.dmg[src] || 0);
  if (!applied) return;
  to.dmg[src] = next;
  to.life -= applied;
  vibrate(6);
  const val = el?.querySelector(`[data-dmgval="${src}"]`);
  if (val) { val.textContent = next; val.closest(".lc-pad").classList.toggle("lethal", next >= 21); }
  const life = el?.querySelector("[data-rlife]");
  if (life) life.textContent = to.life;
  showDelta(`dmg-${src}`, applied);
  persist();
  if (next >= 21 || to.life <= 0) { stopHold(); leaveDmg(); }
}

function poisonSheet(pid) {
  const p = c.players.find((x) => x.id === pid);
  openSheet(() => ({
    title: `Gift bei ${playerTitle(p)}`,
    body: `<p class="hint-small">Zehn Giftmarken = raus.</p>
      <div class="lc-stepper big"><button class="btn" type="button" data-step="-1" aria-label="weniger">−</button><b id="lc-pv">${p.poison}</b><button class="btn" type="button" data-step="1" aria-label="mehr">+</button></div>`,
    foot: `<button class="btn primary big" type="button" id="lc-done">Fertig</button>`,
    bind(root) {
      snapshot();
      for (const b of $$("[data-step]", root)) b.addEventListener("click", () => { p.poison = Math.max(0, p.poison + Number(b.dataset.step)); vibrate(6); $("#lc-pv", root).textContent = p.poison; persist(); });
      $("#lc-done", root).addEventListener("click", () => { closeSheet(); checkOut(p); rerender(); });
    },
  }));
}

function menuSheet() {
  const act = c.players[c.active];
  openSheet(() => ({
    title: `Zug ${c.turn}`,
    body: `
      <div class="group">
        <button class="row" type="button" id="lc-next"><span class="res win" aria-hidden="true">${icon("chev-r", "sm")}</span><span class="main"><span class="title">Nächster Zug</span><span class="subtitle">${act ? `${esc(playerTitle(act))} ist dran` : ""}</span></span></button>
        <button class="row" type="button" id="lc-undo"><span class="res draw" aria-hidden="true">${icon("swap", "sm")}</span><span class="main"><span class="title">Rückgängig</span><span class="subtitle">${c.history.length ? `${c.history.length} Schritte` : "nichts"}</span></span></button>
      </div>
      <div class="field-label">Zufall</div>
      <div class="chips"><button class="chip" type="button" data-roll="6">${icon("dice", "xs")} W6</button><button class="chip" type="button" data-roll="20">${icon("dice", "xs")} W20</button><button class="chip" type="button" data-roll="2">Münze</button><button class="chip" type="button" id="lc-draw">Startspieler</button></div>
      <p class="lc-roll" id="lc-roll" hidden></p>
      <div class="field-label">Partie</div>
      <div class="group">
        <button class="row" type="button" id="lc-finish"><span class="res win" aria-hidden="true">${icon("trophy", "sm")}</span><span class="main"><span class="title">Partie beenden</span><span class="subtitle">Ergebnis prüfen und eintragen</span></span></button>
        <button class="row" type="button" id="lc-layout"><span class="res draw" aria-hidden="true">${icon("table", "sm")}</span><span class="main"><span class="title">Anordnung</span><span class="subtitle">${esc(layoutOf(c).name)}</span></span></button>
        <button class="row" type="button" id="lc-abort"><span class="res loss" aria-hidden="true">${icon("trash", "sm")}</span><span class="main"><span class="title">Verwerfen</span><span class="subtitle">ohne Eintrag beenden</span></span></button>
      </div>`,
    bind(root) {
      $("#lc-next", root).addEventListener("click", () => { snapshot(); c.turn++; nextActive(); persist(); closeSheet(); rerender(); });
      $("#lc-undo", root).addEventListener("click", () => { if (undoLast()) { closeSheet(); rerender(); } });
      for (const b of $$("[data-roll]", root)) b.addEventListener("click", () => {
        const n = Number(b.dataset.roll), r = 1 + Math.floor(Math.random() * n);
        const out = $("#lc-roll", root);
        out.hidden = false; out.textContent = n === 2 ? (r === 1 ? "Kopf" : "Zahl") : `${r}`;
        vibrate(10);
      });
      $("#lc-draw", root).addEventListener("click", () => {
        const pool = alive(); const pick = pool[Math.floor(Math.random() * pool.length)];
        c.active = c.players.indexOf(pick); c.starter = c.active; persist();
        const out = $("#lc-roll", root); out.hidden = false; out.textContent = `${playerTitle(pick)} fängt an`;
        vibrate(10);
      });
      $("#lc-finish", root).addEventListener("click", () => { closeSheet(); setTimeout(finishSheet, 260); });
      $("#lc-layout", root).addEventListener("click", () => { closeSheet(); setTimeout(layoutSheet, 260); });
      $("#lc-abort", root).addEventListener("click", () => { closeSheet(); setTimeout(abortSheet, 260); });
    },
  }));
}

function abortSheet() {
  openSheet(() => ({
    title: "Partie verwerfen?",
    body: `<p class="hint-small">Der Zähler wird geleert, nichts wird eingetragen. Zum Eintragen stattdessen „Partie beenden“ wählen.</p>`,
    foot: `<button class="btn danger big" type="button" id="lc-abort-yes">Verwerfen</button>`,
    bind(root) { $("#lc-abort-yes", root).addEventListener("click", () => { closeSheet(); end(); }); },
  }));
}

function layoutSheet() {
  const layouts = LAYOUTS[c.players.length];
  openSheet(() => ({
    title: "Anordnung",
    body: `<p class="hint-small">Tipp auf das Feld, wo du sitzt.</p>${galleryHtml(layouts, layoutOf(c).key, c.seat)}`,
    bind(root) {
      for (const b of $$("[data-seat]", root)) b.addEventListener("click", () => { c.layout = b.dataset.layout; c.seat = Number(b.dataset.seat); persist(); closeSheet(); rerender(); });
      paintGrid(root);
    },
  }));
}

/** Who won, how, and over to the game form with everything filled in. */
function finishSheet() {
  const my = me();
  const left = alive();
  const opps = c.players.filter((p) => !p.me);
  const suggested = my.out ? "loss" : left.length === 1 && left[0].me ? "win" : left.length <= 1 ? "draw" : null;
  const lastOut = c.players.filter((p) => p.out).sort((a, b) => b.out - a.out)[0];
  const how = my.out ? ({ commander: "commander", poison: "alt", life: "combat", other: "other" })[my.outBy] || null
    : suggested === "win" && lastOut ? ({ commander: "commander", poison: "alt", life: "combat", other: "other" })[lastOut.outBy] || null : null;
  let result = suggested;
  openSheet(() => ({
    title: "Partie beenden",
    body: `
      <p class="hint-small">${left.length > 1 ? `${left.length} Spieler sind noch drin – wie ist es ausgegangen?` : suggested === "win" ? "Du bist als Letzter übrig." : suggested === "loss" ? "Du bist ausgeschieden." : "Niemand mehr drin – Remis?"}</p>
      <div class="segmented result" role="radiogroup">${["win", "loss", "draw"].map((r) => `<button type="button" role="radio" data-v="${r}" aria-pressed="${result === r}">${({ win: "Sieg", loss: "Niederlage", draw: "Remis" })[r]}</button>`).join("")}</div>
      <p class="hint-small">Zug ${c.turn} · ${opps.length} Gegner · Startspieler ${esc(playerTitle(c.players[startIndex()]))} – das Formular öffnet sich vorausgefüllt, du ergänzt nur noch, was dir auffiel.</p>`,
    foot: `<button class="btn primary big" type="button" id="lc-go" ${result ? "" : "disabled"}>Eintragen</button>`,
    bind(root) {
      for (const b of $$("[data-v]", root)) b.addEventListener("click", () => { result = b.dataset.v; for (const x of $$("[data-v]", root)) x.setAttribute("aria-pressed", String(x === b)); $("#lc-go", root).disabled = false; });
      $("#lc-go", root).addEventListener("click", () => {
        const start = startIndex();
        const prefill = {
          deck: c.deck, result, turn: Math.min(Math.max(c.turn, 3), 20), how,
          opps: opps.map((p) => ({ id: p.oppId, commander: p.commander })),
          started: c.players[start].me ? "me" : String(opps.indexOf(c.players[start])),
          note: "",
        };
        closeSheet();
        end();
        setTimeout(() => gameSheet(prefill), 320);
      });
    },
  }));
}
const startIndex = () => (typeof c.starter === "number" ? c.starter : c.active);

function end() {
  c = null;
  save(KEY, null);
  stopHold();
  dmgTo = null;
  closeScreen?.();
}
