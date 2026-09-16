/**
 * Election Map Studio v6.0
 * Wikipedia Style Election Result & Statistical Map Generator
 */

const SVG_W = 1440, SVG_H = 900;
const svg = d3.select("#map");
const rootGroup = svg.append("g").attr("id", "rootLayer");
const mapGroup = rootGroup.append("g").attr("id", "mapLayer");
const polyLayer = mapGroup.append("g").attr("id", "polyLayer");
const ballLayer = mapGroup.append("g").attr("id", "ballLayer");
const textLayer = mapGroup.append("g").attr("id", "textLayer");
const prPanelGroup = rootGroup.append("g").attr("id", "prPanelGroup");
const legendGroup = rootGroup.append("g").attr("id", "legendGroup");
const headerGroup = rootGroup.append("g").attr("id", "headerGroup");

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

let parties = [];
let geoData = null;
let districts = {};
let prBlocks = [];
let selectedDistrictId = null;
let collapsedDistrictIds = new Set();
let currentPreset = "parallel-shugiin";
let projection = null;
let pathGenerator = null;
let isDirty = false;
let historyStack = [];
let futureStack = [];
let isHistoryLocked = false;
let dataIndex = { maps: [], projects: [] };

const SAMPLE_DISTRICT_VOTES = {
  "OK-1": {
    name: "??1?",
    candidates: [
      { name: "?? ??", party: "ldp", votes: 85210 },
      { name: "?? ??", party: "cdp", votes: 64130 },
      { name: "?? ??", party: "jcp", votes: 12050 }
    ]
  },
  "OK-2": {
    name: "??2?",
    candidates: [
      { name: "?? ??", party: "ldp", votes: 78540 },
      { name: "?? ??", party: "cdp", votes: 71220 },
      { name: "?? ??", party: "ishin", votes: 18450 }
    ]
  },
  "OK-3": {
    name: "??3?",
    candidates: [
      { name: "?? ??", party: "ldp", votes: 91400 },
      { name: "?? ??", party: "cdp", votes: 38200 },
      { name: "?? ??", party: "jcp", votes: 8900 }
    ]
  },
  "OK-4": {
    name: "??4?",
    candidates: [
      { name: "?? ??", party: "cdp", votes: 83500 },
      { name: "?? ?", party: "ldp", votes: 79200 }
    ]
  },
  "OK-5": {
    name: "??5?",
    candidates: [
      { name: "?? ??", party: "ldp", votes: 71000 },
      { name: "?? ???", party: "cdp", votes: 48500 },
      { name: "?? ??", party: "ind", votes: 15300 }
    ]
  }
};

const SAMPLE_PR_BLOCKS = [
  {
    id: "pr-chugoku",
    name: "????????",
    seats: 11,
    allocationMethod: "dhondt",
    mode: "votes",
    votes: {
      ldp: 865000,
      cdp: 462000,
      komei: 278000,
      ishin: 231000,
      dpp: 195000,
      jcp: 112000,
      reiwa: 98000
    },
    shares: {}
  }
];

const PRESETS = {
  "parallel-shugiin": {
    name: "???????????????????",
    defaultSeats: 1,
    allocation: "dhondt",
    hint: "???????1????????????????????????????????????????????",
    defaultPrBlocks: () => JSON.parse(JSON.stringify(SAMPLE_PR_BLOCKS))
  },
  "smd-simple": {
    name: "??????????1????????",
    defaultSeats: 1,
    allocation: "dhondt",
    hint: "????1???????????FPTP????????????????????????????",
    defaultPrBlocks: () => []
  },
  "mmd-sntv": {
    name: "???????????????????????",
    defaultSeats: 3,
    allocation: "dhondt",
    hint: "???????3?5?????????????????????????????????????????????",
    defaultPrBlocks: () => []
  },
  "parallel-custom": {
    name: "????????????????????",
    defaultSeats: 3,
    allocation: "dhondt",
    hint: "??????????????????????????????????????????",
    defaultPrBlocks: () => JSON.parse(JSON.stringify(SAMPLE_PR_BLOCKS))
  },
  "custom": {
    name: "????????",
    defaultSeats: 1,
    allocation: "dhondt",
    hint: "??????????????????????????????????",
    defaultPrBlocks: () => []
  }
};

function notify(msg) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => t.classList.remove("show"), 2400);
}

function setStatus(msg) {
  const s = $("#statusText");
  if (s) s.textContent = msg;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[m]));
}

function safeFileName(s) {
  return (s || "election-map").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}

function partyById(pid) {
  return parties.find(p => p.id === pid) || { id: pid, name: pid || "??", shortName: pid || "??", color: "#64748b" };
}

function idOf(f) {
  const field = $("#idField") ? $("#idField").value : "auto";
  if (field === "id") return String(f.id ?? "");
  if (field === "name") return String(f.properties?.name ?? "");
  if (field === "code") return String(f.properties?.code ?? "");
  return String(f.id ?? f.properties?.id ?? f.properties?.code ?? f.properties?.name ?? "");
}

// --- ?????????? ---
function calculatePrAllocation(seats, method, votesMap) {
  const partyList = parties.filter(p => (Number(votesMap[p.id]) || 0) > 0);
  const allocated = {};
  parties.forEach(p => allocated[p.id] = 0);
  const order = [];

  if (seats <= 0 || partyList.length === 0) {
    return { allocated, order };
  }

  if (method === "dhondt" || method === "sainte-lague") {
    const quotients = [];
    partyList.forEach(p => {
      const v = Number(votesMap[p.id]) || 0;
      for (let s = 1; s <= seats; s++) {
        const divisor = method === "sainte-lague" ? (2 * s - 1) : s;
        quotients.push({
          partyId: p.id,
          q: v / divisor,
          divisor,
          seatIndex: s
        });
      }
    });

    quotients.sort((a, b) => b.q - a.q || a.partyId.localeCompare(b.partyId));
    const winQuotients = quotients.slice(0, seats);
    winQuotients.forEach(w => {
      allocated[w.partyId] = (allocated[w.partyId] || 0) + 1;
      order.push(w.partyId);
    });
    return { allocated, order };
  }

  // ????? (Hare / Droop)
  const totalVotes = partyList.reduce((acc, p) => acc + (Number(votesMap[p.id]) || 0), 0);
  if (totalVotes <= 0) return { allocated, order };

  let quota;
  if (method === "largest-remainder-droop") {
    quota = Math.floor(totalVotes / (seats + 1)) + 1;
  } else {
    quota = totalVotes / seats;
  }
  if (quota <= 0) quota = 1;

  let assignedCount = 0;
  const remainders = [];

  partyList.forEach(p => {
    const v = Number(votesMap[p.id]) || 0;
    const initialSeats = Math.floor(v / quota);
    allocated[p.id] = initialSeats;
    assignedCount += initialSeats;
    for (let i = 0; i < initialSeats; i++) order.push(p.id);

    const rem = v - initialSeats * quota;
    remainders.push({ partyId: p.id, rem });
  });

  remainders.sort((a, b) => b.rem - a.rem || a.partyId.localeCompare(b.partyId));
  let remainingSeats = seats - assignedCount;
  for (let i = 0; i < remainingSeats && i < remainders.length; i++) {
    const pid = remainders[i].partyId;
    allocated[pid] = (allocated[pid] || 0) + 1;
    order.push(pid);
  }

  return { allocated, order };
}

// --- ????? ---
function recalcDistrict(id) {
  const d = districts[id];
  if (!d) return;

  const seats = Math.max(1, Number(d.seats) || 1);
  d.seats = seats;
  if (!d.mode) d.mode = "votes";

  const candList = (d.candidates || []).map((c, idx) => ({
    id: c.id || `cand-${Math.random().toString(36).slice(2, 7)}`,
    name: c.name || "???",
    party: c.party || parties[0]?.id || "ldp",
    votes: (c.votes !== null && c.votes !== undefined && c.votes !== "") ? Number(c.votes) : null,
    rank: Number(c.rank) || (idx + 1)
  }));

  // ??4: ????????????????????????
  d.isUncontested = (candList.length > 0 && candList.length <= seats);

  if (d.mode === "votes") {
    candList.sort((a, b) => {
      const vA = a.votes !== null ? a.votes : -1;
      const vB = b.votes !== null ? b.votes : -1;
      return vB - vA || a.rank - b.rank || a.name.localeCompare(b.name, "ja");
    });
    candList.forEach((c, idx) => { c.rank = idx + 1; });

    d.candidates = candList;
    d.winners = candList.slice(0, seats).map(c => c.party);

    const pVotes = {};
    parties.forEach(p => pVotes[p.id] = 0);
    let total = 0;
    candList.forEach(c => {
      const v = Math.max(0, c.votes || 0);
      pVotes[c.party] = (pVotes[c.party] || 0) + v;
      total += v;
    });

    d.totalVotes = total;
    d.partyVotes = pVotes;

    let bestPid = d.winners[0] || parties[0]?.id || "ldp";
    let maxV = -1;
    Object.keys(pVotes).forEach(pid => {
      if (pVotes[pid] > maxV) {
        maxV = pVotes[pid];
        bestPid = pid;
      }
    });

    d.maxParty = bestPid;
    d.maxPartyShare = total > 0 ? (maxV / total) * 100 : null;
  } else {
    // ?????????
    candList.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, "ja"));
    candList.forEach((c, idx) => { c.rank = idx + 1; });

    d.candidates = candList;
    d.winners = candList.slice(0, seats).map(c => c.party);
    d.maxParty = d.winners[0] || null;
    d.maxPartyShare = null;
    d.totalVotes = 0;
    d.partyVotes = {};
  }
}

// --- ????? ---
function recalcPrBlock(block) {
  const seats = Math.max(1, Number(block.seats) || 1);
  block.seats = seats;

  let calcVotes = {};
  if (block.mode === "shares") {
    parties.forEach(p => {
      const share = Math.max(0, Number(block.shares?.[p.id]) || 0);
      calcVotes[p.id] = Math.round(share * 10000);
    });
  } else {
    let sum = 0;
    if (!block.votes) block.votes = {};
    if (!block.shares) block.shares = {};
    parties.forEach(p => {
      const v = Math.max(0, Number(block.votes[p.id]) || 0);
      calcVotes[p.id] = v;
      sum += v;
    });
    parties.forEach(p => {
      block.shares[p.id] = sum > 0 ? ((calcVotes[p.id] / sum) * 100).toFixed(2) : "0.00";
    });
  }

  const res = calculatePrAllocation(seats, block.allocationMethod || "dhondt", calcVotes);
  block.allocated = res.allocated;
  block.seatOrder = res.order;
}

function recalcAll() {
  if (geoData?.features) {
    geoData.features.forEach(f => recalcDistrict(idOf(f)));
  }
  prBlocks.forEach(b => recalcPrBlock(b));
}

// --- ????????????5: ????????????? ---
function getDistrictFillColor(district) {
  if (!district) return "#d1d5db";
  const method = $("#shadingMethod") ? $("#shadingMethod").value : "winner-share-steps";

  // ??5: ???????????????????????
  // ?????????????????????????????????????
  if (district.mode === "rank" || district.isUncontested) {
    const winners = district.winners || [];
    if (winners.length === 0) return "#d1d5db";

    const partyWinCount = {};
    winners.forEach(pid => { partyWinCount[pid] = (partyWinCount[pid] || 0) + 1; });
    let topPid = winners[0];
    let maxWins = 0;
    Object.entries(partyWinCount).forEach(([pid, cnt]) => {
      if (cnt > maxWins) { maxWins = cnt; topPid = pid; }
    });

    const p = partyById(topPid);
    const baseHex = (d3.color(p.color) || d3.color("#64748b")).formatHex();
    if (method === "solid") return baseHex;

    // ????????????????????????
    const seatShare = (maxWins / Math.max(1, district.seats)) * 100;

    if (method === "winner-share-steps") {
      let ratio = 0.50;
      if (seatShare >= 60) ratio = 1.00;
      else if (seatShare >= 50) ratio = 0.82;
      else if (seatShare >= 40) ratio = 0.65;
      return d3.interpolateRgb("#ffffff", baseHex)(ratio);
    }
    const ratio = Math.max(0.45, Math.min(1.0, 0.45 + 0.55 * ((seatShare - 20) / 55)));
    return d3.interpolateRgb("#ffffff", baseHex)(ratio);
  }

  // ??????????
  if (!district.maxParty) return "#d1d5db";
  const p = partyById(district.maxParty);
  const baseHex = (d3.color(p.color) || d3.color("#64748b")).formatHex();

  if (method === "solid" || district.maxPartyShare === null) return baseHex;

  const share = district.maxPartyShare;
  if (method === "winner-share-steps") {
    let ratio = 0.50;
    if (share >= 60) ratio = 1.00;
    else if (share >= 50) ratio = 0.82;
    else if (share >= 40) ratio = 0.65;
    return d3.interpolateRgb("#ffffff", baseHex)(ratio);
  }

  const ratio = Math.max(0.45, Math.min(1.0, 0.45 + 0.55 * ((share - 20) / 55)));
  return d3.interpolateRgb("#ffffff", baseHex)(ratio);
}

// --- ??????????????1: ?????????????????????? ---
function computeBallLayout(n, boundsW, boundsH) {
  if (n <= 0) return { cols: 1, rows: 1, ballR: 7, gap: 18 };

  let ballR = 7;
  let gap = 18;

  // ????????????????????????????
  if (boundsW < 50 || boundsH < 50) {
    ballR = 4.5;
    gap = 11;
  } else if (boundsW < 80 || boundsH < 80) {
    ballR = 5.5;
    gap = 14;
  }

  // ??????????????????
  let cols = Math.max(1, Math.min(n, Math.floor((boundsW * 0.75) / gap)));
  const aspect = boundsW / (boundsH || 1);

  if (aspect > 2.0) {
    // ????: ??????
    cols = Math.min(n, Math.max(cols, Math.ceil(Math.sqrt(n) * 1.4)));
  } else if (aspect < 0.6) {
    // ????: ???1?2?????
    cols = Math.min(cols, Math.max(1, Math.floor(Math.sqrt(n) * 0.7)));
  } else {
    // ????: ????????
    cols = Math.min(n, Math.max(cols, Math.ceil(Math.sqrt(n))));
  }

  // ????????????
  while (cols > 1 && (cols - 1) * gap > boundsW * 0.82) {
    if (ballR > 4) {
      ballR--;
      gap = ballR * 2 + 2;
    } else {
      cols--;
    }
  }

  let rows = Math.ceil(n / cols);
  // ????????????
  while (rows > 1 && (rows - 1) * gap > boundsH * 0.82 && ballR > 4) {
    ballR--;
    gap = ballR * 2 + 2;
  }

  return { cols, rows, ballR, gap };
}

// --- ???? & LocalStorage ---
function pushHistory() {
  if (isHistoryLocked) return;
  const snap = snapshot();
  historyStack.push(JSON.stringify(snap));
  if (historyStack.length > 50) historyStack.shift();
  futureStack = [];
  markDirty();
  saveToLocalStorage();
}

function undo() {
  if (!historyStack.length) return;
  futureStack.push(JSON.stringify(snapshot()));
  const prev = JSON.parse(historyStack.pop());
  isHistoryLocked = true;
  restore(prev);
  isHistoryLocked = false;
  notify("?????????????");
}

function redo() {
  if (!futureStack.length) return;
  historyStack.push(JSON.stringify(snapshot()));
  const next = JSON.parse(futureStack.pop());
  isHistoryLocked = true;
  restore(next);
  isHistoryLocked = false;
  notify("??????????");
}

function saveToLocalStorage() {
  try {
    localStorage.setItem("ems_v6_autosave", JSON.stringify(snapshot()));
  } catch (e) {
    console.warn("LocalStorage save failed", e);
  }
}

function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem("ems_v6_autosave");
    if (!raw) return false;
    const s = JSON.parse(raw);
    if (s && s.geoData && s.districts) {
      restore(s);
      return true;
    }
  } catch (e) {
    console.warn("LocalStorage load failed", e);
  }
  return false;
}

function snapshot() {
  return {
    version: 6.0,
    title: $("#electionTitle") ? $("#electionTitle").value : "",
    subtitle: $("#electionSubtitle") ? $("#electionSubtitle").value : "",
    preset: currentPreset,
    shadingMethod: $("#shadingMethod") ? $("#shadingMethod").value : "winner-share-steps",
    showBalls: $("#showBalls") ? $("#showBalls").checked : true,
    ballStyle: $("#ballStyle") ? $("#ballStyle").value : "simple",
    prLayoutPosition: $("#prLayoutPosition") ? $("#prLayoutPosition").value : "bottom",
    showMajorityBar: $("#showMajorityBar") ? $("#showMajorityBar").checked : true,
    showDistrictNames: $("#showDistrictNames") ? $("#showDistrictNames").checked : true,
    showShareText: $("#showShareText") ? $("#showShareText").checked : true,
    showLegend: $("#showLegend") ? $("#showLegend").checked : true,
    idField: $("#idField") ? $("#idField").value : "auto",
    parties: JSON.parse(JSON.stringify(parties)),
    districts: JSON.parse(JSON.stringify(districts)),
    prBlocks: JSON.parse(JSON.stringify(prBlocks)),
    geoData,
    selectedDistrictId,
    collapsedDistrictIds: [...collapsedDistrictIds]
  };
}

function restore(s) {
  if (!s) return;
  if ($("#electionTitle")) $("#electionTitle").value = s.title || "??????";
  if ($("#electionSubtitle")) $("#electionSubtitle").value = s.subtitle || "";
  currentPreset = s.preset || "custom";
  if ($("#presetSelect")) $("#presetSelect").value = currentPreset;
  if ($("#shadingMethod")) $("#shadingMethod").value = s.shadingMethod || "winner-share-steps";
  if ($("#showBalls")) $("#showBalls").checked = s.showBalls !== false;
  if ($("#ballStyle")) $("#ballStyle").value = s.ballStyle || "simple";
  if ($("#prLayoutPosition")) $("#prLayoutPosition").value = s.prLayoutPosition || "bottom";
  if ($("#showMajorityBar")) $("#showMajorityBar").checked = s.showMajorityBar !== false;
  if ($("#showDistrictNames")) $("#showDistrictNames").checked = s.showDistrictNames !== false;
  if ($("#showShareText")) $("#showShareText").checked = s.showShareText !== false;
  if ($("#showLegend")) $("#showLegend").checked = s.showLegend !== false;
  if ($("#idField")) $("#idField").value = s.idField || "auto";

  parties = s.parties || [];
  districts = s.districts || {};
  prBlocks = s.prBlocks || [];
  geoData = s.geoData || null;
  selectedDistrictId = s.selectedDistrictId || null;

  if (Array.isArray(s.collapsedDistrictIds)) {
    collapsedDistrictIds = new Set(s.collapsedDistrictIds);
  } else {
    collapsedDistrictIds = new Set();
  }

  updatePresetHint();
  recalcAll();
  renderAll();
  updateDistrictInspector();
  setStatus("?????????");
}

function markDirty() {
  isDirty = true;
  const el = $("#saveState");
  if (el) {
    el.textContent = "????????";
    el.style.color = "#b45309";
  }
}

function markClean() {
  isDirty = false;
  const el = $("#saveState");
  if (el) {
    el.textContent = "????";
    el.style.color = "#059669";
  }
}

// --- ??? ---
async function init() {
  const partiesData = await fetch("data/parties.json").then(r => r.json()).catch(() => ({
    parties: [
      { id: "ldp", name: "?????", shortName: "??", color: "#dc2626" },
      { id: "cdp", name: "?????", shortName: "??", color: "#2563eb" },
      { id: "ishin", name: "??????", shortName: "??", color: "#16a34a" },
      { id: "komei", name: "???", shortName: "??", color: "#ea580c" },
      { id: "dpp", name: "?????", shortName: "??", color: "#ca8a04" },
      { id: "jcp", name: "?????", shortName: "??", color: "#991b1b" },
      { id: "reiwa", name: "??????", shortName: "???", color: "#db2777" },
      { id: "sansei", name: "???", shortName: "??", color: "#f97316" },
      { id: "sdp", name: "?????", shortName: "??", color: "#4f46e5" },
      { id: "cpj", name: "?????", shortName: "??", color: "#1e3a8a" },
      { id: "ind", name: "???????", shortName: "???", color: "#64748b" }
    ]
  }));
  parties = partiesData.parties;

  // ???????????????
  dataIndex = await fetch("data/index.json").then(r => r.json()).catch(() => ({ maps: [], projects: [] }));

  const restored = loadFromLocalStorage();
  if (!restored) {
    await loadSampleData(false);
  }

  bindEvents();
  updatePresetHint();
  updateBatchPartyOptions();
  recalcAll();
  renderAll();
  markClean();
  setStatus("?????????");
}

async function loadSampleData(makeHistory = true) {
  const d = await fetch("data/okayama-sample.geojson").then(r => r.json());
  geoData = d;
  districts = {};
  selectedDistrictId = null;
  collapsedDistrictIds = new Set(); // ??2: ?????????

  d.features.forEach(f => {
    const id = idOf(f);
    const sample = SAMPLE_DISTRICT_VOTES[id] || { name: f.properties?.name || id, candidates: [] };
    const candList = (sample.candidates && sample.candidates.length > 0)
      ? sample.candidates.map((c, idx) => ({
          id: `cand-${Math.random().toString(36).slice(2, 8)}`,
          name: c.name,
          party: c.party,
          votes: c.votes,
          rank: idx + 1
        }))
      : parties.slice(0, 3).map((p, idx) => ({
          id: `cand-${Math.random().toString(36).slice(2, 8)}`,
          name: `${p.shortName}??`,
          party: p.id,
          votes: 50000 - idx * 12000,
          rank: idx + 1
        }));

    districts[id] = {
      id,
      name: sample.name || f.properties?.name || id,
      seats: 1,
      mode: "votes",
      candidates: candList
    };

    // ??2: ????????????????????
    collapsedDistrictIds.add(id);
  });

  prBlocks = JSON.parse(JSON.stringify(SAMPLE_PR_BLOCKS));

  if (makeHistory) pushHistory();
  recalcAll();
  renderAll();
  if ($("#dataStatus")) $("#dataStatus").textContent = "????????5?????????????";
}

// --- ??????? ---
function applyPreset(presetId) {
  const p = PRESETS[presetId];
  if (!p) return;
  currentPreset = presetId;
  pushHistory();

  if ($("#batchSeatsInput")) $("#batchSeatsInput").value = p.defaultSeats;

  if (geoData?.features) {
    geoData.features.forEach(f => {
      const id = idOf(f);
      if (districts[id]) {
        districts[id].seats = p.defaultSeats;
      }
    });
  }

  prBlocks = p.defaultPrBlocks();

  updatePresetHint();
  recalcAll();
  renderAll();
  updateDistrictInspector();
  notify(`????????${p.name}????????`);
}

function updatePresetHint() {
  const p = PRESETS[currentPreset] || PRESETS.custom;
  if ($("#presetHint")) $("#presetHint").textContent = p.hint;
}

// --- ??????? ---
function updateBatchPartyOptions() {
  const sel = $("#batchPartySelect");
  if (!sel) return;
  sel.innerHTML = parties.map(p => `
    <option value="${p.id}">${escapeHtml(p.name)} (${escapeHtml(p.shortName)})</option>
  `).join("");
}

function batchAddPartyCandidates(partyId) {
  pushHistory();
  const p = partyById(partyId);
  let addCount = 0;

  Object.values(districts).forEach(d => {
    if (!d.candidates) d.candidates = [];
    const exists = d.candidates.some(c => c.party === partyId);
    if (!exists) {
      d.candidates.push({
        id: `cand-${Math.random().toString(36).slice(2, 8)}`,
        name: `${p.shortName}??`,
        party: partyId,
        votes: null,
        rank: d.candidates.length + 1
      });
      addCount++;
    }
  });

  recalcAll();
  renderDistrictEditor();
  renderMap();
  updateDistrictInspector();
  notify(`??????${p.shortName}???????? (${addCount}???)`);
}

function batchRemovePartyCandidates(partyId) {
  if (!confirm(`???????${partyById(partyId).shortName}?????????????`)) return;
  pushHistory();
  let delCount = 0;

  Object.values(districts).forEach(d => {
    if (!d.candidates) return;
    const initialLen = d.candidates.length;
    d.candidates = d.candidates.filter(c => c.party !== partyId);
    delCount += (initialLen - d.candidates.length);
  });

  recalcAll();
  renderDistrictEditor();
  renderMap();
  updateDistrictInspector();
  notify(`???????${partyById(partyId).shortName}???????? (${delCount}???)`);
}

function setupMajorPartiesCandidates() {
  if (!confirm("???????????????????????")) return;
  pushHistory();

  const majorParties = parties.slice(0, 4);
  Object.values(districts).forEach(d => {
    d.candidates = majorParties.map((p, idx) => ({
      id: `cand-${Math.random().toString(36).slice(2, 8)}`,
      name: `${p.shortName}??`,
      party: p.id,
      votes: null,
      rank: idx + 1
    }));
  });

  recalcAll();
  renderDistrictEditor();
  renderMap();
  updateDistrictInspector();
  notify("?????????????????");
}

function clearAllCandidates() {
  if (!confirm("?????????????????")) return;
  pushHistory();
  Object.values(districts).forEach(d => { d.candidates = []; });
  recalcAll();
  renderDistrictEditor();
  renderMap();
  updateDistrictInspector();
  notify("????????????");
}

function batchSetDistrictSeats(seats) {
  pushHistory();
  const val = Math.max(1, Number(seats) || 1);
  Object.values(districts).forEach(d => { d.seats = val; });
  recalcAll();
  renderDistrictEditor();
  renderMap();
  updateDistrictInspector();
  notify(`???????? ${val} ?????????`);
}

// --- ???????? ---
function renderMap() {
  if (!geoData) return;

  const prPosition = $("#prLayoutPosition") ? $("#prLayoutPosition").value : "bottom";
  const showBalls = $("#showBalls") ? $("#showBalls").checked : true;
  const ballStyle = $("#ballStyle") ? $("#ballStyle").value : "simple";
  const showShare = $("#showShareText") ? $("#showShareText").checked : true;
  const showLegend = $("#showLegend") ? $("#showLegend").checked : true;
  const showMajorityBar = $("#showMajorityBar") ? $("#showMajorityBar").checked : true;

  let mapExtent;
  if (prPosition === "bottom" && prBlocks.length > 0) {
    mapExtent = [[40, 70], [1400, 570]];
  } else if (prPosition === "right" && prBlocks.length > 0) {
    mapExtent = [[40, 70], [960, 840]];
  } else {
    mapExtent = [[40, 70], [1400, 840]];
  }

  projection = d3.geoIdentity().reflectY(true).fitExtent(mapExtent, geoData);
  pathGenerator = d3.geoPath(projection);

  polyLayer.selectAll("*").remove();
  ballLayer.selectAll("*").remove();
  textLayer.selectAll("*").remove();
  prPanelGroup.selectAll("*").remove();
  legendGroup.selectAll("*").remove();
  headerGroup.selectAll("*").remove();

  // 1. ????
  const title = $("#electionTitle") ? $("#electionTitle").value : "??????";
  const subtitle = $("#electionSubtitle") ? $("#electionSubtitle").value : "";
  headerGroup.append("text").attr("class", "map-svg-title").attr("x", 40).attr("y", 42).text(title);
  if (subtitle) {
    headerGroup.append("text").attr("class", "map-svg-subtitle").attr("x", 40).attr("y", 60).text(subtitle);
  }

  // 2. ?????????
  if (showMajorityBar) {
    renderMajoritySeatBar();
  }

  // 3. ??????
  const features = geoData.features;
  const districtList = features.map(f => {
    const id = idOf(f);
    const d = districts[id] || { seats: 1, winners: [], maxParty: null, maxPartyShare: null, mode: "votes", isUncontested: false };
    const centroid = pathGenerator.centroid(f);
    const bounds = pathGenerator.bounds(f);
    const boundsW = (bounds && bounds[1] && bounds[0]) ? Math.max(20, bounds[1][0] - bounds[0][0]) : 40;
    const boundsH = (bounds && bounds[1] && bounds[0]) ? Math.max(20, bounds[1][1] - bounds[0][1]) : 40;

    return {
      feature: f,
      id,
      name: d.name || f.properties?.name || id,
      seats: d.seats,
      winners: d.winners || [],
      maxParty: d.maxParty,
      maxPartyShare: d.maxPartyShare,
      mode: d.mode,
      isUncontested: d.isUncontested,
      districtObj: d,
      cx: centroid[0] || 0,
      cy: centroid[1] || 0,
      boundsW,
      boundsH
    };
  });

  polyLayer.selectAll("path")
    .data(districtList, d => d.id)
    .join("path")
    .attr("class", d => `district-poly${d.id === selectedDistrictId ? " selected" : ""}`)
    .attr("d", d => pathGenerator(d.feature))
    .attr("fill", d => getDistrictFillColor(d.districtObj))
    .on("click", (e, d) => {
      e.stopPropagation();
      selectDistrict(d.id);
    })
    .append("title")
    .text(d => {
      const pName = d.maxParty ? partyById(d.maxParty).name : "?????";
      let shareStr = "";
      if (d.isUncontested) shareStr = " (?????)";
      else if (d.maxPartyShare !== null) shareStr = ` (${d.maxPartyShare.toFixed(1)}%)`;
      else shareStr = " (????)";
      return `${d.name} (?? ${d.seats})\n?????: ${pName}${shareStr}`;
    });

  // 4. ???????
  if ($("#showDistrictNames") && $("#showDistrictNames").checked) {
    textLayer.selectAll(".district-label-text")
      .data(districtList, d => d.id)
      .join("text")
      .attr("class", "district-label-text")
      .attr("x", d => d.cx)
      .attr("y", d => d.cy - (showBalls ? 12 : 2))
      .text(d => d.name);
  }

  // 5. ??????????3: ?????????4, 5: ?????????????
  if (showShare) {
    textLayer.selectAll(".district-share-text")
      .data(districtList, d => d.id)
      .join("text")
      .attr("class", "district-share-text")
      .attr("x", d => d.cx)
      .attr("y", d => d.cy + (showBalls ? 30 : 18))
      .text(d => {
        if (d.isUncontested) {
          return "?????"; // ??4
        }
        if (d.mode === "rank") {
          return ""; // ??5: ?????????
        }
        return d.maxPartyShare !== null ? `${d.maxPartyShare.toFixed(1)}%` : "";
      });
  }

  // 6. ??????????????1: ??????????
  if (showBalls) {
    const balls = [];
    districtList.forEach(d => {
      const n = Math.max(1, d.seats);
      const layout = computeBallLayout(n, d.boundsW, d.boundsH);
      const { cols, rows, ballR, gap } = layout;

      const totalW = cols > 1 ? (cols - 1) * gap : 0;
      const totalH = rows > 1 ? (rows - 1) * gap : 0;
      const startX = d.cx - totalW / 2;
      const startY = d.cy - totalH / 2 + 4;

      for (let i = 0; i < n; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const pid = d.winners[i] || null;

        balls.push({
          districtId: d.id,
          seatIndex: i + 1,
          partyId: pid,
          x: startX + col * gap,
          y: startY + row * gap,
          r: ballR
        });
      }
    });

    const ballNodes = ballLayer.selectAll(".seat-ball-group")
      .data(balls, d => `${d.districtId}-${d.seatIndex}`)
      .join("g")
      .attr("class", "seat-ball-group")
      .attr("transform", d => `translate(${d.x},${d.y})`);

    ballNodes.append("circle")
      .attr("class", "seat-ball-circle")
      .attr("r", d => d.r)
      .attr("fill", d => d.partyId ? partyById(d.partyId).color : "#94a3b8")
      .append("title")
      .text(d => `${d.seatIndex}???: ${d.partyId ? partyById(d.partyId).name : "??"}`);

    if (ballStyle === "number") {
      ballNodes.append("text")
        .attr("class", "seat-ball-number")
        .style("font-size", d => `${Math.max(6, d.r * 1.1)}px`)
        .text(d => d.seatIndex);
    }
  }

  // 7. ????????
  if (prPosition !== "none" && prBlocks.length > 0) {
    renderPrSvgBlocks(prPosition);
  }

  // 8. ?????6: ????????
  if (showLegend) {
    renderSvgLegend(prPosition);
  }

  updateTotalSeatSummary();
}

// --- ????????? ---
function renderMajoritySeatBar() {
  const counts = computeTotalSeats();
  const activeParties = parties.filter(p => (counts.total[p.id] || 0) > 0);
  const grandTotal = Object.values(counts.total).reduce((a, b) => a + b, 0);
  if (grandTotal === 0) return;

  const barX = 720;
  const barY = 22;
  const barW = 680;
  const barH = 20;
  const majorityThreshold = Math.floor(grandTotal / 2) + 1;

  const g = headerGroup.append("g").attr("transform", `translate(${barX},${barY})`);

  g.append("rect")
    .attr("x", 0).attr("y", 0)
    .attr("width", barW).attr("height", barH)
    .attr("fill", "#eaecf0").attr("rx", 2);

  let curX = 0;
  activeParties.forEach(p => {
    const seats = counts.total[p.id] || 0;
    const segW = (seats / grandTotal) * barW;
    if (segW > 0) {
      g.append("rect")
        .attr("x", curX).attr("y", 0)
        .attr("width", segW).attr("height", barH)
        .attr("fill", p.color)
        .append("title")
        .text(`${p.name}: ${seats}?? (${((seats / grandTotal) * 100).toFixed(1)}%)`);

      if (segW > 22) {
        g.append("text")
          .attr("x", curX + segW / 2).attr("y", barH / 2)
          .attr("text-anchor", "middle").attr("dominant-baseline", "central")
          .attr("fill", "#ffffff").attr("font-size", "9px").attr("font-weight", "700")
          .attr("paint-order", "stroke").attr("stroke", "#0f172a").attr("stroke-width", "1px")
          .text(seats);
      }
      curX += segW;
    }
  });

  const majX = (majorityThreshold / grandTotal) * barW;
  g.append("line")
    .attr("x1", majX).attr("y1", -3)
    .attr("x2", majX).attr("y2", barH + 3)
    .attr("stroke", "#b91c1c").attr("stroke-width", 2)
    .attr("stroke-dasharray", "3,2");

  g.append("text")
    .attr("class", "majority-line-text")
    .attr("x", majX).attr("y", -5)
    .attr("text-anchor", "middle")
    .text(`???: ${majorityThreshold} / ${grandTotal}`);
}

// --- ????SVG?????? ---
let lastPrLayout = null;

function renderPrSvgBlocks(position) {
  const isRight = position === "right";
  const startX = isRight ? 1000 : 40;
  const startY = isRight ? 75 : 590;
  const panelW = isRight ? 400 : 1360;
  const panelH = isRight ? 790 : 270;

  const panelBg = prPanelGroup.append("rect")
    .attr("class", "pr-panel-bg")
    .attr("x", startX)
    .attr("y", startY)
    .attr("width", panelW)
    .attr("height", panelH)
    .attr("rx", 3);

  const totalPrSeats = prBlocks.reduce((acc, b) => acc + (Number(b.seats) || 0), 0);
  prPanelGroup.append("text")
    .attr("class", "pr-panel-title")
    .attr("x", startX + 14)
    .attr("y", startY + 24)
    .text(`???????? ?? ${totalPrSeats} ???`);

  let curY = startY + 38;
  let curX = startX + 12;

  const showLegend = $("#showLegend") ? $("#showLegend").checked : true;
  const legendSpaceW = (!isRight && showLegend && prBlocks.length <= 2) ? 390 : 0;
  const availableW = panelW - 24 - legendSpaceW;

  prBlocks.forEach((block, bIdx) => {
    const blockW = isRight
      ? panelW - 24
      : Math.min(480, Math.floor((availableW - (prBlocks.length - 1) * 12) / prBlocks.length));
    const seatOrder = block.seatOrder || [];

    const ballRadius = 6.5;
    const gap = 16;
    const maxCols = Math.max(1, Math.floor((blockW - 24) / gap));
    const numRows = Math.max(1, Math.ceil(seatOrder.length / maxCols));
    const ballAreaH = numRows * 18;

    const summaryStartY = 36 + ballAreaH + 8;
    const activeParties = parties.filter(p => (block.allocated?.[p.id] || 0) > 0);
    const summaryRows = activeParties.length > 5 ? 2 : 1;
    const blockH = Math.max(80, summaryStartY + summaryRows * 15 + 6);

    const bx = isRight ? curX : curX + bIdx * (blockW + 12);
    const by = isRight ? curY : curY;

    const blockG = prPanelGroup.append("g")
      .attr("transform", `translate(${bx},${by})`);

    blockG.append("rect")
      .attr("class", "pr-block-box")
      .attr("x", 0).attr("y", 0)
      .attr("width", blockW).attr("height", blockH)
      .attr("rx", 2);

    const methodLabel = {
      "dhondt": "????",
      "sainte-lague": "??????",
      "largest-remainder-hare": "????(Hare)",
      "largest-remainder-droop": "????(Droop)"
    }[block.allocationMethod] || "????";

    blockG.append("text")
      .attr("class", "pr-block-name")
      .attr("x", 10).attr("y", 18)
      .text(block.name || `??? ${bIdx + 1}`);

    blockG.append("text")
      .attr("class", "pr-block-meta")
      .attr("x", blockW - 10).attr("y", 18)
      .attr("text-anchor", "end")
      .text(`?? ${block.seats} / ${methodLabel}`);

    const ballLayerG = blockG.append("g").attr("transform", "translate(12, 34)");
    seatOrder.forEach((pid, idx) => {
      const col = idx % maxCols;
      const row = Math.floor(idx / maxCols);
      const bg = ballLayerG.append("g").attr("transform", `translate(${col * gap},${row * 18})`);
      bg.append("circle")
        .attr("r", ballRadius)
        .attr("fill", partyById(pid).color)
        .attr("stroke", "#ffffff")
        .attr("stroke-width", 1.2)
        .append("title")
        .text(`${idx + 1}???: ${partyById(pid).name}`);
    });

    const summaryG = blockG.append("g").attr("transform", `translate(10, ${summaryStartY})`);
    if (activeParties.length === 0) {
      summaryG.append("text").attr("class", "pr-seat-label").text("??????");
    } else {
      const row1Parties = activeParties.slice(0, 5);
      const row2Parties = activeParties.slice(5);

      summaryG.append("text")
        .attr("class", "pr-seat-label")
        .text(row1Parties.map(p => `${p.shortName} ${block.allocated[p.id]}`).join("?"));

      if (row2Parties.length > 0) {
        summaryG.append("text")
          .attr("class", "pr-seat-label")
          .attr("y", 14)
          .text(row2Parties.map(p => `${p.shortName} ${block.allocated[p.id]}`).join("?"));
      }
    }

    if (isRight) {
      curY += blockH + 10;
    }
  });

  lastPrLayout = {
    position,
    startX,
    startY,
    panelW,
    panelH,
    lastPrBottomY: curY,
    panelBg,
    legendSpaceW
  };

  if (isRight && !showLegend) {
    const compactH = Math.min(790, Math.max(120, curY + 12 - startY));
    panelBg.attr("height", compactH);
  }
}

// --- ?????6: ???????????????????? ---
function renderSvgLegend(prPosition) {
  const counts = computeTotalSeats();
  const hasPr = prBlocks.length > 0;
  const activeParties = parties.filter(p => (counts.total[p.id] || 0) > 0 || (counts.district[p.id] || 0) > 0);
  const displayParties = activeParties.length > 0 ? activeParties.slice(0, 8) : parties.slice(0, 5);

  const shadingMethod = $("#shadingMethod") ? $("#shadingMethod").value : "winner-share-steps";
  const showShadingSteps = shadingMethod !== "solid";
  const shadingH = showShadingSteps ? 28 : 0;
  const legH = 26 + shadingH + displayParties.length * 15 + 8;
  let legX = 40, legY = 690, legW = hasPr ? 360 : 260;

  if (prPosition === "bottom" && lastPrLayout && prBlocks.length > 0) {
    if (prBlocks.length <= 2) {
      legX = lastPrLayout.startX + lastPrLayout.panelW - legW - 8;
      legY = lastPrLayout.startY + 10;
    } else {
      legX = 40;
      legY = 570 - legH - 8;
    }
  } else if (prPosition === "right" && lastPrLayout && prBlocks.length > 0) {
    legW = 360;
    const candidateY = lastPrLayout.lastPrBottomY + 8;
    if (candidateY + legH <= 870) {
      legX = lastPrLayout.startX + 12;
      legY = candidateY;
      const neededPanelH = (legY + legH + 12) - lastPrLayout.startY;
      lastPrLayout.panelBg.attr("height", Math.max(neededPanelH, 280));
    } else {
      legX = 40;
      legY = 840 - legH;
      lastPrLayout.panelBg.attr("height", 790);
    }
  } else {
    legX = 40;
    legY = 840 - legH;
    legW = hasPr ? 320 : 220;
  }

  const g = legendGroup.append("g").attr("transform", `translate(${legX},${legY})`);

  g.append("rect")
    .attr("class", "legend-panel-bg")
    .attr("x", 0).attr("y", 0)
    .attr("width", legW).attr("height", legH)
    .attr("rx", 2);

  g.append("text")
    .attr("class", "legend-heading")
    .attr("x", 10).attr("y", 16)
    .text("??????" + (showShadingSteps ? "????????" : ""));

  // ?????????
  if (showShadingSteps) {
    const steps = [
      { label: "<40%", share: 35 },
      { label: "40-50%", share: 45 },
      { label: "50-60%", share: 55 },
      { label: "60%+", share: 65 }
    ];
    const samplePid = parties[0]?.id || "ldp";
    const shadeG = g.append("g").attr("transform", "translate(10, 26)");

    shadeG.append("text")
      .attr("class", "shading-legend-label")
      .attr("x", 0).attr("y", 0)
      .text("?????:");

    steps.forEach((st, idx) => {
      const sx = 65 + idx * 48;
      shadeG.append("rect")
        .attr("x", sx).attr("y", -9)
        .attr("width", 12).attr("height", 10)
        .attr("fill", getDistrictFillColor({ maxParty: samplePid, maxPartyShare: st.share, mode: "votes", isUncontested: false }))
        .attr("stroke", "#adb5bd").attr("stroke-width", 0.5);

      shadeG.append("text")
        .attr("class", "shading-legend-label")
        .attr("x", sx + 14).attr("y", 0)
        .text(st.label);
    });
  }

  // ????????????6: ?????????????
  const tableTop = 14 + shadingH + 6;
  const tableG = g.append("g").attr("transform", `translate(10, ${tableTop})`);
  const colW = legW - 20;

  if (hasPr) {
    const colParty = 0;
    const colDistrict = Math.floor(colW * 0.5);
    const colPr = Math.floor(colW * 0.74);
    const colTotal = colW;

    tableG.append("text").attr("class", "shading-legend-label").attr("x", colParty).attr("y", 6).text("??");
    tableG.append("text").attr("class", "shading-legend-label").attr("x", colDistrict).attr("y", 6).attr("text-anchor", "end").text("???");
    tableG.append("text").attr("class", "shading-legend-label").attr("x", colPr).attr("y", 6).attr("text-anchor", "end").text("??");
    tableG.append("text").attr("class", "shading-legend-label").attr("x", colTotal).attr("y", 6).attr("text-anchor", "end").text("??");

    displayParties.forEach((p, idx) => {
      const rowY = 20 + idx * 15;
      tableG.append("rect")
        .attr("x", 0).attr("y", rowY - 8)
        .attr("width", 8).attr("height", 8)
        .attr("fill", p.color);

      tableG.append("text")
        .attr("class", "legend-party-name")
        .attr("x", 12).attr("y", rowY)
        .text(p.shortName);

      tableG.append("text")
        .attr("class", "legend-party-seats")
        .attr("x", colDistrict).attr("y", rowY)
        .text(counts.district[p.id] || 0);

      tableG.append("text")
        .attr("class", "legend-party-seats")
        .attr("x", colPr).attr("y", rowY)
        .text(counts.pr[p.id] || 0);

      tableG.append("text")
        .attr("class", "legend-party-seats")
        .attr("x", colTotal).attr("y", rowY)
        .attr("fill", "#111827")
        .text(counts.total[p.id] || 0);
    });
  } else {
    // ?????: ??? ? ???? ??
    const colParty = 0;
    const colSeats = colW;

    tableG.append("text").attr("class", "shading-legend-label").attr("x", colParty).attr("y", 6).text("??");
    tableG.append("text").attr("class", "shading-legend-label").attr("x", colSeats).attr("y", 6).attr("text-anchor", "end").text("????");

    displayParties.forEach((p, idx) => {
      const rowY = 20 + idx * 15;
      tableG.append("rect")
        .attr("x", 0).attr("y", rowY - 8)
        .attr("width", 8).attr("height", 8)
        .attr("fill", p.color);

      tableG.append("text")
        .attr("class", "legend-party-name")
        .attr("x", 12).attr("y", rowY)
        .text(p.shortName);

      tableG.append("text")
        .attr("class", "legend-party-seats")
        .attr("x", colSeats).attr("y", rowY)
        .attr("fill", "#111827")
        .text(counts.district[p.id] || 0);
    });
  }
}

// --- ???? ---
function computeTotalSeats() {
  const districtCounts = {};
  const prCounts = {};
  const totalCounts = {};
  parties.forEach(p => {
    districtCounts[p.id] = 0;
    prCounts[p.id] = 0;
    totalCounts[p.id] = 0;
  });

  Object.values(districts).forEach(d => {
    (d.winners || []).forEach(pid => {
      districtCounts[pid] = (districtCounts[pid] || 0) + 1;
      totalCounts[pid] = (totalCounts[pid] || 0) + 1;
    });
  });

  prBlocks.forEach(b => {
    Object.entries(b.allocated || {}).forEach(([pid, count]) => {
      prCounts[pid] = (prCounts[pid] || 0) + count;
      totalCounts[pid] = (totalCounts[pid] || 0) + count;
    });
  });

  return { district: districtCounts, pr: prCounts, total: totalCounts };
}

function updateTotalSeatSummary() {
  const counts = computeTotalSeats();
  const summaryEl = $("#totalSeatSummary");
  if (!summaryEl) return;
  summaryEl.innerHTML = "";

  parties.forEach(p => {
    const tot = counts.total[p.id] || 0;
    if (tot > 0) {
      const chip = document.createElement("div");
      chip.className = "seat-chip";
      chip.innerHTML = `
        <span class="seat-chip-dot" style="background:${p.color}"></span>
        <strong>${escapeHtml(p.shortName)}</strong>
        <span>${tot}??</span>
      `;
      summaryEl.appendChild(chip);
    }
  });

  if ($("#barTitle")) $("#barTitle").textContent = $("#electionTitle") ? $("#electionTitle").value : "";
  if ($("#barSubtitle")) $("#barSubtitle").textContent = $("#electionSubtitle") ? $("#electionSubtitle").value : "";
  if ($("#documentTitle")) $("#documentTitle").textContent = $("#electionTitle") ? $("#electionTitle").value : "";
}

// --- ????????????????? ---
function selectDistrict(did) {
  selectedDistrictId = did;

  polyLayer.selectAll(".district-poly")
    .classed("selected", d => d.id === did);

  collapsedDistrictIds.delete(did);
  renderDistrictEditor();

  const card = $(`.district-card[data-district-id="${CSS.escape(did)}"]`);
  if (card) {
    card.classList.add("selected");
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  updateDistrictInspector();
  setStatus(`${districts[did]?.name || did} ???????`);
}

function updateDistrictInspector() {
  const insp = $("#districtInspector");
  if (!insp) return;

  if (!selectedDistrictId || !districts[selectedDistrictId]) {
    insp.classList.remove("show");
    return;
  }

  const d = districts[selectedDistrictId];
  insp.classList.add("show");

  $("#inspDistrictName").textContent = d.name;
  $("#inspDistrictId").textContent = `(${d.id})`;
  $("#inspSeatsInput").value = d.seats;

  $("#inspModeVotesBtn").classList.toggle("active", d.mode !== "rank");
  $("#inspModeRankBtn").classList.toggle("active", d.mode === "rank");

  const listEl = $("#inspCandidateList");
  listEl.innerHTML = "";

  const candList = d.candidates || [];
  candList.forEach((c, idx) => {
    const isWin = idx < d.seats;
    const row = document.createElement("div");
    row.className = "candidate-row";
    row.style.background = isWin ? "#eff6ff" : "#f8fafc";

    const voteVal = c.votes !== null ? c.votes : "";

    row.innerHTML = `
      <span class="rank-badge ${isWin ? "winner" : ""}">${c.rank}</span>
      <div class="rank-btn-group">
        <button class="rank-btn" data-insp-action="up" data-idx="${idx}" ${idx === 0 ? "disabled" : ""}>?</button>
        <button class="rank-btn" data-insp-action="down" data-idx="${idx}" ${idx === candList.length - 1 ? "disabled" : ""}>?</button>
      </div>
      <select data-insp-action="party" data-idx="${idx}">
        ${parties.map(p => `<option value="${p.id}" ${p.id === c.party ? "selected" : ""}>${escapeHtml(p.shortName)}</option>`).join("")}
      </select>
      <input type="text" data-insp-action="name" data-idx="${idx}" value="${escapeHtml(c.name)}" placeholder="??">
      <input class="votes-input" type="number" min="0" data-insp-action="votes" data-idx="${idx}" value="${voteVal}" placeholder="${d.mode === 'rank' ? '????' : '???'}">
      <button class="del-cand-btn" data-insp-action="del" data-idx="${idx}" title="??">?</button>
    `;
    listEl.appendChild(row);
  });

  const winBadges = (d.winners || []).map((pid, idx) => {
    const p = partyById(pid);
    return `<span class="seat-badge" style="background:${p.color}">${idx + 1}?: ${escapeHtml(p.shortName)}</span>`;
  }).join(" ");
  $("#inspWinnersBadge").innerHTML = winBadges || "??";

  let shareLabel = "";
  if (d.isUncontested) shareLabel = "?????????????????";
  else if (d.mode === "rank") shareLabel = "????????????????";
  else shareLabel = d.maxPartyShare !== null ? `?????: ${d.maxPartyShare.toFixed(1)}%` : "???";

  $("#inspShareText").textContent = shareLabel;

  // ????????
  listEl.querySelectorAll("[data-insp-action]").forEach(el => {
    const act = el.dataset.inspAction;
    const idx = Number(el.dataset.idx);

    if (act === "votes") {
      el.addEventListener("input", e => {
        const val = e.target.value.trim();
        d.candidates[idx].votes = val !== "" ? Math.max(0, Number(val) || 0) : null;
        recalcDistrict(d.id);
        renderMap();
        updateDistrictInspector();
        renderDistrictEditor();
        markDirty();
      });
      el.addEventListener("change", () => pushHistory());
    } else if (act === "party") {
      el.addEventListener("change", e => {
        pushHistory();
        d.candidates[idx].party = e.target.value;
        recalcDistrict(d.id);
        renderMap();
        updateDistrictInspector();
        renderDistrictEditor();
        markDirty();
      });
    } else if (act === "name") {
      el.addEventListener("change", e => {
        pushHistory();
        d.candidates[idx].name = e.target.value;
        renderMap();
        updateDistrictInspector();
        renderDistrictEditor();
        markDirty();
      });
    } else if (act === "up") {
      el.addEventListener("click", () => {
        if (idx <= 0) return;
        pushHistory();
        const tmp = d.candidates[idx];
        d.candidates[idx] = d.candidates[idx - 1];
        d.candidates[idx - 1] = tmp;
        d.candidates.forEach((c, i) => { c.rank = i + 1; });
        recalcDistrict(d.id);
        renderMap();
        updateDistrictInspector();
        renderDistrictEditor();
        markDirty();
      });
    } else if (act === "down") {
      el.addEventListener("click", () => {
        if (idx >= candList.length - 1) return;
        pushHistory();
        const tmp = d.candidates[idx];
        d.candidates[idx] = d.candidates[idx + 1];
        d.candidates[idx + 1] = tmp;
        d.candidates.forEach((c, i) => { c.rank = i + 1; });
        recalcDistrict(d.id);
        renderMap();
        updateDistrictInspector();
        renderDistrictEditor();
        markDirty();
      });
    } else if (act === "del") {
      el.addEventListener("click", () => {
        pushHistory();
        d.candidates.splice(idx, 1);
        d.candidates.forEach((c, i) => { c.rank = i + 1; });
        recalcDistrict(d.id);
        renderMap();
        updateDistrictInspector();
        renderDistrictEditor();
        markDirty();
      });
    }
  });
}

// --- ??UI?????? ---
function renderAll() {
  renderPartyEditor();
  renderDistrictEditor();
  renderPrBlockEditor();
  renderValidation();
  renderStatsTab();
  renderMap();
}

// --- ?????? ---
function renderPartyEditor() {
  const container = $("#partyListContainer");
  if (!container) return;
  container.innerHTML = "";

  parties.forEach((p, idx) => {
    const card = document.createElement("div");
    card.className = "party-edit-card";
    card.innerHTML = `
      <input type="color" data-action="party-color" data-idx="${idx}" value="${p.color}">
      <input type="text" data-action="party-name" data-idx="${idx}" value="${escapeHtml(p.name)}" placeholder="???">
      <input type="text" data-action="party-short" data-idx="${idx}" value="${escapeHtml(p.shortName)}" placeholder="??">
      <button class="party-del-btn" data-action="party-del" data-idx="${idx}" title="?????">?</button>
    `;
    container.appendChild(card);
  });

  updateBatchPartyOptions();

  container.querySelectorAll("[data-action]").forEach(el => {
    const act = el.dataset.action;
    const idx = Number(el.dataset.idx);

    if (act === "party-color") {
      el.addEventListener("input", e => {
        parties[idx].color = e.target.value;
        renderMap();
        updateDistrictInspector();
        markDirty();
      });
    } else if (act === "party-name") {
      el.addEventListener("change", e => {
        pushHistory();
        parties[idx].name = e.target.value.trim() || `??${idx + 1}`;
        renderMap();
        updateBatchPartyOptions();
        renderStatsTab();
        markDirty();
      });
    } else if (act === "party-short") {
      el.addEventListener("change", e => {
        pushHistory();
        parties[idx].shortName = e.target.value.trim() || `?${idx + 1}`;
        renderMap();
        updateBatchPartyOptions();
        updateDistrictInspector();
        renderStatsTab();
        markDirty();
      });
    } else if (act === "party-del") {
      el.addEventListener("click", () => {
        if (parties.length <= 1) {
          notify("?????1?????????");
          return;
        }
        pushHistory();
        parties.splice(idx, 1);
        recalcAll();
        renderAll();
        updateDistrictInspector();
        markDirty();
      });
    }
  });
}

// --- ??????????2: ???????????? ---
function renderDistrictEditor() {
  const container = $("#districtListContainer");
  if (!container) return;
  container.innerHTML = "";

  const filterText = ($("#districtFilterInput") ? $("#districtFilterInput").value : "").toLowerCase();
  const districtIds = Object.keys(districts);

  districtIds.forEach(id => {
    const d = districts[id];
    if (filterText && !d.name.toLowerCase().includes(filterText) && !id.toLowerCase().includes(filterText)) {
      return;
    }

    const isCollapsed = collapsedDistrictIds.has(id);
    const card = document.createElement("div");
    card.className = `district-card${id === selectedDistrictId ? " selected" : ""}${isCollapsed ? " collapsed" : ""}`;
    card.dataset.districtId = id;

    const miniWinnerBadges = (d.winners || []).map((pid, idx) => {
      const p = partyById(pid);
      return `<span class="seat-badge" style="background:${p.color}">${idx + 1}?:${escapeHtml(p.shortName)}</span>`;
    }).join(" ");

    const head = document.createElement("div");
    head.className = "district-card-head";
    head.innerHTML = `
      <div class="district-head-left" data-action="toggle-accordion" data-id="${id}">
        <span class="accordion-toggle-icon">?</span>
        <span class="district-card-title">${escapeHtml(d.name)} <small>(${escapeHtml(id)})</small></span>
        <span class="collapsed-badge">${d.isUncontested ? '<span style="color:#b45309;font-weight:700;">[???]</span>' : ''} ${miniWinnerBadges || "??"}</span>
      </div>
      <div class="district-card-seats">
        <div class="pill-toggle-group" style="scale:0.85;">
          <button class="pill-btn ${d.mode !== 'rank' ? 'active' : ''}" data-action="mode-votes" data-id="${id}" title="?????????">??</button>
          <button class="pill-btn ${d.mode === 'rank' ? 'active' : ''}" data-action="mode-rank" data-id="${id}" title="???????">??</button>
        </div>
        <span>??:</span>
        <input type="number" min="1" max="20" data-action="district-seats" data-id="${id}" value="${d.seats}">
      </div>
    `;
    card.appendChild(head);

    const candList = d.candidates || [];
    candList.forEach((c, cIdx) => {
      const isWin = cIdx < d.seats;
      const row = document.createElement("div");
      row.className = "candidate-row";
      row.style.background = isWin ? "#eff6ff" : "#f8fafc";

      const voteVal = c.votes !== null ? c.votes : "";

      row.innerHTML = `
        <span class="rank-badge ${isWin ? "winner" : ""}">${c.rank}</span>
        <div class="rank-btn-group">
          <button class="rank-btn" data-action="cand-up" data-id="${id}" data-idx="${cIdx}" ${cIdx === 0 ? "disabled" : ""}>?</button>
          <button class="rank-btn" data-action="cand-down" data-id="${id}" data-idx="${cIdx}" ${cIdx === candList.length - 1 ? "disabled" : ""}>?</button>
        </div>
        <select data-action="cand-party" data-id="${id}" data-idx="${cIdx}">
          ${parties.map(p => `<option value="${p.id}" ${p.id === c.party ? "selected" : ""}>${escapeHtml(p.shortName)}</option>`).join("")}
        </select>
        <input type="text" data-action="cand-name" data-id="${id}" data-idx="${cIdx}" value="${escapeHtml(c.name)}" placeholder="????">
        <input class="votes-input" type="number" min="0" data-action="cand-votes" data-id="${id}" data-idx="${cIdx}" value="${voteVal}" placeholder="${d.mode === 'rank' ? '????' : '???'}">
        <button class="del-cand-btn" data-action="cand-del" data-id="${id}" data-idx="${cIdx}" title="??">?</button>
      `;
      card.appendChild(row);
    });

    const addCandBtn = document.createElement("button");
    addCandBtn.className = "small-btn district-add-cand-btn";
    addCandBtn.textContent = "? ??????";
    addCandBtn.dataset.action = "cand-add";
    addCandBtn.dataset.id = id;
    card.appendChild(addCandBtn);

    const summaryLine = document.createElement("div");
    summaryLine.className = "district-summary-line";
    const winnerBadges = (d.winners || []).map((pid, idx) => {
      const p = partyById(pid);
      return `<span class="seat-badge" style="background:${p.color}">${idx + 1}?: ${escapeHtml(p.shortName)}</span>`;
    }).join(" ");

    let shareInfo = "";
    if (d.isUncontested) shareInfo = `<span style="color:#b45309;font-weight:700;">??????????????</span>`;
    else if (d.mode === "rank") shareInfo = `<span style="color:#1a56db;">?????????????</span>`;
    else shareInfo = d.maxPartyShare !== null ? `?????: ${d.maxPartyShare.toFixed(1)}%` : "???";

    summaryLine.innerHTML = `
      <div class="district-winners-badge">${winnerBadges || "?????"}</div>
      <span>${shareInfo}</span>
    `;
    card.appendChild(summaryLine);

    container.appendChild(card);
  });

  container.querySelectorAll("[data-action]").forEach(el => {
    const act = el.dataset.action;
    const did = el.dataset.id;
    const idx = Number(el.dataset.idx);

    if (act === "toggle-accordion") {
      el.addEventListener("click", () => {
        if (collapsedDistrictIds.has(did)) {
          collapsedDistrictIds.delete(did);
        } else {
          collapsedDistrictIds.add(did);
        }
        renderDistrictEditor();
      });
    } else if (act === "mode-votes") {
      el.addEventListener("click", () => {
        pushHistory();
        districts[did].mode = "votes";
        recalcDistrict(did);
        renderDistrictEditor();
        renderMap();
        updateDistrictInspector();
        renderStatsTab();
        markDirty();
      });
    } else if (act === "mode-rank") {
      el.addEventListener("click", () => {
        pushHistory();
        districts[did].mode = "rank";
        recalcDistrict(did);
        renderDistrictEditor();
        renderMap();
        updateDistrictInspector();
        renderStatsTab();
        markDirty();
      });
    } else if (act === "district-seats") {
      el.addEventListener("change", e => {
        pushHistory();
        districts[did].seats = Math.max(1, Number(e.target.value) || 1);
        recalcDistrict(did);
        renderDistrictEditor();
        renderMap();
        updateDistrictInspector();
        renderStatsTab();
        markDirty();
      });
    } else if (act === "cand-votes") {
      el.addEventListener("input", e => {
        const val = e.target.value.trim();
        districts[did].candidates[idx].votes = val !== "" ? Math.max(0, Number(val) || 0) : null;
        recalcDistrict(did);
        renderMap();
        updateDistrictInspector();
        renderStatsTab();
        markDirty();
      });
      el.addEventListener("change", () => {
        pushHistory();
        renderDistrictEditor();
      });
    } else if (act === "cand-party") {
      el.addEventListener("change", e => {
        pushHistory();
        districts[did].candidates[idx].party = e.target.value;
        recalcDistrict(did);
        renderDistrictEditor();
        renderMap();
        updateDistrictInspector();
        renderStatsTab();
        markDirty();
      });
    } else if (act === "cand-name") {
      el.addEventListener("change", e => {
        pushHistory();
        districts[did].candidates[idx].name = e.target.value;
        renderMap();
        updateDistrictInspector();
        markDirty();
      });
    } else if (act === "cand-up") {
      el.addEventListener("click", () => {
        if (idx <= 0) return;
        pushHistory();
        const candList = districts[did].candidates;
        const tmp = candList[idx];
        candList[idx] = candList[idx - 1];
        candList[idx - 1] = tmp;
        candList.forEach((c, i) => { c.rank = i + 1; });
        recalcDistrict(did);
        renderDistrictEditor();
        renderMap();
        updateDistrictInspector();
        renderStatsTab();
        markDirty();
      });
    } else if (act === "cand-down") {
      el.addEventListener("click", () => {
        const candList = districts[did].candidates;
        if (idx >= candList.length - 1) return;
        pushHistory();
        const tmp = candList[idx];
        candList[idx] = candList[idx + 1];
        candList[idx + 1] = tmp;
        candList.forEach((c, i) => { c.rank = i + 1; });
        recalcDistrict(did);
        renderDistrictEditor();
        renderMap();
        updateDistrictInspector();
        renderStatsTab();
        markDirty();
      });
    } else if (act === "cand-del") {
      el.addEventListener("click", () => {
        pushHistory();
        districts[did].candidates.splice(idx, 1);
        districts[did].candidates.forEach((c, i) => { c.rank = i + 1; });
        recalcDistrict(did);
        renderDistrictEditor();
        renderMap();
        updateDistrictInspector();
        renderStatsTab();
        markDirty();
      });
    } else if (act === "cand-add") {
      el.addEventListener("click", () => {
        pushHistory();
        if (!districts[did].candidates) districts[did].candidates = [];
        districts[did].candidates.push({
          id: `cand-${Math.random().toString(36).slice(2, 8)}`,
          name: "????",
          party: parties[0]?.id || "ldp",
          votes: null,
          rank: districts[did].candidates.length + 1
        });
        recalcDistrict(did);
        renderDistrictEditor();
        renderMap();
        updateDistrictInspector();
        renderStatsTab();
        markDirty();
      });
    }
  });
}

// --- ??????? ---
function renderPrBlockEditor() {
  const container = $("#prBlockListContainer");
  if (!container) return;
  container.innerHTML = "";

  if (prBlocks.length === 0) {
    container.innerHTML = `
      <div class="info-box">
        ????????????????????????????<br>
        ???? ??????????????????????????????
      </div>
    `;
    return;
  }

  prBlocks.forEach((block, bIdx) => {
    const card = document.createElement("div");
    card.className = "pr-block-card";
    card.dataset.prIndex = bIdx;

    card.innerHTML = `
      <div class="pr-block-card-head">
        <input type="text" data-pr-action="name" data-idx="${bIdx}" value="${escapeHtml(block.name)}" style="font-weight:700;font-size:12px;width:180px;">
        <button class="pr-block-del-btn" data-pr-action="del" data-idx="${bIdx}">??</button>
      </div>

      <div class="field-grid-2">
        <label class="field">
          <span>????</span>
          <input type="number" min="1" max="200" data-pr-action="seats" data-idx="${bIdx}" value="${block.seats}">
        </label>
        <label class="field">
          <span>????</span>
          <select data-pr-action="allocation" data-idx="${bIdx}">
            <option value="dhondt" ${block.allocationMethod === "dhondt" ? "selected" : ""}>????</option>
            <option value="sainte-lague" ${block.allocationMethod === "sainte-lague" ? "selected" : ""}>??????</option>
            <option value="largest-remainder-hare" ${block.allocationMethod === "largest-remainder-hare" ? "selected" : ""}>?????(Hare)</option>
            <option value="largest-remainder-droop" ${block.allocationMethod === "largest-remainder-droop" ? "selected" : ""}>?????(Droop)</option>
          </select>
        </label>
      </div>

      <div class="pill-toggle-group" style="margin-bottom:6px;">
        <button class="pill-btn ${block.mode !== 'shares' ? 'active' : ''}" data-pr-action="mode-votes" data-idx="${bIdx}">?????</button>
        <button class="pill-btn ${block.mode === 'shares' ? 'active' : ''}" data-pr-action="mode-shares" data-idx="${bIdx}">???(%)??</button>
      </div>

      <div class="pr-party-table">
        ${parties.map(p => {
          const val = block.mode === "shares" ? (block.shares?.[p.id] || "0.00") : (block.votes?.[p.id] || 0);
          const seatCount = block.allocated?.[p.id] || 0;
          return `
            <div class="pr-party-row">
              <span class="party-label" style="color:${p.color};">${escapeHtml(p.shortName)}</span>
              <input type="number" min="0" step="${block.mode === "shares" ? "0.01" : "1"}"
                data-pr-action="input-val" data-idx="${bIdx}" data-pid="${p.id}" value="${val}">
              <span class="pr-seat-chip">${seatCount} ??</span>
            </div>
          `;
        }).join("")}
      </div>
    `;

    container.appendChild(card);
  });

  // ????????
  container.querySelectorAll("[data-pr-action]").forEach(el => {
    const act = el.dataset.prAction;
    const idx = Number(el.dataset.idx);

    if (act === "name") {
      el.addEventListener("change", e => {
        pushHistory();
        prBlocks[idx].name = e.target.value.trim() || `???${idx + 1}`;
        renderMap();
        renderStatsTab();
        markDirty();
      });
    } else if (act === "seats") {
      el.addEventListener("change", e => {
        pushHistory();
        prBlocks[idx].seats = Math.max(1, Number(e.target.value) || 1);
        recalcPrBlock(prBlocks[idx]);
        renderPrBlockEditor();
        renderMap();
        renderStatsTab();
        markDirty();
      });
    } else if (act === "allocation") {
      el.addEventListener("change", e => {
        pushHistory();
        prBlocks[idx].allocationMethod = e.target.value;
        recalcPrBlock(prBlocks[idx]);
        renderPrBlockEditor();
        renderMap();
        renderStatsTab();
        markDirty();
      });
    } else if (act === "mode-votes") {
      el.addEventListener("click", () => {
        pushHistory();
        prBlocks[idx].mode = "votes";
        recalcPrBlock(prBlocks[idx]);
        renderPrBlockEditor();
        renderMap();
        renderStatsTab();
        markDirty();
      });
    } else if (act === "mode-shares") {
      el.addEventListener("click", () => {
        pushHistory();
        prBlocks[idx].mode = "shares";
        recalcPrBlock(prBlocks[idx]);
        renderPrBlockEditor();
        renderMap();
        renderStatsTab();
        markDirty();
      });
    } else if (act === "input-val") {
      const pid = el.dataset.pid;
      el.addEventListener("input", e => {
        const val = Math.max(0, Number(e.target.value) || 0);
        if (prBlocks[idx].mode === "shares") {
          if (!prBlocks[idx].shares) prBlocks[idx].shares = {};
          prBlocks[idx].shares[pid] = val;
        } else {
          if (!prBlocks[idx].votes) prBlocks[idx].votes = {};
          prBlocks[idx].votes[pid] = val;
        }
        recalcPrBlock(prBlocks[idx]);
        renderMap();
        renderStatsTab();
        markDirty();
      });
      el.addEventListener("change", () => {
        pushHistory();
        renderPrBlockEditor();
      });
    } else if (act === "del") {
      el.addEventListener("click", () => {
        pushHistory();
        prBlocks.splice(idx, 1);
        renderPrBlockEditor();
        renderMap();
        renderStatsTab();
        markDirty();
      });
    }
  });
}

// --- ???? ---
function renderValidation() {
  const container = $("#validationContainer");
  if (!container) return;
  const items = [];

  const fList = geoData?.features || [];
  const ids = fList.map(f => idOf(f));
  const dups = ids.filter((id, i) => ids.indexOf(id) !== i);

  if (!ids.length) {
    items.push(["error", "GeoJSON?????????????????"]);
  } else {
    if (ids.some(x => !x)) {
      items.push(["error", "???ID????????????ID?????????????????"]);
    }
    if (dups.length) {
      items.push(["error", `???????ID?????: ${[...new Set(dups)].join(", ")}`]);
    }
    if (!dups.length && !ids.some(x => !x)) {
      items.push(["ok", `??????: ${ids.length}????????????`]);
    }
  }

  const uncontestedDistricts = Object.values(districts).filter(d => d.isUncontested);
  if (uncontestedDistricts.length > 0) {
    items.push(["warn", `?????????? ${uncontestedDistricts.length} ??????${uncontestedDistricts.map(d => d.name).join("?")}??????????????????????`]);
  }

  if (prBlocks.length > 0) {
    prBlocks.forEach((b, i) => {
      const totalSeats = b.seats;
      const assigned = Object.values(b.allocated || {}).reduce((a, c) => a + c, 0);
      if (assigned !== totalSeats) {
        items.push(["warn", `????${b.name || i + 1}?: ??${totalSeats}?????????${assigned}?????????????????????????`]);
      } else {
        items.push(["ok", `????${b.name || i + 1}?: ??${totalSeats}?????????????????`]);
      }
    });
  }

  container.innerHTML = items.map(([type, msg]) => `
    <div class="validation-item ${type}">${escapeHtml(msg)}</div>
  `).join("");
}

// --- ???? & ?????????8? ---
function computeElectionStats() {
  const stats = {};
  parties.forEach(p => {
    stats[p.id] = {
      party: p,
      candidates: 0,
      districtSeats: 0,
      districtVotes: 0,
      prSeats: 0,
      prVotes: 0,
      totalSeats: 0,
      totalVotes: 0,
      districtVoteShare: 0,
      prVoteShare: 0,
      totalVoteShare: 0,
      seatShare: 0,
      winRate: 0
    };
  });

  let totalDistrictVotes = 0;
  let totalPrVotes = 0;
  let totalDistrictSeats = 0;
  let totalPrSeats = 0;
  let uncontestedCount = 0;

  Object.values(districts).forEach(d => {
    totalDistrictSeats += d.seats;
    if (d.isUncontested) uncontestedCount++;

    (d.candidates || []).forEach(c => {
      if (stats[c.party]) {
        stats[c.party].candidates++;
        if (c.votes !== null) {
          stats[c.party].districtVotes += Number(c.votes) || 0;
          totalDistrictVotes += Number(c.votes) || 0;
        }
      }
    });

    (d.winners || []).forEach(pid => {
      if (stats[pid]) {
        stats[pid].districtSeats++;
        stats[pid].totalSeats++;
      }
    });
  });

  prBlocks.forEach(b => {
    totalPrSeats += b.seats;
    parties.forEach(p => {
      const v = Number(b.votes?.[p.id]) || 0;
      stats[p.id].prVotes += v;
      totalPrVotes += v;
      const s = Number(b.allocated?.[p.id]) || 0;
      stats[p.id].prSeats += s;
      stats[p.id].totalSeats += s;
    });
  });

  const grandTotalSeats = totalDistrictSeats + totalPrSeats;
  const grandTotalVotes = totalDistrictVotes + totalPrVotes;

  parties.forEach(p => {
    const s = stats[p.id];
    s.totalVotes = s.districtVotes + s.prVotes;
    s.districtVoteShare = totalDistrictVotes > 0 ? (s.districtVotes / totalDistrictVotes) * 100 : 0;
    s.prVoteShare = totalPrVotes > 0 ? (s.prVotes / totalPrVotes) * 100 : 0;
    s.totalVoteShare = grandTotalVotes > 0 ? (s.totalVotes / grandTotalVotes) * 100 : 0;
    s.seatShare = grandTotalSeats > 0 ? (s.totalSeats / grandTotalSeats) * 100 : 0;
    s.winRate = s.candidates > 0 ? (s.districtSeats / s.candidates) * 100 : 0;
  });

  return {
    parties: stats,
    totals: {
      districtVotes: totalDistrictVotes,
      prVotes: totalPrVotes,
      grandVotes: grandTotalVotes,
      districtSeats: totalDistrictSeats,
      prSeats: totalPrSeats,
      grandSeats: grandTotalSeats,
      uncontestedCount,
      districtCount: Object.keys(districts).length,
      majorityThreshold: Math.floor(grandTotalSeats / 2) + 1
    }
  };
}

function renderStatsTab() {
  const container = $("#statsContainer");
  if (!container) return;

  const data = computeElectionStats();
  const t = data.totals;

  const activeParties = parties.filter(p => {
    const s = data.parties[p.id];
    return s.totalSeats > 0 || s.candidates > 0 || s.totalVotes > 0;
  });
  const listToDisplay = activeParties.length > 0 ? activeParties : parties;

  container.innerHTML = `
    <div class="stats-summary-grid">
      <div class="stats-card">
        <div class="stats-card-num">${t.grandSeats}</div>
        <div class="stats-card-label">??? (???: ${t.districtSeats} / ??: ${t.prSeats})</div>
      </div>
      <div class="stats-card">
        <div class="stats-card-num">${t.majorityThreshold}</div>
        <div class="stats-card-label">???????????</div>
      </div>
      <div class="stats-card">
        <div class="stats-card-num">${t.districtVotes.toLocaleString()}</div>
        <div class="stats-card-label">???? ??????</div>
      </div>
      <div class="stats-card">
        <div class="stats-card-num">${t.uncontestedCount} / ${t.districtCount}</div>
        <div class="stats-card-label">????? (${t.districtCount > 0 ? ((t.uncontestedCount / t.districtCount) * 100).toFixed(1) : 0}%)</div>
      </div>
    </div>

    <div class="stats-section-title">??? ??????</div>
    <div style="overflow-x:auto;">
      <table class="stats-table">
        <thead>
          <tr>
            <th>??</th>
            <th>????</th>
            <th>???</th>
            <th>???</th>
            <th>?????</th>
            <th>?????</th>
            ${prBlocks.length > 0 ? '<th>?????</th><th>?????</th>' : ''}
            <th>???</th>
          </tr>
        </thead>
        <tbody>
          ${listToDisplay.map(p => {
            const s = data.parties[p.id];
            return `
              <tr>
                <td>
                  <span class="stats-color-dot" style="background:${p.color};"></span>
                  ${escapeHtml(p.shortName)}
                </td>
                <td style="font-weight:700;">${s.totalSeats}</td>
                <td>${s.seatShare.toFixed(1)}%</td>
                <td>${s.candidates}</td>
                <td>${s.districtVotes.toLocaleString()}</td>
                <td>${s.districtVoteShare.toFixed(2)}%</td>
                ${prBlocks.length > 0 ? `<td>${s.prVotes.toLocaleString()}</td><td>${s.prVoteShare.toFixed(2)}%</td>` : ''}
                <td>${s.candidates > 0 ? `${s.winRate.toFixed(1)}%` : '-'}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function exportStatsCsv() {
  const data = computeElectionStats();
  const hasPr = prBlocks.length > 0;

  const headers = ["???", "??", "?????", "?????", "????", "?????(%)", "?????", "???????", "???????(%)"];
  if (hasPr) {
    headers.push("?????", "?????(%)", "????", "?????(%)");
  }
  headers.push("???(%)");

  const rows = [headers];
  parties.forEach(p => {
    const s = data.parties[p.id];
    const row = [
      `"${p.name}"`,
      `"${p.shortName}"`,
      s.totalSeats,
      s.districtSeats,
      s.prSeats,
      s.seatShare.toFixed(2),
      s.candidates,
      s.districtVotes,
      s.districtVoteShare.toFixed(2)
    ];
    if (hasPr) {
      row.push(s.prVotes, s.prVoteShare.toFixed(2), s.totalVotes, s.totalVoteShare.toFixed(2));
    }
    row.push(s.candidates > 0 ? s.winRate.toFixed(2) : "0.00");
    rows.push(row);
  });

  const csvContent = "\uFEFF" + rows.map(r => r.join(",")).join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFileName($("#electionTitle")?.value || "election-stats")}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
  notify("????????CSV??????????");
}

// --- ??????????????7? ---
function openDataSelectModal() {
  const modal = $("#dataSelectModal");
  const body = $("#dataSelectModalBody");
  if (!modal || !body) return;

  const maps = dataIndex.maps || [];
  if (maps.length === 0) {
    body.innerHTML = `
      <div class="info-box">????????????????????????</div>
    `;
  } else {
    body.innerHTML = `
      <div class="data-select-list">
        ${maps.map((m, idx) => `
          <div class="data-select-item">
            <div class="data-item-info">
              <div class="data-item-name">${escapeHtml(m.name)}</div>
              <div class="data-item-desc">${escapeHtml(m.description || "")}</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="data-item-preview">${escapeHtml(m.preview || m.type)}</span>
              <button class="btn-primary small-btn" data-load-map-idx="${idx}">??</button>
            </div>
          </div>
        `).join("")}
      </div>
    `;

    body.querySelectorAll("[data-load-map-idx]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const idx = Number(btn.dataset.loadMapIdx);
        const targetMap = maps[idx];
        if (!targetMap) return;

        try {
          setStatus(`${targetMap.name} ??????...`);
          const res = await fetch(targetMap.file);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const geojson = await res.json();

          pushHistory();
          geoData = geojson;
          districts = {};
          selectedDistrictId = null;
          collapsedDistrictIds = new Set(); // ??2: ?????????

          geojson.features.forEach(f => {
            const id = idOf(f);
            const sample = (SAMPLE_DISTRICT_VOTES && SAMPLE_DISTRICT_VOTES[id]) || null;
            const candList = sample
              ? sample.candidates.map((c, i) => ({
                  id: `cand-${Math.random().toString(36).slice(2, 8)}`,
                  name: c.name, party: c.party, votes: c.votes, rank: i + 1
                }))
              : parties.slice(0, 3).map((p, i) => ({
                  id: `cand-${Math.random().toString(36).slice(2, 8)}`,
                  name: `${p.shortName}??`, party: p.id, votes: null, rank: i + 1
                }));

            districts[id] = {
              id,
              name: f.properties?.name || id,
              seats: Number($("#batchSeatsInput")?.value) || 1,
              mode: "votes",
              candidates: candList
            };

            collapsedDistrictIds.add(id); // ????
          });

          if ($("#dataStatus")) $("#dataStatus").textContent = `${targetMap.name} ?${geojson.features.length} ????`;
          recalcAll();
          renderAll();
          updateDistrictInspector();
          modal.classList.remove("show");
          notify(`?${targetMap.name}?????????`);
          markDirty();
        } catch (err) {
          notify(`???????: ${err.message}`);
        }
      });
    });
  }

  modal.classList.add("show");
}

// --- ???????? ---
function bindEvents() {
  $$(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  const helpModal = $("#helpModal");
  if ($("#helpBtn")) $("#helpBtn").addEventListener("click", () => helpModal.classList.add("show"));
  if ($("#closeHelpModalBtn")) $("#closeHelpModalBtn").addEventListener("click", () => helpModal.classList.remove("show"));
  if ($("#gotItHelpBtn")) $("#gotItHelpBtn").addEventListener("click", () => helpModal.classList.remove("show"));
  if (helpModal) {
    helpModal.addEventListener("click", e => {
      if (e.target === helpModal) helpModal.classList.remove("show");
    });
  }

  const dataModal = $("#dataSelectModal");
  if ($("#openDataSelectBtn")) $("#openDataSelectBtn").addEventListener("click", openDataSelectModal);
  if ($("#closeDataSelectModalBtn")) $("#closeDataSelectModalBtn").addEventListener("click", () => dataModal.classList.remove("show"));
  if ($("#cancelDataSelectBtn")) $("#cancelDataSelectBtn").addEventListener("click", () => dataModal.classList.remove("show"));
  if (dataModal) {
    dataModal.addEventListener("click", e => {
      if (e.target === dataModal) dataModal.classList.remove("show");
    });
  }

  if ($("#expandAllDistrictsBtn")) {
    $("#expandAllDistrictsBtn").addEventListener("click", () => {
      collapsedDistrictIds.clear();
      renderDistrictEditor();
    });
  }
  if ($("#collapseAllDistrictsBtn")) {
    $("#collapseAllDistrictsBtn").addEventListener("click", () => {
      Object.keys(districts).forEach(id => collapsedDistrictIds.add(id));
      renderDistrictEditor();
    });
  }

  if ($("#globalModeVotesBtn")) {
    $("#globalModeVotesBtn").addEventListener("click", () => {
      pushHistory();
      $("#globalModeVotesBtn").classList.add("active");
      $("#globalModeRankBtn").classList.remove("active");
      Object.values(districts).forEach(d => { d.mode = "votes"; recalcDistrict(d.id); });
      renderDistrictEditor();
      renderMap();
      updateDistrictInspector();
      renderStatsTab();
      markDirty();
      notify("???????????????????????????");
    });
  }
  if ($("#globalModeRankBtn")) {
    $("#globalModeRankBtn").addEventListener("click", () => {
      pushHistory();
      $("#globalModeRankBtn").classList.add("active");
      $("#globalModeVotesBtn").classList.remove("active");
      Object.values(districts).forEach(d => { d.mode = "rank"; recalcDistrict(d.id); });
      renderDistrictEditor();
      renderMap();
      updateDistrictInspector();
      renderStatsTab();
      markDirty();
      notify("????????????????????????????");
    });
  }

  if ($("#inspModeVotesBtn")) {
    $("#inspModeVotesBtn").addEventListener("click", () => {
      if (!selectedDistrictId || !districts[selectedDistrictId]) return;
      pushHistory();
      districts[selectedDistrictId].mode = "votes";
      recalcDistrict(selectedDistrictId);
      renderMap();
      updateDistrictInspector();
      renderDistrictEditor();
      renderStatsTab();
      markDirty();
    });
  }
  if ($("#inspModeRankBtn")) {
    $("#inspModeRankBtn").addEventListener("click", () => {
      if (!selectedDistrictId || !districts[selectedDistrictId]) return;
      pushHistory();
      districts[selectedDistrictId].mode = "rank";
      recalcDistrict(selectedDistrictId);
      renderMap();
      updateDistrictInspector();
      renderDistrictEditor();
      renderStatsTab();
      markDirty();
    });
  }

  if ($("#presetSelect")) $("#presetSelect").addEventListener("change", e => applyPreset(e.target.value));

  if ($("#batchSetSeatsBtn")) {
    $("#batchSetSeatsBtn").addEventListener("click", () => {
      batchSetDistrictSeats($("#batchSeatsInput").value);
    });
  }

  if ($("#batchAddPartyCandBtn")) $("#batchAddPartyCandBtn").addEventListener("click", () => batchAddPartyCandidates($("#batchPartySelect").value));
  if ($("#batchDelPartyCandBtn")) $("#batchDelPartyCandBtn").addEventListener("click", () => batchRemovePartyCandidates($("#batchPartySelect").value));
  if ($("#setupMajorPartiesBtn")) $("#setupMajorPartiesBtn").addEventListener("click", setupMajorPartiesCandidates);
  if ($("#clearAllCandidatesBtn")) $("#clearAllCandidatesBtn").addEventListener("click", clearAllCandidates);

  if ($("#downloadSampleGeoJsonBtn")) $("#downloadSampleGeoJsonBtn").addEventListener("click", downloadSampleGeoJson);

  // ??3: showWinnerNames ???
  ["showBalls", "showDistrictNames", "showShareText", "showLegend", "showMajorityBar"].forEach(id => {
    const el = $("#" + id);
    if (el) {
      el.addEventListener("change", () => {
        pushHistory();
        renderMap();
        markDirty();
      });
    }
  });

  ["shadingMethod", "ballStyle", "prLayoutPosition"].forEach(id => {
    const el = $("#" + id);
    if (el) {
      el.addEventListener("change", () => {
        pushHistory();
        renderMap();
        markDirty();
      });
    }
  });

  if ($("#electionTitle")) {
    $("#electionTitle").addEventListener("input", () => {
      renderMap();
      markDirty();
    });
  }
  if ($("#electionSubtitle")) {
    $("#electionSubtitle").addEventListener("input", () => {
      renderMap();
      markDirty();
    });
  }

  if ($("#addPrBlockBtn")) {
    $("#addPrBlockBtn").addEventListener("click", () => {
      pushHistory();
      const newIdx = prBlocks.length + 1;
      const votes = {};
      const shares = {};
      parties.forEach(p => { votes[p.id] = 0; shares[p.id] = "0.00"; });

      prBlocks.push({
        id: `pr-block-${Math.random().toString(36).slice(2, 7)}`,
        name: `?${newIdx}??????`,
        seats: 10,
        allocationMethod: "dhondt",
        mode: "votes",
        votes,
        shares,
        allocated: {}
      });

      recalcAll();
      renderPrBlockEditor();
      renderMap();
      renderStatsTab();
      markDirty();
      notify("????????????");
    });
  }

  if ($("#clearPrBlocksBtn")) {
    $("#clearPrBlocksBtn").addEventListener("click", () => {
      if (!confirm("?????????????????")) return;
      pushHistory();
      prBlocks = [];
      renderPrBlockEditor();
      renderMap();
      renderStatsTab();
      markDirty();
      notify("???????????");
    });
  }

  if ($("#addPartyBtn")) {
    $("#addPartyBtn").addEventListener("click", () => {
      pushHistory();
      const colors = ["#475569", "#7c3aed", "#0891b2", "#059669", "#d97706", "#dc2626"];
      const col = colors[parties.length % colors.length];
      const pid = `p_${Math.random().toString(36).slice(2, 7)}`;
      parties.push({
        id: pid,
        name: `???${parties.length + 1}`,
        shortName: `??${parties.length + 1}`,
        color: col
      });
      recalcAll();
      renderAll();
      updateBatchPartyOptions();
      markDirty();
      notify("?????????");
    });
  }

  if ($("#resetPartiesBtn")) {
    $("#resetPartiesBtn").addEventListener("click", async () => {
      if (!confirm("???????????????????")) return;
      pushHistory();
      const partiesData = await fetch("data/parties.json").then(r => r.json());
      parties = partiesData.parties;
      recalcAll();
      renderAll();
      updateBatchPartyOptions();
      markDirty();
      notify("???????????");
    });
  }

  if ($("#districtFilterInput")) {
    $("#districtFilterInput").addEventListener("input", renderDistrictEditor);
  }

  if ($("#exportStatsCsvBtn")) $("#exportStatsCsvBtn").addEventListener("click", exportStatsCsv);
  if ($("#refreshStatsBtn")) $("#refreshStatsBtn").addEventListener("click", () => {
    recalcAll();
    renderStatsTab();
    notify("????????????");
  });

  if ($("#geojsonInput")) {
    $("#geojsonInput").addEventListener("change", e => e.target.files[0] && loadGeoJsonFile(e.target.files[0]));
  }
  const dropzone = $("#dropzone");
  if (dropzone) {
    ["dragenter", "dragover"].forEach(ev => dropzone.addEventListener(ev, e => {
      e.preventDefault();
      dropzone.style.borderColor = "var(--accent)";
    }));
    ["dragleave", "drop"].forEach(ev => dropzone.addEventListener(ev, e => {
      e.preventDefault();
      dropzone.style.borderColor = "var(--line)";
    }));
    dropzone.addEventListener("drop", e => {
      const f = e.dataTransfer.files[0];
      if (f) loadGeoJsonFile(f);
    });
  }

  if ($("#inspCloseBtn")) {
    $("#inspCloseBtn").addEventListener("click", () => {
      selectedDistrictId = null;
      polyLayer.selectAll(".district-poly").classed("selected", false);
      $("#districtInspector").classList.remove("show");
    });
  }

  if ($("#inspAddCandBtn")) {
    $("#inspAddCandBtn").addEventListener("click", () => {
      if (!selectedDistrictId || !districts[selectedDistrictId]) return;
      pushHistory();
      const d = districts[selectedDistrictId];
      if (!d.candidates) d.candidates = [];
      d.candidates.push({
        id: `cand-${Math.random().toString(36).slice(2, 8)}`,
        name: "????",
        party: parties[0]?.id || "ldp",
        votes: null,
        rank: d.candidates.length + 1
      });
      recalcDistrict(d.id);
      renderMap();
      updateDistrictInspector();
      renderDistrictEditor();
      renderStatsTab();
      markDirty();
    });
  }

  if ($("#inspSeatsInput")) {
    $("#inspSeatsInput").addEventListener("change", e => {
      if (!selectedDistrictId || !districts[selectedDistrictId]) return;
      pushHistory();
      districts[selectedDistrictId].seats = Math.max(1, Number(e.target.value) || 1);
      recalcDistrict(selectedDistrictId);
      renderMap();
      updateDistrictInspector();
      renderDistrictEditor();
      renderStatsTab();
      markDirty();
    });
  }

  if ($("#bgRect")) {
    $("#bgRect").addEventListener("click", () => {
      selectedDistrictId = null;
      polyLayer.selectAll(".district-poly").classed("selected", false);
      if ($("#districtInspector")) $("#districtInspector").classList.remove("show");
    });
  }

  if ($("#undoBtn")) $("#undoBtn").addEventListener("click", undo);
  if ($("#redoBtn")) $("#redoBtn").addEventListener("click", redo);

  if ($("#newProjectBtn")) {
    $("#newProjectBtn").addEventListener("click", () => {
      if (!confirm("?????????????????????????????")) return;
      pushHistory();
      if ($("#electionTitle")) $("#electionTitle").value = "????????";
      if ($("#electionSubtitle")) $("#electionSubtitle").value = "???????????????";
      loadSampleData(false);
      notify("??????????????");
    });
  }
  if ($("#saveProjectBtn")) $("#saveProjectBtn").addEventListener("click", saveProjectFile);
  if ($("#loadProjectBtn")) $("#loadProjectBtn").addEventListener("click", () => $("#projectInput")?.click());
  if ($("#projectInput")) $("#projectInput").addEventListener("change", e => e.target.files[0] && loadProjectFile(e.target.files[0]));

  if ($("#exportSystemBtn")) $("#exportSystemBtn").addEventListener("click", exportSystemDefinition);
  if ($("#importSystemBtn")) $("#importSystemBtn").addEventListener("click", () => $("#systemInput")?.click());
  if ($("#systemInput")) $("#systemInput").addEventListener("change", e => e.target.files[0] && importSystemDefinition(e.target.files[0]));

  if ($("#exportSvgBtn")) $("#exportSvgBtn").addEventListener("click", exportSvgMap);
  if ($("#exportPngBtn")) $("#exportPngBtn").addEventListener("click", exportPngMap);

  const zoom = d3.zoom().scaleExtent([0.6, 10]).on("zoom", e => {
    rootGroup.attr("transform", e.transform);
  });
  svg.call(zoom);

  if ($("#zoomIn")) $("#zoomIn").addEventListener("click", () => svg.transition().duration(250).call(zoom.scaleBy, 1.25));
  if ($("#zoomOut")) $("#zoomOut").addEventListener("click", () => svg.transition().duration(250).call(zoom.scaleBy, 0.8));
  if ($("#zoomReset")) $("#zoomReset").addEventListener("click", () => svg.transition().duration(250).call(zoom.transform, d3.zoomIdentity));
  if ($("#fitMap")) {
    $("#fitMap").addEventListener("click", () => {
      svg.transition().duration(250).call(zoom.transform, d3.zoomIdentity);
      renderMap();
      setStatus("?????????");
    });
  }

  window.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      if ($("#helpModal")) $("#helpModal").classList.remove("show");
      if ($("#dataSelectModal")) $("#dataSelectModal").classList.remove("show");
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveProjectFile();
    }
  });
}

function switchTab(tabId) {
  $$(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tabId));
  $$(".tab-content").forEach(c => c.classList.toggle("active", c.id === tabId));
  if (tabId === "tab-stats") {
    renderStatsTab();
  }
}

function downloadSampleGeoJson() {
  if (!geoData) {
    notify("???????????");
    return;
  }
  const str = JSON.stringify(geoData, null, 2);
  const blob = new Blob([str], { type: "application/geo+json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "okayama-sample.geojson";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
  notify("????GeoJSON???????????");
}

function loadGeoJsonFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      if (d.type !== "FeatureCollection" || !Array.isArray(d.features)) {
        throw new Error("???GeoJSON (FeatureCollection) ???????");
      }
      pushHistory();
      geoData = d;
      districts = {};
      selectedDistrictId = null;
      collapsedDistrictIds = new Set(); // ??2: ?????????

      d.features.forEach(f => {
        const id = idOf(f);
        districts[id] = {
          id,
          name: f.properties?.name || id,
          seats: Number($("#batchSeatsInput")?.value) || 1,
          mode: "votes",
          candidates: parties.slice(0, 3).map((p, idx) => ({
            id: `cand-${Math.random().toString(36).slice(2, 8)}`,
            name: `${p.shortName}??`,
            party: p.id,
            votes: null,
            rank: idx + 1
          }))
        };
        collapsedDistrictIds.add(id);
      });

      if ($("#dataStatus")) $("#dataStatus").textContent = `${file.name} ?${d.features.length} ????`;
      recalcAll();
      renderAll();
      updateDistrictInspector();
      notify(`?????????? (${d.features.length}???)`);
      markDirty();
    } catch (err) {
      notify(`???????: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

function saveProjectFile() {
  const data = JSON.stringify(snapshot(), null, 2);
  const blob = new Blob([data], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFileName($("#electionTitle")?.value || "election-project")}.emproj.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
  markClean();
  notify("?????????????");
}

function loadProjectFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const s = JSON.parse(reader.result);
      if (!s.geoData || !s.districts) throw new Error("??????????????????");
      pushHistory();
      restore(s);
      markClean();
      notify("??????????????");
    } catch (err) {
      notify(`??????????: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

function exportSystemDefinition() {
  const systemData = {
    type: "election-system-definition",
    version: 1,
    name: PRESETS[currentPreset]?.name || "????????",
    preset: currentPreset,
    districtSeatsMap: Object.fromEntries(Object.entries(districts).map(([id, d]) => [id, d.seats])),
    prBlocksDefinition: prBlocks.map(b => ({
      name: b.name,
      seats: b.seats,
      allocationMethod: b.allocationMethod
    }))
  };

  const blob = new Blob([JSON.stringify(systemData, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFileName(systemData.name)}.emsys.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
  notify("?????????????");
}

function importSystemDefinition(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const s = JSON.parse(reader.result);
      if (s.type !== "election-system-definition") {
        throw new Error("????????????????????");
      }
      pushHistory();
      if (s.preset && PRESETS[s.preset]) {
        currentPreset = s.preset;
        if ($("#presetSelect")) $("#presetSelect").value = s.preset;
      }

      if (s.districtSeatsMap && geoData?.features) {
        Object.keys(s.districtSeatsMap).forEach(id => {
          if (districts[id]) districts[id].seats = s.districtSeatsMap[id];
        });
      }

      if (Array.isArray(s.prBlocksDefinition)) {
        prBlocks = s.prBlocksDefinition.map((def, idx) => {
          const votes = {};
          const shares = {};
          parties.forEach(p => { votes[p.id] = 0; shares[p.id] = "0.00"; });
          return {
            id: `pr-block-${idx + 1}`,
            name: def.name,
            seats: def.seats,
            allocationMethod: def.allocationMethod || "dhondt",
            mode: "votes",
            votes,
            shares,
            allocated: {}
          };
        });
      }

      updatePresetHint();
      recalcAll();
      renderAll();
      updateDistrictInspector();
      notify(`?????${s.name || "??????"}????????`);
      markDirty();
    } catch (err) {
      notify(`???????: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

// --- ???SVG???????Wikipedia????? ---
function exportSvgMap() {
  const clone = svg.node().cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", SVG_W);
  clone.setAttribute("height", SVG_H);
  clone.setAttribute("viewBox", `0 0 ${SVG_W} ${SVG_H}`);

  const styleEl = document.createElementNS("http://www.w3.org/2000/svg", "style");
  styleEl.textContent = `
    .district-poly { stroke: #ffffff; stroke-width: 1.8; }
    .map-svg-title { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif; font-size: 24px; font-weight: 800; fill: #111827; }
    .map-svg-subtitle { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif; font-size: 12px; font-weight: 500; fill: #4b5563; }
    .district-label-text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif; font-size: 12px; font-weight: 700; text-anchor: middle; fill: #111827; paint-order: stroke; stroke: #ffffff; stroke-width: 4px; }
    .district-share-text { font-family: Consolas, monospace; font-size: 9px; font-weight: 700; text-anchor: middle; fill: #374151; paint-order: stroke; stroke: #ffffff; stroke-width: 3px; }
    .seat-ball-circle { stroke: #ffffff; stroke-width: 1.5; }
    .seat-ball-number { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif; font-weight: 800; text-anchor: middle; dominant-baseline: central; fill: #ffffff; paint-order: stroke; stroke: #0f172a; stroke-width: 1.4px; }
    .pr-panel-bg { fill: #f8f9fa; stroke: #d1d5db; stroke-width: 1; rx: 3; }
    .pr-panel-title { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif; font-size: 13px; font-weight: 700; fill: #111827; }
    .pr-block-box { fill: #ffffff; stroke: #d1d5db; stroke-width: 1; rx: 2; }
    .pr-block-name { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif; font-size: 11px; font-weight: 700; fill: #1f2937; }
    .pr-block-meta { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif; font-size: 10px; fill: #6b7280; }
    .pr-seat-label { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif; font-size: 10px; fill: #374151; }
    .legend-panel-bg { fill: #ffffff; stroke: #d1d5db; stroke-width: 1; rx: 2; }
    .legend-heading { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif; font-size: 11px; font-weight: 700; fill: #111827; }
    .legend-party-name { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif; font-size: 10px; font-weight: 600; fill: #1f2937; }
    .legend-party-seats { font-family: Consolas, monospace; font-size: 10px; font-weight: 700; text-anchor: end; fill: #111827; }
    .shading-legend-label { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif; font-size: 9px; fill: #6b7280; }
    .majority-line-text { font-family: Consolas, monospace; font-size: 9px; font-weight: 700; fill: #b91c1c; }
  `;
  clone.insertBefore(styleEl, clone.firstChild);

  const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bgRect.setAttribute("width", SVG_W);
  bgRect.setAttribute("height", SVG_H);
  bgRect.setAttribute("fill", "#ffffff");
  clone.insertBefore(bgRect, clone.firstChild);

  const meta = document.createElementNS("http://www.w3.org/2000/svg", "metadata");
  meta.textContent = `Election Map Studio v6.0 | Wikipedia Standard | Generated: ${new Date().toISOString()}`;
  clone.insertBefore(meta, clone.firstChild);

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFileName($("#electionTitle")?.value || "election-map")}.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
  notify("SVG??????????");
}

function exportPngMap() {
  const clone = svg.node().cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", SVG_W);
  clone.setAttribute("height", SVG_H);

  const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bgRect.setAttribute("width", SVG_W);
  bgRect.setAttribute("height", SVG_H);
  bgRect.setAttribute("fill", "#ffffff");
  clone.insertBefore(bgRect, clone.firstChild);

  const xml = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const img = new Image();

  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = SVG_W * 2;
    canvas.height = SVG_H * 2;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);

    canvas.toBlob(pngBlob => {
      const u = URL.createObjectURL(pngBlob);
      const a = document.createElement("a");
      a.href = u;
      a.download = `${safeFileName($("#electionTitle")?.value || "election-map")}.png`;
      a.click();
      URL.revokeObjectURL(u);
      URL.revokeObjectURL(url);
      notify("????PNG????????");
    }, "image/png");
  };
  img.src = url;
}

// ????
init().catch(err => {
  console.error(err);
  notify(`??????: ${err.message}`);
});
