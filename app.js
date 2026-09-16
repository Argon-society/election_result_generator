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
    name: "\u5ca1\u5c711\u533a",
    candidates: [
      { name: "\u9022\u6ca2 \u4e00\u90ce", party: "ldp", votes: 85210 },
      { name: "\u539f\u7530 \u8b19\u4ecb", party: "cdp", votes: 64130 },
      { name: "\u4f59\u6176 \u5145\u4f38", party: "jcp", votes: 12050 }
    ]
  },
  "OK-2": {
    name: "\u5ca1\u5c712\u533a",
    candidates: [
      { name: "\u5c71\u4e0b \u8cb4\u53f8", party: "ldp", votes: 78540 },
      { name: "\u6d25\u6751 \u5553\u4ecb", party: "cdp", votes: 71220 },
      { name: "\u4f4f\u5bc4 \u8061\u7f8e", party: "ishin", votes: 18450 }
    ]
  },
  "OK-3": {
    name: "\u5ca1\u5c713\u533a",
    candidates: [
      { name: "\u52a0\u85e4 \u52dd\u4fe1", party: "ldp", votes: 91400 },
      { name: "\u539f\u7530 \u5065\u543e", party: "cdp", votes: 38200 },
      { name: "\u5c3e\u5d0e \u5b8f\u5b50", party: "jcp", votes: 8900 }
    ]
  },
  "OK-4": {
    name: "\u5ca1\u5c714\u533a",
    candidates: [
      { name: "\u67da\u6728 \u9053\u7fa9", party: "cdp", votes: 83500 },
      { name: "\u6a4b\u672c \u5cb3", party: "ldp", votes: 79200 }
    ]
  },
  "OK-5": {
    name: "\u5ca1\u5c715\u533a",
    candidates: [
      { name: "\u52a0\u85e4 \u6d69\u5e73", party: "ldp", votes: 71000 },
      { name: "\u306f\u305f \u3068\u3082\u3053", party: "cdp", votes: 48500 },
      { name: "\u5c0f\u897f \u5f66\u6cbb", party: "ind", votes: 15300 }
    ]
  }
};

const SAMPLE_PR_BLOCKS = [
  {
    id: "pr-chugoku",
    name: "\u4e2d\u56fd\u6bd4\u4f8b\u30d6\u30ed\u30c3\u30af",
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
    name: "\u5c0f\u9078\u6319\u533a\u6bd4\u4f8b\u4ee3\u8868\u4e26\u7acb\u5236\uff08\u8846\u8b70\u9662\u30e2\u30c7\u30eb\uff09",
    defaultSeats: 1,
    allocation: "dhondt",
    hint: "\u5c0f\u9078\u6319\u533a\uff08\u4e00\u5f8b1\u4eba\u533a\u30fb\u6700\u591a\u5f97\u7968\u5f53\u9078\uff09\u3068\u3001\u5730\u56f3\u5916\u306e\u6bd4\u4f8b\u4ee3\u8868\u30d6\u30ed\u30c3\u30af\uff08\u30c9\u30f3\u30c8\u5f0f\u914d\u5206\uff09\u3092\u7d44\u307f\u5408\u308f\u305b\u305f\u5236\u5ea6\u3067\u3059\u3002",
    defaultPrBlocks: () => JSON.parse(JSON.stringify(SAMPLE_PR_BLOCKS))
  },
  "smd-simple": {
    name: "\u5358\u7d14\u5c0f\u9078\u6319\u533a\u5236\uff08\u4e00\u5f8b1\u4eba\u533a\u30fb\u6bd4\u4f8b\u306a\u3057\uff09",
    defaultSeats: 1,
    allocation: "dhondt",
    hint: "\u5404\u9078\u6319\u533a1\u8b70\u5e2d\u306e\u5358\u7d14\u5c0f\u9078\u6319\u533a\u5236\uff08FPTP\uff09\u3002\u6700\u591a\u5f97\u7968\u8005\u304c\u5f53\u9078\u3068\u306a\u308a\u3001\u6bd4\u4f8b\u4ee3\u8868\u533a\u306f\u8a2d\u5b9a\u3055\u308c\u307e\u305b\u3093\u3002",
    defaultPrBlocks: () => []
  },
  "mmd-sntv": {
    name: "\u5927\u9078\u6319\u533a\u30fb\u4e2d\u9078\u6319\u533a\u5236\uff08\u5358\u8a18\u975e\u79fb\u8b72\u5f0f\u30fb\u6bd4\u4f8b\u306a\u3057\uff09",
    defaultSeats: 3,
    allocation: "dhondt",
    hint: "\u8907\u6570\u4eba\u533a\uff08\u5404\u533a3\u301c5\u4eba\u533a\u306a\u3069\uff09\u306e\u5358\u8a18\u975e\u79fb\u8b72\u5f0f\u3002\u5f97\u7968\u4e0a\u4f4d\u304b\u3089\u5b9a\u6570\u5206\u304c\u5f53\u9078\u3002\u9818\u57df\u8272\u306f\u6700\u591a\u5f97\u7968\u515a\u306e\u5272\u5408\u3067\u8868\u73fe\u3057\u307e\u3059\u3002",
    defaultPrBlocks: () => []
  },
  "parallel-custom": {
    name: "\u5927\u9078\u6319\u533a\u6bd4\u4f8b\u4ee3\u8868\u4e26\u7acb\u5236\uff08\u8907\u6570\u4eba\u533a\uff0b\u6bd4\u4f8b\uff09",
    defaultSeats: 3,
    allocation: "dhondt",
    hint: "\u5730\u57df\u9078\u6319\u533a\u304c\u8907\u6570\u4eba\u533a\uff08\u4e2d\u9078\u6319\u533a\uff09\u3067\u3001\u3055\u3089\u306b\u6bd4\u4f8b\u4ee3\u8868\u533a\u304c\u4e26\u7acb\u3059\u308b\u30cf\u30a4\u30d6\u30ea\u30c3\u30c9\u5236\u5ea6\u3067\u3059\u3002",
    defaultPrBlocks: () => JSON.parse(JSON.stringify(SAMPLE_PR_BLOCKS))
  },
  "custom": {
    name: "\u30ab\u30b9\u30bf\u30e0\u9078\u6319\u5236\u5ea6",
    defaultSeats: 1,
    allocation: "dhondt",
    hint: "\u9078\u6319\u533a\u3054\u3068\u306e\u5b9a\u6570\u3084\u6bd4\u4f8b\u533a\u306e\u6709\u7121\u30fb\u5b9a\u6570\u30fb\u65b9\u5f0f\u3092\u5b8c\u5168\u306b\u81ea\u7531\u8a2d\u5b9a\u3067\u304d\u307e\u3059\u3002",
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
  return parties.find(p => p.id === pid) || { id: pid, name: pid || "\u4e0d\u660e", shortName: pid || "\u4e0d\u660e", color: "#64748b" };
}

function idOf(f) {
  const field = $("#idField") ? $("#idField").value : "auto";
  if (field === "id") return String(f.id ?? "");
  if (field === "name") return String(f.properties?.name ?? "");
  if (field === "code") return String(f.properties?.code ?? "");
  return String(f.id ?? f.properties?.id ?? f.properties?.code ?? f.properties?.name ?? "");
}

// --- \u6bd4\u4f8b\u914d\u5206\u30a2\u30eb\u30b4\u30ea\u30ba\u30e0 ---
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

  // \u6700\u5927\u5270\u4f59\u5f0f (Hare / Droop)
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

// --- \u9078\u6319\u533a\u96c6\u8a08 ---
function recalcDistrict(id) {
  const d = districts[id];
  if (!d) return;

  const seats = Math.max(1, Number(d.seats) || 1);
  d.seats = seats;
  if (!d.mode) d.mode = "votes";

  const candList = (d.candidates || []).map((c, idx) => ({
    id: c.id || `cand-${Math.random().toString(36).slice(2, 7)}`,
    name: c.name || "\u5019\u88dc\u8005",
    party: c.party || parties[0]?.id || "ldp",
    votes: (c.votes !== null && c.votes !== undefined && c.votes !== "") ? Number(c.votes) : null,
    rank: Number(c.rank) || (idx + 1)
  }));

  // \u8981\u4ef64: \u5019\u88dc\u8005\u6570\u3068\u5b9a\u6570\u304c\u540c\u4e00\u304b\u305d\u308c\u4ee5\u4e0b\u306e\u5834\u5408\u3001\u7121\u6295\u7968\u5f53\u9078
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
    // \u9806\u4f4d\u76f4\u63a5\u6307\u5b9a\u30e2\u30fc\u30c9
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

// --- \u6bd4\u4f8b\u533a\u96c6\u8a08 ---
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

// --- \u30b7\u30a7\u30fc\u30c7\u30a3\u30f3\u30b0\u95a2\u6570\uff08\u8981\u4ef65: \u6700\u591a\u5f53\u9078\u515a\u306e\u515a\u6d3e\u5272\u5408\u968e\u8abf\uff09 ---
function getDistrictFillColor(district) {
  if (!district) return "#d1d5db";
  const method = $("#shadingMethod") ? $("#shadingMethod").value : "winner-share-steps";

  // \u8981\u4ef65: \u9806\u4f4d\u76f4\u63a5\u6307\u5b9a\u53c8\u306f\u7121\u6295\u7968\u5f53\u9078\u306e\u9078\u6319\u533a\u306b\u304a\u3044\u3066\u306f\u3001
  // \u9078\u6319\u533a\u5185\u6700\u591a\u5f53\u9078\u515a\u306e\u515a\u6d3e\u5272\u5408\u3092\u3082\u3063\u3066\u7b2c\u4e00\u515a\u6d3e\u306e\u5f97\u7968\u7387\u306b\u63db\u3048\u3066\u30b0\u30e9\u30c7\u30fc\u30b7\u30e7\u30f3
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

    // \u5f53\u9078\u8b70\u5e2d\u5272\u5408\uff08\u5b9a\u6570\u306b\u5bfe\u3059\u308b\u6700\u591a\u5f53\u9078\u515a\u306e\u8b70\u5e2d\u5272\u5408\uff09
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

  // \u901a\u5e38\u5f97\u7968\u6570\u5165\u529b\u30e2\u30fc\u30c9
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

// --- \u30dc\u30fc\u30eb\u914d\u7f6e\u306e\u8907\u6570\u5217\u8a08\u7b97\uff08\u8981\u4ef61: \u9078\u6319\u533a\u67a0\u5185\u306f\u307f\u51fa\u3057\u9632\u6b62\uff09 ---
function computeBallLayout(n, availW, availH) {
  if (n <= 0) return { cols: 1, rows: 1, ballR: 6, gap: 16, gridW: 0, gridH: 0 };

  let ballR = 6.5;
  let gap = 16;

  // \u5229\u7528\u53ef\u80fd\u306a\u9ad8\u3055\u30fb\u5e45\u304c\u72ed\u3044\u5834\u5408\u306f\u30dc\u30fc\u30eb\u30b5\u30a4\u30ba\u3092\u7e2e\u5c0f
  if (availH < 35 || availW < 45) {
    ballR = 3.5;
    gap = 9;
  } else if (availH < 55 || availW < 70) {
    ballR = 4.5;
    gap = 12;
  } else if (availH < 75 || availW < 95) {
    ballR = 5.5;
    gap = 14;
  }

  // \u5e45\u306b\u5408\u308f\u305b\u305f\u5217\u6570\u8a08\u7b97
  let cols = Math.max(1, Math.min(n, Math.floor(availW / gap)));
  const aspect = availW / (availH || 1);

  if (aspect > 1.8) {
    cols = Math.min(n, Math.max(cols, Math.ceil(Math.sqrt(n) * 1.5)));
  } else if (aspect < 0.6) {
    cols = Math.min(cols, Math.max(1, Math.floor(Math.sqrt(n) * 0.7)));
  } else {
    cols = Math.min(n, Math.max(cols, Math.ceil(Math.sqrt(n))));
  }

  // \u5e45\u30aa\u30fc\u30d0\u30fc\u306e\u5834\u5408\u306f\u7e2e\u5c0f
  while (cols > 1 && (cols - 1) * gap + ballR * 2 > availW) {
    if (ballR > 3.2) {
      ballR -= 0.5;
      gap = ballR * 2 + 2;
    } else {
      cols--;
    }
  }

  let rows = Math.ceil(n / cols);
  // \u9ad8\u3055\u30aa\u30fc\u30d0\u30fc\u306e\u5834\u5408\u306f\u3055\u3089\u306b\u7e2e\u5c0f
  while (rows > 1 && (rows - 1) * gap + ballR * 2 > availH && ballR > 3.2) {
    ballR -= 0.5;
    gap = ballR * 2 + 2;
  }

  const gridW = cols > 1 ? (cols - 1) * gap : 0;
  const gridH = rows > 1 ? (rows - 1) * gap : 0;

  return { cols, rows, ballR, gap, gridW, gridH };
}

// --- \u5c65\u6b74\u7ba1\u7406 & LocalStorage ---
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
  notify("\u76f4\u524d\u306e\u64cd\u4f5c\u3092\u53d6\u308a\u6d88\u3057\u307e\u3057\u305f");
}

function redo() {
  if (!futureStack.length) return;
  historyStack.push(JSON.stringify(snapshot()));
  const next = JSON.parse(futureStack.pop());
  isHistoryLocked = true;
  restore(next);
  isHistoryLocked = false;
  notify("\u64cd\u4f5c\u3092\u3084\u308a\u76f4\u3057\u307e\u3057\u305f");
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
  if ($("#electionTitle")) $("#electionTitle").value = s.title || "\u9078\u6319\u7d50\u679c\u5730\u56f3";
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
  setStatus("\u72b6\u614b\u3092\u5fa9\u5143\u3057\u307e\u3057\u305f");
}

function markDirty() {
  isDirty = true;
  const el = $("#saveState");
  if (el) {
    el.textContent = "\u672a\u4fdd\u5b58\u306e\u5909\u66f4\u3042\u308a";
    el.style.color = "#b45309";
  }
}

function markClean() {
  isDirty = false;
  const el = $("#saveState");
  if (el) {
    el.textContent = "\u4fdd\u5b58\u6e08\u307f";
    el.style.color = "#059669";
  }
}

// --- \u521d\u671f\u5316 ---
async function init() {
  const partiesData = await fetch("data/parties.json").then(r => r.json()).catch(() => ({
    parties: [
      { id: "ldp", name: "\u81ea\u7531\u6c11\u4e3b\u515a", shortName: "\u81ea\u6c11", color: "#dc2626" },
      { id: "cdp", name: "\u7acb\u61bad\u6c11\u4e3b\u515a", shortName: "\u7acb\u61bad", color: "#2563eb" },
      { id: "ishin", name: "\u65e5\u672c\u7dad\u65b0\u306e\u4f1a", shortName: "\u7dad\u65b0", color: "#16a34a" },
      { id: "komei", name: "\u516c\u660e\u515a", shortName: "\u516c\u660e", color: "#ea580c" },
      { id: "dpp", name: "\u56fd\u6c11\u6c11\u4e3b\u515a", shortName: "\u56fd\u6c11", color: "#ca8a04" },
      { id: "jcp", name: "\u65e5\u672c\u5171\u7523\u515a", shortName: "\u5171\u7523", color: "#991b1b" },
      { id: "reiwa", name: "\u308c\u3044\u308f\u65b0\u9078\u7d44", shortName: "\u308c\u3044\u308f", color: "#db2777" },
      { id: "sansei", name: "\u53c2\u653f\u515a", shortName: "\u53c2\u653f", color: "#f97316" },
      { id: "sdp", name: "\u793e\u4f1a\u6c11\u4e3b\u515a", shortName: "\u793e\u6c11", color: "#4f46e5" },
      { id: "cpj", name: "\u65e5\u672c\u4fdd\u5b88\u515a", shortName: "\u4fdd\u5b88", color: "#1e3a8a" },
      { id: "ind", name: "\u7121\u6240\u5c5e\u30fb\u305d\u306e\u4ed6", shortName: "\u7121\u6240\u5c5e", color: "#64748b" }
    ]
  }));
  parties = partiesData.parties;

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
  setStatus("\u30b7\u30b9\u30c6\u30e0\u521d\u671f\u5316\u5b8c\u4e86");
}

async function loadSampleData(makeHistory = true) {
  const d = await fetch("data/okayama-sample.geojson").then(r => r.json());
  geoData = d;
  districts = {};
  selectedDistrictId = null;
  collapsedDistrictIds = new Set(); // \u8981\u4ef62: \u30c7\u30d5\u30a9\u30eb\u30c8\u6298\u308a\u7573\u307f

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
          name: `${p.shortName}\u5019\u88dc`,
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

    // \u8981\u4ef62: \u5404\u9078\u6319\u533a\u306f\u30c7\u30d5\u30a9\u30eb\u30c8\u3067\u6298\u308a\u7573\u307f\u72b6\u614b\u3068\u3059\u308b
    collapsedDistrictIds.add(id);
  });

  prBlocks = JSON.parse(JSON.stringify(SAMPLE_PR_BLOCKS));

  if (makeHistory) pushHistory();
  recalcAll();
  renderAll();
  if ($("#dataStatus")) $("#dataStatus").textContent = "\u5ca1\u5c71\u770c\u30b5\u30f3\u30d7\u30eb\uff085\u9078\u6319\u533a\uff0b\u6bd4\u4f8b\u4e2d\u56fd\u30d6\u30ed\u30c3\u30af\uff09";
}

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
  notify(`\u5236\u5ea6\u30d7\u30ea\u30bb\u30c3\u30c8\u300c${p.name}\u300d\u3092\u9069\u7528\u3057\u307e\u3057\u305f`);
}

function updatePresetHint() {
  const p = PRESETS[currentPreset] || PRESETS.custom;
  if ($("#presetHint")) $("#presetHint").textContent = p.hint;
}

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
        name: `${p.shortName}\u5019\u88dc`,
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
  notify(`\u5168\u9078\u6319\u533a\u306b\u300c${p.shortName}\u300d\u5019\u88dc\u3092\u4e00\u62ec\u8ffd\u52a0 (${addCount}\u540d\u8ffd\u52a0)`);
}

function batchRemovePartyCandidates(partyId) {
  if (!confirm(`\u5168\u9078\u6319\u533a\u304b\u3089\u300c${partyById(partyId).shortName}\u300d\u306e\u5019\u88dc\u8005\u3092\u524a\u9664\u3057\u307e\u3059\u304b\uff1f`)) return;
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
  notify(`\u5168\u9078\u6319\u533a\u304b\u3089\u300c${partyById(partyId).shortName}\u300d\u306e\u5019\u88dc\u8005\u3092\u524a\u9664 (${delCount}\u540d\u524a\u9664)`);
}

function setupMajorPartiesCandidates() {
  if (!confirm("\u5168\u9078\u6319\u533a\u306b\u4e3b\u8981\u653f\u515a\u306e\u5019\u88dc\u8005\u3092\u4e00\u62ec\u5c55\u958b\u3057\u307e\u3059\u304b\uff1f")) return;
  pushHistory();

  const majorParties = parties.slice(0, 4);
  Object.values(districts).forEach(d => {
    d.candidates = majorParties.map((p, idx) => ({
      id: `cand-${Math.random().toString(36).slice(2, 8)}`,
      name: `${p.shortName}\u5019\u88dc`,
      party: p.id,
      votes: null,
      rank: idx + 1
    }));
  });

  recalcAll();
  renderDistrictEditor();
  renderMap();
  updateDistrictInspector();
  notify("\u4e3b\u8981\u653f\u515a\u306e\u5019\u88dc\u8005\u3092\u4e00\u62ec\u5c55\u958b\u3057\u307e\u3057\u305f");
}

function clearAllCandidates() {
  if (!confirm("\u5168\u9078\u6319\u533a\u306e\u5019\u88dc\u8005\u3092\u30af\u30ea\u30a2\u3057\u307e\u3059\u304b\uff1f")) return;
  pushHistory();
  Object.values(districts).forEach(d => { d.candidates = []; });
  recalcAll();
  renderDistrictEditor();
  renderMap();
  updateDistrictInspector();
  notify("\u5168\u5019\u88dc\u8005\u3092\u30af\u30ea\u30a2\u3057\u307e\u3057\u305f");
}

function batchSetDistrictSeats(seats) {
  pushHistory();
  const val = Math.max(1, Number(seats) || 1);
  Object.values(districts).forEach(d => { d.seats = val; });
  recalcAll();
  renderDistrictEditor();
  renderMap();
  updateDistrictInspector();
  notify(`\u5168\u9078\u6319\u533a\u306e\u5b9a\u6570\u3092 ${val} \u8b70\u5e2d\u306b\u8a2d\u5b9a\u3057\u307e\u3057\u305f`);
}

// --- \u5730\u56f3\u30ec\u30f3\u30c0\u30ea\u30f3\u30b0\uff08\u8981\u4ef6\uff1a\u91cd\u306a\u308a\u30bc\u30ed\u30fb\u52d5\u7684\u30b9\u30bf\u30c3\u30af\u914d\u7f6e\uff09 ---
function renderMap() {
  if (!geoData) return;

  const prPosition = $("#prLayoutPosition") ? $("#prLayoutPosition").value : "bottom";
  const showBalls = $("#showBalls") ? $("#showBalls").checked : true;
  const ballStyle = $("#ballStyle") ? $("#ballStyle").value : "simple";
  const showShare = $("#showShareText") ? $("#showShareText").checked : true;
  const showNames = $("#showDistrictNames") ? $("#showDistrictNames").checked : true;
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

  // 1. \u30bf\u30a4\u30c8\u30eb
  const title = $("#electionTitle") ? $("#electionTitle").value : "\u9078\u6319\u7d50\u679c\u5730\u56f3";
  const subtitle = $("#electionSubtitle") ? $("#electionSubtitle").value : "";
  headerGroup.append("text").attr("class", "map-svg-title").attr("x", 40).attr("y", 42).text(title);
  if (subtitle) {
    headerGroup.append("text").attr("class", "map-svg-subtitle").attr("x", 40).attr("y", 60).text(subtitle);
  }

  // 2. \u904e\u534a\u6570\u7a4d\u307f\u4e0a\u3052\u30d0\u30fc
  if (showMajorityBar) {
    renderMajoritySeatBar();
  }

  // 3. \u5404\u9078\u6319\u533a\u30c7\u30fc\u30bf\u306e\u69cb\u7bc9
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

  // \u30dd\u30ea\u30b4\u30f3\u63cf\u753b
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
      const pName = d.maxParty ? partyById(d.maxParty).name : "\u5f53\u9078\u8005\u306a\u3057";
      let shareStr = "";
      if (d.isUncontested) shareStr = " (\u7121\u6295\u7968\u5f53\u9078)";
      else if (d.maxPartyShare !== null) shareStr = ` (${d.maxPartyShare.toFixed(1)}%)`;
      else shareStr = " (\u9806\u4f4d\u6307\u5b9a)";
      return `${d.name} (\u5b9a\u6570 ${d.seats})\n\u6700\u591a\u5f53\u9078\u515a: ${pName}${shareStr}`;
    });

  // 4. \u30c6\u30ad\u30b9\u30c8\u30fb\u30dc\u30fc\u30eb\u306e\u7d76\u5bfe\u91cd\u306a\u308a\u30bc\u30ed\u30fb\u52d5\u7684\u30b9\u30bf\u30c3\u30af\u914d\u7f6e\uff08\u8981\u4ef6\u6539\u5584\uff09
  districtList.forEach(d => {
    const hasName = showNames;
    const isUncontested = d.isUncontested;
    let shareText = "";
    if (showShare) {
      if (isUncontested) shareText = "\u7121\u6295\u7968\u5f53\u9078";
      else if (d.mode === "rank") shareText = "";
      else if (d.maxPartyShare !== null) shareText = `${d.maxPartyShare.toFixed(1)}%`;
    }
    const hasShareText = shareText.length > 0;
    const hasBalls = showBalls && d.seats > 0;

    const nameH = hasName ? 14 : 0;
    const shareH = hasShareText ? 11 : 0;
    const textReserve = nameH + shareH;

    const availW = Math.max(16, d.boundsW * 0.78);
    const availH = Math.max(12, (d.boundsH - textReserve) * 0.75);

    const ballLayout = computeBallLayout(d.seats, availW, availH);
    const ballsH = hasBalls ? ballLayout.gridH + ballLayout.ballR * 2 : 0;

    const gap1 = (hasName && (hasBalls || hasShareText)) ? 4 : 0;
    const gap2 = (hasBalls && hasShareText) ? 4 : 0;

    const totalStackH = nameH + gap1 + ballsH + gap2 + shareH;
    let curY = d.cy - totalStackH / 2;

    // A. \u9078\u6319\u533a\u540d\u30e9\u30d9\u30eb\uff08\u6700\u4e0a\u6bb5\uff09
    if (hasName) {
      const textBaselineY = curY + nameH / 2 + 3;
      textLayer.append("text")
        .attr("class", "district-label-text")
        .attr("x", d.cx)
        .attr("y", textBaselineY)
        .text(d.name);
      curY += nameH + gap1;
    }

    // B. \u8b70\u5e2d\u30dc\u30fc\u30eb\u7fa4\uff08\u4e2d\u6bb5\uff09
    if (hasBalls) {
      const { cols, rows, ballR, gap, gridW, gridH } = ballLayout;
      const startX = d.cx - gridW / 2;
      const startY = curY + ballR;

      for (let i = 0; i < d.seats; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const pid = d.winners[i] || null;

        const bx = startX + col * gap;
        const by = startY + row * gap;

        const bg = ballLayer.append("g")
          .attr("class", "seat-ball-group")
          .attr("transform", `translate(${bx},${by})`);

        bg.append("circle")
          .attr("class", "seat-ball-circle")
          .attr("r", ballR)
          .attr("fill", pid ? partyById(pid).color : "#94a3b8")
          .append("title")
          .text(`${i + 1}\u4f4d\u5f53\u9078: ${pid ? partyById(pid).name : "\u672a\u5b9a"}`);

        if (ballStyle === "number") {
          bg.append("text")
            .attr("class", "seat-ball-number")
            .style("font-size", `${Math.max(5.5, ballR * 1.15)}px`)
            .text(i + 1);
        }
      }
      curY += ballsH + gap2;
    }

    // C. \u5f97\u7968\u7387\u30c6\u30ad\u30b9\u30c8\uff08\u6700\u4e0b\u6bb5\uff09
    if (hasShareText) {
      const shareBaselineY = curY + shareH / 2 + 2;
      textLayer.append("text")
        .attr("class", "district-share-text")
        .attr("x", d.cx)
        .attr("y", shareBaselineY)
        .text(shareText);
    }
  });

  // 5. \u6bd4\u4f8b\u4ee3\u8868\u30d6\u30ed\u30c3\u30af
  if (prPosition !== "none" && prBlocks.length > 0) {
    renderPrSvgBlocks(prPosition);
  }

  // 6. \u51e1\u4f8b\uff08\u8981\u4ef66: \u6bd4\u4f8b\u533a\u306a\u3057\u5bfe\u5fdc\uff09
  if (showLegend) {
    renderSvgLegend(prPosition);
  }

  updateTotalSeatSummary();
}

// --- \u904e\u534a\u6570\u7a4d\u307f\u4e0a\u3052\u30d0\u30fc ---
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
        .text(`${p.name}: ${seats}\u8b70\u5e2d (${((seats / grandTotal) * 100).toFixed(1)}%)`);

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
    .text(`\u904e\u534a\u6570: ${majorityThreshold} / ${grandTotal}`);
}

// --- \u6bd4\u4f8b\u4ee3\u8868SVG\u30d6\u30ed\u30c3\u30af ---
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
    .text(`\u6bd4\u4f8b\u4ee3\u8868\u30d6\u30ed\u30c3\u30af \uff08\u8a08 ${totalPrSeats} \u8b70\u5e2d\uff09`);

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
      "dhondt": "\u30c9\u30f3\u30c8\u5f0f",
      "sainte-lague": "\u30b5\u30f3\uff1d\u30e9\u30b0\u5f0f",
      "largest-remainder-hare": "\u6700\u5927\u5270\u4f59(Hare)",
      "largest-remainder-droop": "\u6700\u5927\u5270\u4f59(Droop)"
    }[block.allocationMethod] || "\u30c9\u30f3\u30c8\u5f0f";

    blockG.append("text")
      .attr("class", "pr-block-name")
      .attr("x", 10).attr("y", 18)
      .text(block.name || `\u6bd4\u4f8b\u533a ${bIdx + 1}`);

    blockG.append("text")
      .attr("class", "pr-block-meta")
      .attr("x", blockW - 10).attr("y", 18)
      .attr("text-anchor", "end")
      .text(`\u5b9a\u6570 ${block.seats} / ${methodLabel}`);

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
        .text(`${idx + 1}\u8b70\u5e2d\u76ee: ${partyById(pid).name}`);
    });

    const summaryG = blockG.append("g").attr("transform", `translate(10, ${summaryStartY})`);
    if (activeParties.length === 0) {
      summaryG.append("text").attr("class", "pr-seat-label").text("\u8b70\u5e2d\u914d\u5206\u306a\u3057");
    } else {
      const row1Parties = activeParties.slice(0, 5);
      const row2Parties = activeParties.slice(5);

      summaryG.append("text")
        .attr("class", "pr-seat-label")
        .text(row1Parties.map(p => `${p.shortName} ${block.allocated[p.id]}`).join("\u3000"));

      if (row2Parties.length > 0) {
        summaryG.append("text")
          .attr("class", "pr-seat-label")
          .attr("y", 14)
          .text(row2Parties.map(p => `${p.shortName} ${block.allocated[p.id]}`).join("\u3000"));
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

// --- \u51e1\u4f8b\uff08\u8981\u4ef66: \u6bd4\u4f8b\u533a\u306a\u3057\u5bfe\u5fdc\uff09 ---
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
    .text("\u8b70\u5e2d\u7372\u5f97\u72b6\u6cc1" + (showShadingSteps ? "\u304a\u3088\u3073\u5f97\u7968\u7387\u968e\u8abf" : ""));

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
      .text("\u5f97\u7968\u7387\u968e\u8abf:");

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

  // \u515a\u6d3e\u5225\u8b70\u5e2d\u30c6\u30fc\u30d6\u30eb
  const tableTop = 14 + shadingH + 6;
  const tableG = g.append("g").attr("transform", `translate(10, ${tableTop})`);
  const colW = legW - 20;

  if (hasPr) {
    const colParty = 0;
    const colDistrict = Math.floor(colW * 0.5);
    const colPr = Math.floor(colW * 0.74);
    const colTotal = colW;

    tableG.append("text").attr("class", "shading-legend-label").attr("x", colParty).attr("y", 6).text("\u653f\u515a");
    tableG.append("text").attr("class", "shading-legend-label").attr("x", colDistrict).attr("y", 6).attr("text-anchor", "end").text("\u9078\u6319\u533a");
    tableG.append("text").attr("class", "shading-legend-label").attr("x", colPr).attr("y", 6).attr("text-anchor", "end").text("\u6bd4\u4f8b");
    tableG.append("text").attr("class", "shading-legend-label").attr("x", colTotal).attr("y", 6).attr("text-anchor", "end").text("\u5408\u8a08");

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
    // \u6bd4\u4f8b\u533a\u306a\u3057\uff1a\u653f\u515a\u3068\u7372\u5f97\u8b70\u5e2d\u306e\u307f
    const colParty = 0;
    const colSeats = colW;

    tableG.append("text").attr("class", "shading-legend-label").attr("x", colParty).attr("y", 6).text("\u653f\u515a");
    tableG.append("text").attr("class", "shading-legend-label").attr("x", colSeats).attr("y", 6).attr("text-anchor", "end").text("\u7372\u5f97\u8b70\u5e2d");

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

// --- \u8b70\u5e2d\u96c6\u8a08 ---
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
        <span>${tot}\u8b70\u5e2d</span>
      `;
      summaryEl.appendChild(chip);
    }
  });

  if ($("#barTitle")) $("#barTitle").textContent = $("#electionTitle") ? $("#electionTitle").value : "";
  if ($("#barSubtitle")) $("#barSubtitle").textContent = $("#electionSubtitle") ? $("#electionSubtitle").value : "";
  if ($("#documentTitle")) $("#documentTitle").textContent = $("#electionTitle") ? $("#electionTitle").value : "";
}

// --- \u9078\u6319\u533a\u9078\u629e\u3068\u30af\u30a4\u30c3\u30af\u30a4\u30f3\u30b9\u30c1\u30a7\u30af\u30bf\u30fc ---
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
  setStatus(`${districts[did]?.name || did} \u3092\u9078\u629e\u3057\u307e\u3057\u305f`);
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
        <button class="rank-btn" data-insp-action="up" data-idx="${idx}" ${idx === 0 ? "disabled" : ""}>\u25b2</button>
        <button class="rank-btn" data-insp-action="down" data-idx="${idx}" ${idx === candList.length - 1 ? "disabled" : ""}>\u25bc</button>
      </div>
      <select data-insp-action="party" data-idx="${idx}">
        ${parties.map(p => `<option value="${p.id}" ${p.id === c.party ? "selected" : ""}>${escapeHtml(p.shortName)}</option>`).join("")}
      </select>
      <input type="text" data-insp-action="name" data-idx="${idx}" value="${escapeHtml(c.name)}" placeholder="\u6c0f\u540d">
      <input class="votes-input" type="number" min="0" data-insp-action="votes" data-idx="${idx}" value="${voteVal}" placeholder="${d.mode === 'rank' ? '\u9806\u4f4d\u512a\u5148' : '\u5f97\u7968\u6570'}">
      <button class="del-cand-btn" data-insp-action="del" data-idx="${idx}" title="\u524a\u9664">\u2715</button>
    `;
    listEl.appendChild(row);
  });

  const winBadges = (d.winners || []).map((pid, idx) => {
    const p = partyById(pid);
    return `<span class="seat-badge" style="background:${p.color}">${idx + 1}\u4f4d: ${escapeHtml(p.shortName)}</span>`;
  }).join(" ");
  $("#inspWinnersBadge").innerHTML = winBadges || "\u306a\u3057";

  let shareLabel = "";
  if (d.isUncontested) shareLabel = "\u7121\u6295\u7968\u5f53\u9078\uff08\u6700\u591a\u515a\u306e\u515a\u6d3e\u5272\u5408\u968e\u8abf\uff09";
  else if (d.mode === "rank") shareLabel = "\u9806\u4f4d\u6307\u5b9a\uff08\u6700\u591a\u515a\u306e\u515a\u6d3e\u5272\u5408\u968e\u8abf\uff09";
  else shareLabel = d.maxPartyShare !== null ? `\u6700\u591a\u5f97\u7968\u7387: ${d.maxPartyShare.toFixed(1)}%` : "\u672a\u8a08\u7b97";

  $("#inspShareText").textContent = shareLabel;

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

function renderAll() {
  renderPartyEditor();
  renderDistrictEditor();
  renderPrBlockEditor();
  renderValidation();
  renderStatsTab();
  renderMap();
}

function renderPartyEditor() {
  const container = $("#partyListContainer");
  if (!container) return;
  container.innerHTML = "";

  parties.forEach((p, idx) => {
    const card = document.createElement("div");
    card.className = "party-edit-card";
    card.innerHTML = `
      <input type="color" data-action="party-color" data-idx="${idx}" value="${p.color}">
      <input type="text" data-action="party-name" data-idx="${idx}" value="${escapeHtml(p.name)}" placeholder="\u653f\u515a\u540d">
      <input type="text" data-action="party-short" data-idx="${idx}" value="${escapeHtml(p.shortName)}" placeholder="\u7565\u79f0">
      <button class="party-del-btn" data-action="party-del" data-idx="${idx}" title="\u653f\u515a\u3092\u524a\u9664">\u2715</button>
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
        parties[idx].name = e.target.value.trim() || `\u653f\u515a${idx + 1}`;
        renderMap();
        updateBatchPartyOptions();
        renderStatsTab();
        markDirty();
      });
    } else if (act === "party-short") {
      el.addEventListener("change", e => {
        pushHistory();
        parties[idx].shortName = e.target.value.trim() || `\u515a${idx + 1}`;
        renderMap();
        updateBatchPartyOptions();
        updateDistrictInspector();
        renderStatsTab();
        markDirty();
      });
    } else if (act === "party-del") {
      el.addEventListener("click", () => {
        if (parties.length <= 1) {
          notify("\u5c11\u306a\u304f\u3068\u30821\u3064\u306e\u653f\u515a\u304c\u5fc5\u8981\u3067\u3059");
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
      return `<span class="seat-badge" style="background:${p.color}">${idx + 1}\u4f4d:${escapeHtml(p.shortName)}</span>`;
    }).join(" ");

    const head = document.createElement("div");
    head.className = "district-card-head";
    head.innerHTML = `
      <div class="district-head-left" data-action="toggle-accordion" data-id="${id}">
        <span class="accordion-toggle-icon">\u25bc</span>
        <span class="district-card-title">${escapeHtml(d.name)} <small>(${escapeHtml(id)})</small></span>
        <span class="collapsed-badge">${d.isUncontested ? '<span style="color:#b45309;font-weight:700;">[\u7121\u6295\u7968]</span>' : ''} ${miniWinnerBadges || "\u672a\u5b9a"}</span>
      </div>
      <div class="district-card-seats">
        <div class="pill-toggle-group" style="scale:0.85;">
          <button class="pill-btn ${d.mode !== 'rank' ? 'active' : ''}" data-action="mode-votes" data-id="${id}" title="\u5f97\u7968\u6570\u9806\u3067\u81ea\u52d5\u5224\u5b9a">\u5f97\u7968</button>
          <button class="pill-btn ${d.mode === 'rank' ? 'active' : ''}" data-action="mode-rank" data-id="${id}" title="\u624b\u52d5\u3067\u9806\u4f4d\u6307\u5b9a">\u9806\u4f4d</button>
        </div>
        <span>\u5b9a\u6570:</span>
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
          <button class="rank-btn" data-action="cand-up" data-id="${id}" data-idx="${cIdx}" ${cIdx === 0 ? "disabled" : ""}>\u25b2</button>
          <button class="rank-btn" data-action="cand-down" data-id="${id}" data-idx="${cIdx}" ${cIdx === candList.length - 1 ? "disabled" : ""}>\u25bc</button>
        </div>
        <select data-action="cand-party" data-id="${id}" data-idx="${cIdx}">
          ${parties.map(p => `<option value="${p.id}" ${p.id === c.party ? "selected" : ""}>${escapeHtml(p.shortName)}</option>`).join("")}
        </select>
        <input type="text" data-action="cand-name" data-id="${id}" data-idx="${cIdx}" value="${escapeHtml(c.name)}" placeholder="\u5019\u88dc\u8005\u540d">
        <input class="votes-input" type="number" min="0" data-action="cand-votes" data-id="${id}" data-idx="${cIdx}" value="${voteVal}" placeholder="${d.mode === 'rank' ? '\u9806\u4f4d\u512a\u5148' : '\u5f97\u7968\u6570'}">
        <button class="del-cand-btn" data-action="cand-del" data-id="${id}" data-idx="${cIdx}" title="\u524a\u9664">\u2715</button>
      `;
      card.appendChild(row);
    });

    const addCandBtn = document.createElement("button");
    addCandBtn.className = "small-btn district-add-cand-btn";
    addCandBtn.textContent = "\uff0b \u5019\u88dc\u8005\u3092\u8ffd\u52a0";
    addCandBtn.dataset.action = "cand-add";
    addCandBtn.dataset.id = id;
    card.appendChild(addCandBtn);

    const summaryLine = document.createElement("div");
    summaryLine.className = "district-summary-line";
    const winnerBadges = (d.winners || []).map((pid, idx) => {
      const p = partyById(pid);
      return `<span class="seat-badge" style="background:${p.color}">${idx + 1}\u4f4d: ${escapeHtml(p.shortName)}</span>`;
    }).join(" ");

    let shareInfo = "";
    if (d.isUncontested) shareInfo = `<span style="color:#b45309;font-weight:700;">\u7121\u6295\u7968\u5f53\u9078\uff08\u6700\u591a\u515a\u5272\u5408\u968e\u8abf\uff09</span>`;
    else if (d.mode === "rank") shareInfo = `<span style="color:#1a56db;">\u9806\u4f4d\u6307\u5b9a\uff08\u6700\u591a\u515a\u5272\u5408\u968e\u8abf\uff09</span>`;
    else shareInfo = d.maxPartyShare !== null ? `\u6700\u591a\u5f97\u7968\u7387: ${d.maxPartyShare.toFixed(1)}%` : "\u672a\u96c6\u8a08";

    summaryLine.innerHTML = `
      <div class="district-winners-badge">${winnerBadges || "\u5f53\u9078\u8005\u306a\u3057"}</div>
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
          name: "\u65b0\u5019\u88dc\u8005",
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

// --- \u6bd4\u4f8b\u533a\u30a8\u30c7\u30a3\u30bf ---
function renderPrBlockEditor() {
  const container = $("#prBlockListContainer");
  if (!container) return;
  container.innerHTML = "";

  if (prBlocks.length === 0) {
    container.innerHTML = `
      <div class="info-box">
        \u73fe\u5728\u3001\u6bd4\u4f8b\u4ee3\u8868\u533a\u306f\u8a2d\u5b9a\u3055\u308c\u3066\u3044\u307e\u305b\u3093\uff08\u5c0f\u9078\u6319\u533a\u5236\u306a\u3069\uff09\u3002<br>
        \u4e0a\u306e\u300c\uff0b \u65b0\u3057\u3044\u6bd4\u4f8b\u533a\u3092\u8ffd\u52a0\u300d\u30dc\u30bf\u30f3\u304b\u3089\u6bd4\u4f8b\u533a\u30d6\u30ed\u30c3\u30af\u3092\u4f5c\u6210\u3067\u304d\u307e\u3059\u3002
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
        <button class="pr-block-del-btn" data-pr-action="del" data-idx="${bIdx}">\u524a\u9664</button>
      </div>

      <div class="field-grid-2">
        <label class="field">
          <span>\u500b\u5225\u5b9a\u6570</span>
          <input type="number" min="1" max="200" data-pr-action="seats" data-idx="${bIdx}" value="${block.seats}">
        </label>
        <label class="field">
          <span>\u914d\u5206\u65b9\u5f0f</span>
          <select data-pr-action="allocation" data-idx="${bIdx}">
            <option value="dhondt" ${block.allocationMethod === "dhondt" ? "selected" : ""}>\u30c9\u30f3\u30c8\u5f0f</option>
            <option value="sainte-lague" ${block.allocationMethod === "sainte-lague" ? "selected" : ""}>\u30b5\u30f3\uff1d\u30e9\u30b0\u5f0f</option>
            <option value="largest-remainder-hare" ${block.allocationMethod === "largest-remainder-hare" ? "selected" : ""}>\u6700\u5927\u5270\u4f59\u5f0f(Hare)</option>
            <option value="largest-remainder-droop" ${block.allocationMethod === "largest-remainder-droop" ? "selected" : ""}>\u6700\u5927\u5270\u4f59\u5f0f(Droop)</option>
          </select>
        </label>
      </div>

      <div class="pill-toggle-group" style="margin-bottom:6px;">
        <button class="pill-btn ${block.mode !== 'shares' ? 'active' : ''}" data-pr-action="mode-votes" data-idx="${bIdx}">\u5f97\u7968\u6570\u5165\u529b</button>
        <button class="pill-btn ${block.mode === 'shares' ? 'active' : ''}" data-pr-action="mode-shares" data-idx="${bIdx}">\u5f97\u7968\u7387(%)\u5165\u529b</button>
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
              <span class="pr-seat-chip">${seatCount} \u8b70\u5e2d</span>
            </div>
          `;
        }).join("")}
      </div>
    `;

    container.appendChild(card);
  });

  container.querySelectorAll("[data-pr-action]").forEach(el => {
    const act = el.dataset.prAction;
    const idx = Number(el.dataset.idx);

    if (act === "name") {
      el.addEventListener("change", e => {
        pushHistory();
        prBlocks[idx].name = e.target.value.trim() || `\u6bd4\u4f8b\u533a${idx + 1}`;
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

// --- \u691c\u8a3c\u30bf\u30d6 ---
function renderValidation() {
  const container = $("#validationContainer");
  if (!container) return;
  const items = [];

  const fList = geoData?.features || [];
  const ids = fList.map(f => idOf(f));
  const dups = ids.filter((id, i) => ids.indexOf(id) !== i);

  if (!ids.length) {
    items.push(["error", "GeoJSON\u5730\u56f3\u30c7\u30fc\u30bf\u304c\u8aad\u307f\u8fbc\u307e\u308c\u3066\u3044\u307e\u305b\u3093\u3002"]);
  } else {
    if (ids.some(x => !x)) {
      items.push(["error", "\u9078\u6319\u533aID\u304c\u7a7a\u306e\u8981\u7d20\u304c\u5b58\u5728\u3057\u307e\u3059\u3002ID\u30d5\u30a3\u30fc\u30eb\u30c9\u8a2d\u5b9a\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\u3002"]);
    }
    if (dups.length) {
      items.push(["error", `\u91cd\u8907\u3059\u308b\u9078\u6319\u533aID\u304c\u3042\u308a\u307e\u3059: ${[...new Set(dups)].join(", ")}`]);
    }
    if (!dups.length && !ids.some(x => !x)) {
      items.push(["ok", `\u9078\u6319\u533a\u30c7\u30fc\u30bf: ${ids.length}\u4ef6\u3001\u91cd\u8907\u306a\u3057\u3067\u6b63\u5e38\u3067\u3059\u3002`]);
    }
  }

  const uncontestedDistricts = Object.values(districts).filter(d => d.isUncontested);
  if (uncontestedDistricts.length > 0) {
    items.push(["warn", `\u7121\u6295\u7968\u5f53\u9078\u306e\u9078\u6319\u533a\u304c ${uncontestedDistricts.length} \u533a\u3042\u308a\u307e\u3059\uff08${uncontestedDistricts.map(d => d.name).join("\u3001")}\uff09\u3002\u5730\u56f3\u4e0a\u3067\u306f\u300c\u7121\u6295\u7968\u5f53\u9078\u300d\u3068\u8868\u793a\u3055\u308c\u307e\u3059\u3002`]);
  }

  if (prBlocks.length > 0) {
    prBlocks.forEach((b, i) => {
      const totalSeats = b.seats;
      const assigned = Object.values(b.allocated || {}).reduce((a, c) => a + c, 0);
      if (assigned !== totalSeats) {
        items.push(["warn", `\u6bd4\u4f8b\u533a\u300c${b.name || i + 1}\u300d: \u5b9a\u6570${totalSeats}\u306b\u5bfe\u3057\u3001\u914d\u5206\u7d50\u679c\u304c${assigned}\u8b70\u5e2d\u3067\u3059\uff08\u5f97\u7968\u6570\u307e\u305f\u306f\u5f97\u7968\u7387\u3092\u78ba\u8a8d\u3057\u3066\u304f\u3060\u3055\u3044\uff09\u3002`]);
      } else {
        items.push(["ok", `\u6bd4\u4f8b\u533a\u300c${b.name || i + 1}\u300d: \u5b9a\u6570${totalSeats}\u8b70\u5e2d\u306e\u914d\u5206\u304c\u5b8c\u5168\u306b\u6574\u5408\u3057\u3066\u3044\u307e\u3059\u3002`]);
      }
    });
  }

  container.innerHTML = items.map(([type, msg]) => `
    <div class="validation-item ${type}">${escapeHtml(msg)}</div>
  `).join("");
}

// --- \u7d71\u8a08\u8a08\u7b97 & \u7d71\u8a08\u30bf\u30d6\u8868\u793a\uff08\u8981\u4ef68\uff09 ---
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
        <div class="stats-card-label">\u7dcf\u5b9a\u6570 (\u9078\u6319\u533a: ${t.districtSeats} / \u6bd4\u4f8b: ${t.prSeats})</div>
      </div>
      <div class="stats-card">
        <div class="stats-card-num">${t.majorityThreshold}</div>
        <div class="stats-card-label">\u904e\u534a\u6570\u30e9\u30a4\u30f3\uff08\u8b70\u5e2d\u6570\uff09</div>
      </div>
      <div class="stats-card">
        <div class="stats-card-num">${t.districtVotes.toLocaleString()}</div>
        <div class="stats-card-label">\u5c0f\u9078\u6319\u533a \u6709\u52b9\u7dcf\u6295\u7968\u6570</div>
      </div>
      <div class="stats-card">
        <div class="stats-card-num">${t.uncontestedCount} / ${t.districtCount}</div>
        <div class="stats-card-label">\u7121\u6295\u7968\u533a\u6570 (${t.districtCount > 0 ? ((t.uncontestedCount / t.districtCount) * 100).toFixed(1) : 0}%)</div>
      </div>
    </div>

    <div class="stats-section-title">\u515a\u6d3e\u5225 \u9078\u6319\u7d71\u8a08\u4e00\u89a7</div>
    <div style="overflow-x:auto;">
      <table class="stats-table">
        <thead>
          <tr>
            <th>\u653f\u515a</th>
            <th>\u7372\u5f97\u8b70\u5e2d</th>
            <th>\u8b70\u5e2d\u7387</th>
            <th>\u5019\u88dc\u6570</th>
            <th>\u5c0f\u9078\u5f97\u7968\u6570</th>
            <th>\u5c0f\u9078\u5f97\u7968\u7387</th>
            ${prBlocks.length > 0 ? '<th>\u6bd4\u4f8b\u5f97\u7968\u6570</th><th>\u6bd4\u4f8b\u5f97\u7968\u7387</th>' : ''}
            <th>\u5f53\u9078\u7387</th>
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

  const headers = ["\u653f\u515a\u540d", "\u7565\u79f0", "\u7372\u5f97\u7dcf\u8b70\u5e2d", "\u9078\u6319\u533a\u8b70\u5e2d", "\u6bd4\u4f8b\u8b70\u5e2d", "\u8b70\u5e2d\u5360\u6709\u7387(%)", "\u64c1\u7acb\u5019\u88dc\u6570", "\u5c0f\u9078\u6319\u533a\u5f97\u7968\u6570", "\u5c0f\u9078\u6319\u533a\u5f97\u7968\u7387(%)"];
  if (hasPr) {
    headers.push("\u6bd4\u4f8b\u5f97\u7968\u6570", "\u6bd4\u4f8b\u5f97\u7968\u7387(%)", "\u7dcf\u5f97\u7968\u6570", "\u5168\u4f53\u5f97\u7968\u7387(%)");
  }
  headers.push("\u5f53\u9078\u7387(%)");

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
  notify("\u9078\u6319\u7d71\u8a08\u30c7\u30fc\u30bf\u3092CSV\u5f62\u5f0f\u3067\u66f8\u304d\u51fa\u3057\u307e\u3057\u305f");
}

// --- \u5185\u8535\u30c7\u30fc\u30bf\u9078\u629e\u30e2\u30fc\u30c0\u30eb\uff08\u8981\u4ef67\uff09 ---
function openDataSelectModal() {
  const modal = $("#dataSelectModal");
  const body = $("#dataSelectModalBody");
  if (!modal || !body) return;

  const maps = dataIndex.maps || [];
  if (maps.length === 0) {
    body.innerHTML = `
      <div class="info-box">\u5229\u7528\u53ef\u80fd\u306a\u5185\u8535\u5730\u56f3\u30c7\u30fc\u30bf\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3067\u3057\u305f\u3002</div>
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
              <button class="btn-primary small-btn" data-load-map-idx="${idx}">\u8aad\u8fbc</button>
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
          setStatus(`${targetMap.name} \u3092\u8aad\u307f\u8fbc\u307f\u4e2d...`);
          const res = await fetch(targetMap.file);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const geojson = await res.json();

          pushHistory();
          geoData = geojson;
          districts = {};
          selectedDistrictId = null;
          collapsedDistrictIds = new Set(); // \u8981\u4ef62: \u30c7\u30d5\u30a9\u30eb\u30c8\u6298\u308a\u7573\u307f

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
                  name: `${p.shortName}\u5019\u88dc`, party: p.id, votes: null, rank: i + 1
                }));

            districts[id] = {
              id,
              name: f.properties?.name || id,
              seats: Number($("#batchSeatsInput")?.value) || 1,
              mode: "votes",
              candidates: candList
            };

            collapsedDistrictIds.add(id); // \u6298\u308a\u7573\u307f
          });

          if ($("#dataStatus")) $("#dataStatus").textContent = `${targetMap.name} \uff08${geojson.features.length} \u9078\u6319\u533a\uff09`;
          recalcAll();
          renderAll();
          updateDistrictInspector();
          modal.classList.remove("show");
          notify(`\u300c${targetMap.name}\u300d\u3092\u8aad\u307f\u8fbc\u307f\u307e\u3057\u305f`);
          markDirty();
        } catch (err) {
          notify(`\u5730\u56f3\u8aad\u8fbc\u30a8\u30e9\u30fc: ${err.message}`);
        }
      });
    });
  }

  modal.classList.add("show");
}

// --- \u30a4\u30d9\u30f3\u30c8\u30d0\u30a4\u30f3\u30c9 ---
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
      notify("\u5168\u9078\u6319\u533a\u3092\u300c\u5f97\u7968\u6570\u5165\u529b\uff08\u81ea\u52d5\uff09\u300d\u30e2\u30fc\u30c9\u306b\u5207\u308a\u66ff\u3048\u307e\u3057\u305f");
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
      notify("\u5168\u9078\u6319\u533a\u3092\u300c\u9806\u4f4d\u76f4\u63a5\u6307\u5b9a\uff08\u624b\u52d5\uff09\u300d\u30e2\u30fc\u30c9\u306b\u5207\u308a\u66ff\u3048\u307e\u3057\u305f");
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
        name: `\u7b2c${newIdx}\u6bd4\u4f8b\u30d6\u30ed\u30c3\u30af`,
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
      notify("\u6bd4\u4f8b\u4ee3\u8868\u533a\u3092\u8ffd\u52a0\u3057\u307e\u3057\u305f");
    });
  }

  if ($("#clearPrBlocksBtn")) {
    $("#clearPrBlocksBtn").addEventListener("click", () => {
      if (!confirm("\u3059\u3079\u3066\u306e\u6bd4\u4f8b\u4ee3\u8868\u533a\u3092\u6d88\u53bb\u3057\u307e\u3059\u304b\uff1f")) return;
      pushHistory();
      prBlocks = [];
      renderPrBlockEditor();
      renderMap();
      renderStatsTab();
      markDirty();
      notify("\u6bd4\u4f8b\u533a\u3092\u5168\u6d88\u53bb\u3057\u307e\u3057\u305f");
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
        name: `\u65b0\u653f\u515a${parties.length + 1}`,
        shortName: `\u65b0\u515a${parties.length + 1}`,
        color: col
      });
      recalcAll();
      renderAll();
      updateBatchPartyOptions();
      markDirty();
      notify("\u653f\u515a\u3092\u8ffd\u52a0\u3057\u307e\u3057\u305f");
    });
  }

  if ($("#resetPartiesBtn")) {
    $("#resetPartiesBtn").addEventListener("click", async () => {
      if (!confirm("\u653f\u515a\u4e00\u89a7\u3092\u6a19\u6e96\u8a2d\u5b9a\u306b\u30ea\u30handle\u30c3\u30c8\u3057\u307e\u3059\u304b\uff1f")) return;
      pushHistory();
      const partiesData = await fetch("data/parties.json").then(r => r.json());
      parties = partiesData.parties;
      recalcAll();
      renderAll();
      updateBatchPartyOptions();
      markDirty();
      notify("\u653f\u515a\u3092\u30ea\u30bb\u30c3\u30c8\u3057\u307e\u3057\u305f");
    });
  }

  if ($("#districtFilterInput")) {
    $("#districtFilterInput").addEventListener("input", renderDistrictEditor);
  }

  if ($("#exportStatsCsvBtn")) $("#exportStatsCsvBtn").addEventListener("click", exportStatsCsv);
  if ($("#refreshStatsBtn")) $("#refreshStatsBtn").addEventListener("click", () => {
    recalcAll();
    renderStatsTab();
    notify("\u7d71\u8a08\u30c7\u30fc\u30bf\u3092\u66f4\u65b0\u3057\u307e\u3057\u305f");
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
        name: "\u65b0\u5019\u88dc\u8005",
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
      if (!confirm("\u65b0\u898f\u30d7\u30ed\u30b8\u30a7\u30af\u30c8\u3092\u4f5c\u6210\u3057\u307e\u3059\u304b\uff1f\u672a\u4fdd\u5b58\u306e\u5909\u66f4\u306f\u5931\u308f\u308c\u307e\u3059\u3002")) return;
      pushHistory();
      if ($("#electionTitle")) $("#electionTitle").value = "\u65b0\u898f\u9078\u6319\u7d50\u679c\u5730\u56f3";
      if ($("#electionSubtitle")) $("#electionSubtitle").value = "\u5404\u7a2e\u9078\u6319\u5236\u5ea6\u30fb\u524d\u63d0\u306b\u57fa\u3065\u304f\u96c6\u8a08";
      loadSampleData(false);
      notify("\u65b0\u898f\u30d7\u30ed\u30b8\u30a7\u30af\u30c8\u3092\u958b\u304d\u307e\u3057\u305f");
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
      setStatus("\u5168\u4f53\u8868\u793a\u306b\u30ea\u30bb\u30c3\u30c8");
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
    notify("\u5730\u56f3\u30c7\u30fc\u30bf\u304c\u3042\u308a\u307e\u305b\u3093");
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
  notify("\u30b5\u30f3\u30d7\u30ebGeoJSON\u3092\u30c0\u30a6\u30f3\u30ed\u30fc\u30c9\u3057\u307e\u3057\u305f");
}

function loadGeoJsonFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      if (d.type !== "FeatureCollection" || !Array.isArray(d.features)) {
        throw new Error("\u6709\u52b9\u306aGeoJSON (FeatureCollection) \u3067\u306f\u3042\u308a\u307e\u305b\u3093");
      }
      pushHistory();
      geoData = d;
      districts = {};
      selectedDistrictId = null;
      collapsedDistrictIds = new Set();

      d.features.forEach(f => {
        const id = idOf(f);
        districts[id] = {
          id,
          name: f.properties?.name || id,
          seats: Number($("#batchSeatsInput")?.value) || 1,
          mode: "votes",
          candidates: parties.slice(0, 3).map((p, idx) => ({
            id: `cand-${Math.random().toString(36).slice(2, 8)}`,
            name: `${p.shortName}\u5019\u88dc`,
            party: p.id,
            votes: null,
            rank: idx + 1
          }))
        };
        collapsedDistrictIds.add(id);
      });

      if ($("#dataStatus")) $("#dataStatus").textContent = `${file.name} \uff08${d.features.length} \u9078\u6319\u533a\uff09`;
      recalcAll();
      renderAll();
      updateDistrictInspector();
      notify(`\u5730\u56f3\u3092\u8aad\u307f\u8fbc\u307f\u307e\u3057\u305f (${d.features.length}\u9078\u6319\u533a)`);
      markDirty();
    } catch (err) {
      notify(`\u5730\u56f3\u8aad\u8fbc\u30a8\u30e9\u30fc: ${err.message}`);
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
  notify("\u30d7\u30ed\u30b8\u30a7\u30af\u30c8\u3092\u4fdd\u5b58\u3057\u307e\u3057\u305f");
}

function loadProjectFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const s = JSON.parse(reader.result);
      if (!s.geoData || !s.districts) throw new Error("\u6709\u52b9\u306a\u30d7\u30ed\u30b8\u30a7\u30af\u30c8\u5f62\u5f0f\u3067\u306f\u3042\u308a\u307e\u305b\u3093");
      pushHistory();
      restore(s);
      markClean();
      notify("\u30d7\u30ed\u30b8\u30a7\u30af\u30c8\u3092\u8aad\u307f\u8fbc\u307f\u307e\u3057\u305f");
    } catch (err) {
      notify(`\u30d7\u30ed\u30b8\u30a7\u30af\u30c8\u8aad\u8fbc\u5931\u6557: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

function exportSystemDefinition() {
  const systemData = {
    type: "election-system-definition",
    version: 1,
    name: PRESETS[currentPreset]?.name || "\u30ab\u30b9\u30bf\u30e0\u9078\u6319\u5236\u5ea6",
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
  notify("\u9078\u6319\u5236\u5ea6\u5b9a\u7fa9\u3092\u4fdd\u5b58\u3057\u307e\u3057\u305f");
}

function importSystemDefinition(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const s = JSON.parse(reader.result);
      if (s.type !== "election-system-definition") {
        throw new Error("\u6709\u52b9\u306a\u9078\u6319\u5236\u5ea6\u5b9a\u7fa9\u30c4\u30a1\u30a4\u30eb\u3067\u306f\u3042\u308a\u307e\u305b\u3093");
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
      notify(`\u5236\u5ea6\u5b9a\u7fa9\u300c${s.name || "\u30ab\u30b9\u30bf\u30e0\u5236\u5ea6"}\u300d\u3092\u9069\u7528\u3057\u307e\u3057\u305f`);
      markDirty();
    } catch (err) {
      notify(`\u5236\u5ea6\u8aad\u8fbc\u30a8\u30e9\u30fc: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

// --- SVG \u30a8\u30af\u30b9\u30dd\u30fc\u30c8 ---
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
  notify("SVG\u5730\u56f3\u3092\u66f8\u304d\u51fa\u3057\u307e\u3057\u305f");
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
      notify("\u9ad8\u89e3\u50cf\u5ea6PNG\u3092\u66f8\u304d\u51fa\u3057\u307e\u3057\u305f");
    }, "image/png");
  };
  img.src = url;
}

// \u5b9f\u884c\u958b\u59cb
init().catch(err => {
  console.error(err);
  notify(`\u521d\u671f\u5316\u30a8\u30e9\u30fc: ${err.message}`);
});
