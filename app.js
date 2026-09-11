/**
 * Election Map Studio — Wikipedia Style Result Generator
 * v5 Professional (Comprehensive Overhaul & Quality Polish)
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

// --- アプリケーション状態 ---
let parties = [];
let geoData = null;
let districts = {}; // { [districtId]: DistrictResult }
let prBlocks = [];  // Array of PRBlock
let selectedDistrictId = null;
let collapsedDistrictIds = new Set(); // 折り畳み状態の選挙区ID群

let currentPreset = "parallel-shugiin";
let projection = null;
let pathGenerator = null;
let isDirty = false;
let historyStack = [];
let futureStack = [];
let isHistoryLocked = false;

// サンプルデータ（岡山県5区）
const SAMPLE_DISTRICT_VOTES = {
  "OK-1": {
    name: "岡山1区",
    candidates: [
      { name: "逢沢 一郎", party: "ldp", votes: 85210 },
      { name: "原田 謙介", party: "cdp", votes: 64130 },
      { name: "余慶 充伸", party: "jcp", votes: 12050 }
    ]
  },
  "OK-2": {
    name: "岡山2区",
    candidates: [
      { name: "山下 貴司", party: "ldp", votes: 78540 },
      { name: "津村 啓介", party: "cdp", votes: 71220 },
      { name: "住寄 聡美", party: "ishin", votes: 18450 }
    ]
  },
  "OK-3": {
    name: "岡山3区",
    candidates: [
      { name: "加藤 勝信", party: "ldp", votes: 91400 },
      { name: "原田 健吾", party: "cdp", votes: 38200 },
      { name: "尾崎 宏子", party: "jcp", votes: 8900 }
    ]
  },
  "OK-4": {
    name: "岡山4区",
    candidates: [
      { name: "柚木 道義", party: "cdp", votes: 83500 },
      { name: "橋本 岳", party: "ldp", votes: 79200 }
    ]
  },
  "OK-5": {
    name: "岡山5区",
    candidates: [
      { name: "加藤 浩平", party: "ldp", votes: 71000 },
      { name: "はた ともこ", party: "cdp", votes: 48500 },
      { name: "小西 彦治", party: "ind", votes: 15300 }
    ]
  }
};

const SAMPLE_PR_BLOCKS = [
  {
    id: "pr-chugoku",
    name: "中国比例ブロック",
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
    name: "小選挙区比例代表並立制（衆議院モデル）",
    defaultSeats: 1,
    allocation: "dhondt",
    hint: "小選挙区（一律1人区・最多得票当選）と、地図外の比例代表ブロック（ドント式配分）を組み合わせた制度です。選挙区ごとに定数を個別に変更することも可能です。",
    defaultPrBlocks: () => JSON.parse(JSON.stringify(SAMPLE_PR_BLOCKS))
  },
  "smd-simple": {
    name: "単純小選挙区制（一律1人区・比例なし）",
    defaultSeats: 1,
    allocation: "dhondt",
    hint: "各選挙区1議席の単純小選挙区制（FPTP）。最多得票者が当選となり、比例代表区は設定されません。",
    defaultPrBlocks: () => []
  },
  "mmd-sntv": {
    name: "大選挙区・中選挙区制（単記非移譲式・比例なし）",
    defaultSeats: 3,
    allocation: "dhondt",
    hint: "複数人区（各区3〜5人区など、個別設定可能）の単記非移譲式。得票上位から定数分が当選。領域色は党派合算得票率で表現します。",
    defaultPrBlocks: () => []
  },
  "parallel-custom": {
    name: "大選挙区比例代表並立制（複数人区＋比例）",
    defaultSeats: 3,
    allocation: "dhondt",
    hint: "地域選挙区が複数人区（中選挙区）で、さらに比例代表区が並立するハイブリッド制度です。",
    defaultPrBlocks: () => JSON.parse(JSON.stringify(SAMPLE_PR_BLOCKS))
  },
  "custom": {
    name: "カスタム選挙制度",
    defaultSeats: 1,
    allocation: "dhondt",
    hint: "選挙区ごとの定数や比例区の有無・定数・方式を完全に自由設定できるカスタムモードです。",
    defaultPrBlocks: () => []
  }
};

// --- ユーティリティ ---
function notify(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => t.classList.remove("show"), 2200);
}

function setStatus(msg) {
  $("#statusText").textContent = msg;
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
  return parties.find(p => p.id === pid) || { id: pid, name: pid || "不明", shortName: pid || "不明", color: "#64748b" };
}

function idOf(f) {
  const field = $("#idField").value;
  if (field === "id") return String(f.id ?? "");
  if (field === "name") return String(f.properties?.name ?? "");
  if (field === "code") return String(f.properties?.code ?? "");
  return String(f.id ?? f.properties?.id ?? f.properties?.code ?? f.properties?.name ?? "");
}

// --- 比例配分アルゴリズム (Allocation Engine) ---
function calculatePrAllocation(seats, method, votesMap) {
  const partyList = parties.filter(p => (Number(votesMap[p.id]) || 0) > 0);
  const allocated = {};
  parties.forEach(p => allocated[p.id] = 0);
  const order = [];

  if (seats <= 0 || partyList.length === 0) {
    return { allocated, order };
  }

  // 1. 除数方式（ドント式 / サン＝ラグ式）
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

  // 2. 最大剰余式 (Largest Remainder: Hare / Droop)
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

// --- 選挙区集計 (District Calculation Engine) ---
function recalcDistrict(id) {
  const d = districts[id];
  if (!d) return;

  const seats = Math.max(1, Number(d.seats) || 1);
  d.seats = seats;

  const candList = (d.candidates || []).map((c, idx) => ({
    id: c.id || `cand-${Math.random().toString(36).slice(2, 7)}`,
    name: c.name || "候補者",
    party: c.party || parties[0]?.id || "ldp",
    votes: (c.votes !== null && c.votes !== undefined && c.votes !== "") ? Number(c.votes) : null,
    rank: Number(c.rank) || (idx + 1)
  }));

  const hasAnyVotes = candList.some(c => c.votes !== null && !isNaN(c.votes) && c.votes >= 0);

  if (hasAnyVotes) {
    // 得票数によって自動的に順位付け
    candList.sort((a, b) => {
      const vA = a.votes !== null ? a.votes : -1;
      const vB = b.votes !== null ? b.votes : -1;
      return vB - vA || a.rank - b.rank || a.name.localeCompare(b.name, "ja");
    });
    candList.forEach((c, idx) => { c.rank = idx + 1; });

    d.hasVotes = true;
    d.candidates = candList;
    d.winners = candList.slice(0, seats).map(c => c.party);

    // 党派別合算集計（複数人区対応）
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
    d.maxPartyShare = total > 0 ? (maxV / total) * 100 : 0;
  } else {
    // 得票数未設定：手動順位（rank）をそのまま尊重
    candList.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, "ja"));
    candList.forEach((c, idx) => { c.rank = idx + 1; });

    d.hasVotes = false;
    d.candidates = candList;
    d.winners = candList.slice(0, seats).map(c => c.party);
    d.maxParty = d.winners[0] || null;
    d.maxPartyShare = null;
    d.totalVotes = 0;
    d.partyVotes = {};
  }
}

// --- 比例区集計 (PR Block Calculation) ---
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

// --- シェーディング関数 (Wikipediaスタイル配色・透明化防止) ---
function getDistrictFillColor(district) {
  if (!district || !district.maxParty) {
    return "#cbd5e1";
  }

  const p = partyById(district.maxParty);
  const baseHex = (d3.color(p.color) || d3.color("#64748b")).formatHex();
  const method = $("#shadingMethod").value;

  if (!district.hasVotes || district.maxPartyShare === null || method === "solid") {
    return baseHex;
  }

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

// --- 履歴管理 (Undo / Redo) ---
function pushHistory() {
  if (isHistoryLocked) return;
  const snap = snapshot();
  historyStack.push(JSON.stringify(snap));
  if (historyStack.length > 50) historyStack.shift();
  futureStack = [];
  markDirty();
}

function undo() {
  if (!historyStack.length) return;
  futureStack.push(JSON.stringify(snapshot()));
  const prev = JSON.parse(historyStack.pop());
  isHistoryLocked = true;
  restore(prev);
  isHistoryLocked = false;
  notify("直前の操作を取り消しました");
}

function redo() {
  if (!futureStack.length) return;
  historyStack.push(JSON.stringify(snapshot()));
  const next = JSON.parse(futureStack.pop());
  isHistoryLocked = true;
  restore(next);
  isHistoryLocked = false;
  notify("操作をやり直しました");
}

function snapshot() {
  return {
    version: 5,
    title: $("#electionTitle").value,
    subtitle: $("#electionSubtitle").value,
    preset: currentPreset,
    shadingMethod: $("#shadingMethod").value,
    showBalls: $("#showBalls").checked,
    ballStyle: $("#ballStyle").value,
    prLayoutPosition: $("#prLayoutPosition").value,
    showDistrictNames: $("#showDistrictNames").checked,
    showWinnerNames: $("#showWinnerNames").checked,
    showShareText: $("#showShareText").checked,
    showLegend: $("#showLegend").checked,
    idField: $("#idField").value,
    parties: JSON.parse(JSON.stringify(parties)),
    districts: JSON.parse(JSON.stringify(districts)),
    prBlocks: JSON.parse(JSON.stringify(prBlocks)),
    geoData,
    selectedDistrictId
  };
}

function restore(s) {
  if (!s) return;
  $("#electionTitle").value = s.title || "選挙結果地図";
  $("#electionSubtitle").value = s.subtitle || "";
  currentPreset = s.preset || "custom";
  $("#presetSelect").value = currentPreset;
  $("#shadingMethod").value = s.shadingMethod || "winner-share-steps";
  $("#showBalls").checked = s.showBalls !== false;
  $("#ballStyle").value = s.ballStyle || "number";
  $("#prLayoutPosition").value = s.prLayoutPosition || "right";
  $("#showDistrictNames").checked = s.showDistrictNames !== false;
  $("#showWinnerNames").checked = s.showWinnerNames !== false;
  $("#showShareText").checked = s.showShareText !== false;
  $("#showLegend").checked = s.showLegend !== false;
  $("#idField").value = s.idField || "auto";

  parties = s.parties || [];
  districts = s.districts || {};
  prBlocks = s.prBlocks || [];
  geoData = s.geoData || null;
  selectedDistrictId = s.selectedDistrictId || null;

  updatePresetHint();
  recalcAll();
  renderAll();
  updateDistrictInspector();
  setStatus("状態を復元しました");
}

function markDirty() {
  isDirty = true;
  $("#saveState").textContent = "未保存の変更あり";
  $("#saveState").style.color = "#b45309";
}

function markClean() {
  isDirty = false;
  $("#saveState").textContent = "保存済み";
  $("#saveState").style.color = "#15803d";
}

// --- 初期化 ---
async function init() {
  const partiesData = await fetch("data/parties.json").then(r => r.json()).catch(() => ({
    parties: [
      { id: "ldp", name: "自由民主党", shortName: "自民", color: "#dc2626" },
      { id: "cdp", name: "立憲民主党", shortName: "立憲", color: "#2563eb" },
      { id: "ishin", name: "日本維新の会", shortName: "維新", color: "#16a34a" },
      { id: "komei", name: "公明党", shortName: "公明", color: "#ea580c" },
      { id: "dpp", name: "国民民主党", shortName: "国民", color: "#ca8a04" },
      { id: "jcp", name: "日本共産党", shortName: "共産", color: "#991b1b" },
      { id: "ind", name: "無所属", shortName: "無所属", color: "#64748b" }
    ]
  }));
  parties = partiesData.parties;

  await loadSampleData(false);
  bindEvents();
  updatePresetHint();
  updateBatchPartyOptions();
  recalcAll();
  renderAll();
  markClean();
  setStatus("システム初期化完了");
}

async function loadSampleData(makeHistory = true) {
  const d = await fetch("data/okayama-sample.geojson").then(r => r.json());
  geoData = d;
  districts = {};
  selectedDistrictId = null;

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
          name: `${p.shortName}候補`,
          party: p.id,
          votes: 50000 - idx * 12000,
          rank: idx + 1
        }));

    districts[id] = {
      id,
      name: sample.name || f.properties?.name || id,
      seats: 1,
      candidates: candList
    };
  });

  prBlocks = JSON.parse(JSON.stringify(SAMPLE_PR_BLOCKS));

  if (makeHistory) pushHistory();
  recalcAll();
  renderAll();
  $("#dataStatus").textContent = "岡山県サンプル（5選挙区＋比例中国ブロック）";
}

// --- プリセット適用 ---
function applyPreset(presetId) {
  const p = PRESETS[presetId];
  if (!p) return;
  currentPreset = presetId;
  pushHistory();

  $("#batchSeatsInput").value = p.defaultSeats;

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
  notify(`制度プリセット「${p.name}」を適用しました`);
}

function updatePresetHint() {
  const p = PRESETS[currentPreset] || PRESETS.custom;
  $("#presetHint").textContent = p.hint;
}

// --- 一括追加補助ツール ---
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
        name: `${p.shortName}候補`,
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
  notify(`全選挙区に「${p.shortName}」の候補者を一括追加しました (${addCount}名追加)`);
}

function batchRemovePartyCandidates(partyId) {
  if (!confirm(`全選挙区から「${partyById(partyId).shortName}」の候補者を削除しますか？`)) return;
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
  notify(`全選挙区から「${partyById(partyId).shortName}」の候補者を削除しました (${delCount}名削除)`);
}

function setupMajorPartiesCandidates() {
  if (!confirm("全選挙区に主要政党（自民・立憲・維新・共産など）の候補者を一括セットアップしますか？")) return;
  pushHistory();

  const majorParties = parties.slice(0, 4);
  Object.values(districts).forEach(d => {
    d.candidates = majorParties.map((p, idx) => ({
      id: `cand-${Math.random().toString(36).slice(2, 8)}`,
      name: `${p.shortName}候補`,
      party: p.id,
      votes: null,
      rank: idx + 1
    }));
  });

  recalcAll();
  renderDistrictEditor();
  renderMap();
  updateDistrictInspector();
  notify("全選挙区に主要政党の候補者を一括展開しました");
}

function clearAllCandidates() {
  if (!confirm("すべての選挙区の候補者をクリアしますか？")) return;
  pushHistory();

  Object.values(districts).forEach(d => {
    d.candidates = [];
  });

  recalcAll();
  renderDistrictEditor();
  renderMap();
  updateDistrictInspector();
  notify("全候補者をクリアしました");
}

function batchSetDistrictSeats(seats) {
  pushHistory();
  const val = Math.max(1, Number(seats) || 1);
  Object.values(districts).forEach(d => { d.seats = val; });
  recalcAll();
  renderDistrictEditor();
  renderMap();
  updateDistrictInspector();
  notify(`全選挙区の定数を一括で ${val} 議席に設定しました`);
}

// --- 地図レンダリング (SVG Wikipedia Style Renderer) ---
function renderMap() {
  if (!geoData) return;

  const prPosition = $("#prLayoutPosition").value;
  const showBalls = $("#showBalls").checked;
  const ballStyle = $("#ballStyle").value;
  const showNames = $("#showWinnerNames").checked;
  const showShare = $("#showShareText").checked;
  const showLegend = $("#showLegend").checked;

  let mapExtent;
  if (prPosition === "right" && prBlocks.length > 0) {
    mapExtent = [[40, 80], [1020, 840]];
  } else if (prPosition === "bottom" && prBlocks.length > 0) {
    mapExtent = [[40, 80], [1400, 620]];
  } else {
    mapExtent = [[40, 80], [1400, 840]];
  }

  projection = d3.geoIdentity().reflectY(true).fitExtent(mapExtent, geoData);
  pathGenerator = d3.geoPath(projection);

  // レイヤークリア
  polyLayer.selectAll("*").remove();
  ballLayer.selectAll("*").remove();
  textLayer.selectAll("*").remove();
  prPanelGroup.selectAll("*").remove();
  legendGroup.selectAll("*").remove();
  headerGroup.selectAll("*").remove();

  // 1. ヘッダー描画
  const title = $("#electionTitle").value || "選挙結果地図";
  const subtitle = $("#electionSubtitle").value || "";
  headerGroup.append("text").attr("class", "map-svg-title").attr("x", 40).attr("y", 46).text(title);
  if (subtitle) {
    headerGroup.append("text").attr("class", "map-svg-subtitle").attr("x", 40).attr("y", 68).text(subtitle);
  }

  // 2. 地図ポリゴン描画（不透明度100%を完全保証）
  const features = geoData.features;
  const districtList = features.map(f => {
    const id = idOf(f);
    const d = districts[id] || { seats: 1, winners: [], maxParty: null, maxPartyShare: null, hasVotes: false };
    const centroid = pathGenerator.centroid(f);
    return {
      feature: f,
      id,
      name: d.name || f.properties?.name || id,
      seats: d.seats,
      winners: d.winners || [],
      maxParty: d.maxParty,
      maxPartyShare: d.maxPartyShare,
      hasVotes: d.hasVotes,
      districtObj: d,
      cx: centroid[0] || 0,
      cy: centroid[1] || 0
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
      const pName = d.maxParty ? partyById(d.maxParty).name : "当選者なし";
      const shareStr = d.maxPartyShare !== null ? `(${d.maxPartyShare.toFixed(1)}%)` : "(手動順位)";
      return `${d.name} (定数 ${d.seats})\n最多得票・1位: ${pName} ${shareStr}`;
    });

  // 3. ラベル描画
  if ($("#showDistrictNames").checked) {
    textLayer.selectAll(".district-label-text")
      .data(districtList, d => d.id)
      .join("text")
      .attr("class", "district-label-text")
      .attr("x", d => d.cx)
      .attr("y", d => d.cy - (showBalls ? 14 : 4))
      .text(d => d.name);
  }

  if (showNames) {
    textLayer.selectAll(".district-winner-text")
      .data(districtList, d => d.id)
      .join("text")
      .attr("class", "district-winner-text")
      .attr("x", d => d.cx)
      .attr("y", d => d.cy + (showBalls ? 24 : 12))
      .text(d => {
        if (!d.winners.length) return "";
        return d.winners.slice(0, 3).map(pid => partyById(pid).shortName).join(" / ");
      });
  }

  if (showShare) {
    textLayer.selectAll(".district-share-text")
      .data(districtList, d => d.id)
      .join("text")
      .attr("class", "district-share-text")
      .attr("x", d => d.cx)
      .attr("y", d => d.cy + (showBalls ? 38 : 26))
      .text(d => d.maxPartyShare !== null ? `${d.maxPartyShare.toFixed(1)}%` : "");
  }

  // 4. 定数分の〇オブジェクト（議席ボール）
  if (showBalls) {
    const balls = [];
    districtList.forEach(d => {
      const n = Math.max(1, d.seats);
      const gap = n >= 6 ? 16 : 20;
      const totalWidth = (n - 1) * gap;
      for (let i = 0; i < n; i++) {
        const pid = d.winners[i] || null;
        balls.push({
          districtId: d.id,
          seatIndex: i + 1,
          partyId: pid,
          x: d.cx - totalWidth / 2 + i * gap,
          y: d.cy + 4
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
      .attr("r", 8)
      .attr("fill", d => d.partyId ? partyById(d.partyId).color : "#94a3b8")
      .append("title")
      .text(d => `${d.seatIndex}位当選: ${d.partyId ? partyById(d.partyId).name : "未定"}`);

    if (ballStyle === "number") {
      ballNodes.append("text")
        .attr("class", "seat-ball-number")
        .text(d => d.seatIndex);
    }
  }

  // 5. 比例代表ブロック（重複を完全解消した動的レイアウト描画）
  if (prPosition !== "none" && prBlocks.length > 0) {
    renderPrSvgBlocks(prPosition);
  }

  // 6. Wikipedia風凡例パネル
  if (showLegend) {
    renderSvgLegend(prPosition);
  }

  updateTotalSeatSummary();
}

/**
 * 比例代表区のSVG描画（コンテンツ重複完全解消版）
 */
function renderPrSvgBlocks(position) {
  const isRight = position === "right";
  const startX = isRight ? 1040 : 40;
  const startY = isRight ? 80 : 640;
  const panelW = isRight ? 360 : 1360;
  const panelH = isRight ? 780 : 220;

  // パネル背景
  prPanelGroup.append("rect")
    .attr("class", "pr-panel-bg")
    .attr("x", startX)
    .attr("y", startY)
    .attr("width", panelW)
    .attr("height", panelH);

  // パネルタイトル
  const totalPrSeats = prBlocks.reduce((acc, b) => acc + (Number(b.seats) || 0), 0);
  prPanelGroup.append("text")
    .attr("class", "pr-panel-title")
    .attr("x", startX + 16)
    .attr("y", startY + 28)
    .text(`比例代表ブロック （合計 ${totalPrSeats} 議席）`);

  let curY = startY + 44;
  let curX = startX + 14;

  prBlocks.forEach((block, bIdx) => {
    const blockW = isRight ? panelW - 28 : Math.min(420, (panelW - 40) / prBlocks.length);
    const seatOrder = block.seatOrder || [];

    // 議席ボールの行数計算
    const ballRadius = 7;
    const gap = 18;
    const maxCols = Math.max(1, Math.floor((blockW - 24) / gap));
    const numRows = Math.max(1, Math.ceil(seatOrder.length / maxCols));
    const ballAreaH = numRows * 20;

    // サマリーテキストの開始Y座標（ボール群の真下にマージンを空けて確実に配置）
    const summaryStartY = 38 + ballAreaH + 10;
    const activeParties = parties.filter(p => (block.allocated?.[p.id] || 0) > 0);
    const summaryRows = activeParties.length > 5 ? 2 : 1;
    const summaryAreaH = summaryRows * 16 + 6;

    // ブロック全体の高さを中身に合わせて動的に決定（重複ゼロ）
    const blockH = Math.max(90, summaryStartY + summaryAreaH);

    const blockG = prPanelGroup.append("g")
      .attr("transform", `translate(${isRight ? curX : curX + bIdx * (blockW + 12)},${isRight ? curY : curY})`);

    // ブロック枠
    blockG.append("rect")
      .attr("class", "pr-block-box")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", blockW)
      .attr("height", blockH);

    // ブロック見出し
    const methodLabel = {
      "dhondt": "ドント式",
      "sainte-lague": "サン＝ラグ式",
      "largest-remainder-hare": "最大剰余(Hare)",
      "largest-remainder-droop": "最大剰余(Droop)"
    }[block.allocationMethod] || "ドント式";

    blockG.append("text")
      .attr("class", "pr-block-name")
      .attr("x", 12)
      .attr("y", 20)
      .text(block.name || `比例区 ${bIdx + 1}`);

    blockG.append("text")
      .attr("class", "pr-block-meta")
      .attr("x", blockW - 12)
      .attr("y", 20)
      .attr("text-anchor", "end")
      .text(`定数 ${block.seats} / ${methodLabel}`);

    // 獲得議席ボール群
    const ballLayerG = blockG.append("g").attr("transform", "translate(14, 38)");

    seatOrder.forEach((pid, idx) => {
      const col = idx % maxCols;
      const row = Math.floor(idx / maxCols);
      const bx = col * gap;
      const by = row * 20;

      const bg = ballLayerG.append("g").attr("transform", `translate(${bx},${by})`);
      bg.append("circle")
        .attr("r", ballRadius)
        .attr("fill", partyById(pid).color)
        .attr("stroke", "#ffffff")
        .attr("stroke-width", 1.2)
        .append("title")
        .text(`${idx + 1}議席目: ${partyById(pid).name}`);
    });

    // 獲得党派別サマリーテキスト（重なりゼロで配置）
    const summaryG = blockG.append("g").attr("transform", `translate(12, ${summaryStartY})`);

    if (activeParties.length === 0) {
      summaryG.append("text")
        .attr("class", "pr-seat-label")
        .text("議席配分なし");
    } else {
      const row1Parties = activeParties.slice(0, 5);
      const row2Parties = activeParties.slice(5);

      summaryG.append("text")
        .attr("class", "pr-seat-label")
        .text(row1Parties.map(p => `${p.shortName} ${block.allocated[p.id]}`).join("　"));

      if (row2Parties.length > 0) {
        summaryG.append("text")
          .attr("class", "pr-seat-label")
          .attr("y", 14)
          .text(row2Parties.map(p => `${p.shortName} ${block.allocated[p.id]}`).join("　"));
      }
    }

    if (isRight) {
      curY += blockH + 12;
    }
  });
}

/**
 * Wikipedia風凡例（議席集計表 ＋ シェーディング階調凡例）
 */
function renderSvgLegend(prPosition) {
  const legX = 40;
  const legY = prPosition === "bottom" ? 480 : 700;
  const legW = 340;
  const legH = 150;

  const g = legendGroup.append("g").attr("transform", `translate(${legX},${legY})`);

  g.append("rect")
    .attr("class", "legend-panel-bg")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", legW)
    .attr("height", legH);

  g.append("text")
    .attr("class", "legend-heading")
    .attr("x", 12)
    .attr("y", 20)
    .text("議席獲得状況および得票率階調");

  // 得票率シェーディング凡例
  const steps = [
    { label: "<40%", share: 35 },
    { label: "40-50%", share: 45 },
    { label: "50-60%", share: 55 },
    { label: "60%+", share: 65 }
  ];
  const samplePid = parties[0]?.id || "ldp";

  const shadeG = g.append("g").attr("transform", "translate(12, 32)");
  shadeG.append("text")
    .attr("class", "shading-legend-label")
    .attr("x", 0)
    .attr("y", 0)
    .text("勝者得票率階調:");

  steps.forEach((st, idx) => {
    const sx = 95 + idx * 56;
    shadeG.append("rect")
      .attr("x", sx)
      .attr("y", -10)
      .attr("width", 16)
      .attr("height", 12)
      .attr("fill", getDistrictFillColor({ maxParty: samplePid, maxPartyShare: st.share, hasVotes: true }))
      .attr("stroke", "#ffffff")
      .attr("stroke-width", 1);

    shadeG.append("text")
      .attr("class", "shading-legend-label")
      .attr("x", sx + 20)
      .attr("y", 0)
      .text(st.label);
  });

  // 党派別議席数ミニテーブル
  const counts = computeTotalSeats();
  const activeParties = parties.filter(p => (counts.total[p.id] || 0) > 0 || (counts.district[p.id] || 0) > 0);
  const displayParties = activeParties.length > 0 ? activeParties.slice(0, 6) : parties.slice(0, 5);

  const tableG = g.append("g").attr("transform", "translate(12, 54)");

  tableG.append("text").attr("class", "shading-legend-label").attr("x", 0).attr("y", 8).text("政党");
  tableG.append("text").attr("class", "shading-legend-label").attr("x", 140).attr("y", 8).attr("text-anchor", "end").text("小選挙区");
  tableG.append("text").attr("class", "shading-legend-label").attr("x", 210).attr("y", 8).attr("text-anchor", "end").text("比例代表");
  tableG.append("text").attr("class", "shading-legend-label").attr("x", 280).attr("y", 8).attr("text-anchor", "end").text("合計議席");

  displayParties.forEach((p, idx) => {
    const rowY = 24 + idx * 16;
    tableG.append("rect")
      .attr("x", 0)
      .attr("y", rowY - 9)
      .attr("width", 10)
      .attr("height", 10)
      .attr("fill", p.color);

    tableG.append("text")
      .attr("class", "legend-party-name")
      .attr("x", 16)
      .attr("y", rowY)
      .text(p.shortName);

    tableG.append("text")
      .attr("class", "legend-party-seats")
      .attr("x", 140)
      .attr("y", rowY)
      .text(counts.district[p.id] || 0);

    tableG.append("text")
      .attr("class", "legend-party-seats")
      .attr("x", 210)
      .attr("y", rowY)
      .text(counts.pr[p.id] || 0);

    tableG.append("text")
      .attr("class", "legend-party-seats")
      .attr("x", 280)
      .attr("y", rowY)
      .attr("fill", "#000000")
      .text(counts.total[p.id] || 0);
  });
}

// --- 議席合計計算 ---
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
  summaryEl.innerHTML = "";

  parties.forEach(p => {
    const tot = counts.total[p.id] || 0;
    if (tot > 0) {
      const chip = document.createElement("div");
      chip.className = "seat-chip";
      chip.innerHTML = `
        <span class="seat-chip-dot" style="background:${p.color}"></span>
        <strong>${escapeHtml(p.shortName)}</strong>
        <span>${tot}議席</span>
      `;
      summaryEl.appendChild(chip);
    }
  });

  $("#barTitle").textContent = $("#electionTitle").value;
  $("#barSubtitle").textContent = $("#electionSubtitle").value;
  $("#documentTitle").textContent = $("#electionTitle").value;
}

// --- 選挙区選択とクイックインスペクター（安定化の要） ---
function selectDistrict(did) {
  selectedDistrictId = did;

  // 地図上の選択クラスのみを即座に更新
  polyLayer.selectAll(".district-poly")
    .classed("selected", d => d.id === did);

  // 選挙区タブの一覧カードにもハイライト＆折り畳みを自動解除
  collapsedDistrictIds.delete(did);
  renderDistrictEditor();

  const card = $(`.district-card[data-district-id="${CSS.escape(did)}"]`);
  if (card) {
    card.classList.add("selected");
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // クイックインスペクターを更新・表示（左下配置で右サイドパネルを邪魔しない）
  updateDistrictInspector();
  setStatus(`${districts[did]?.name || did} を選択しました`);
}

function updateDistrictInspector() {
  const insp = $("#districtInspector");
  if (!selectedDistrictId || !districts[selectedDistrictId]) {
    insp.classList.remove("show");
    return;
  }

  const d = districts[selectedDistrictId];
  insp.classList.add("show");

  $("#inspDistrictName").textContent = d.name;
  $("#inspDistrictId").textContent = `(${d.id})`;
  $("#inspSeatsInput").value = d.seats;

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
        <button class="rank-btn" data-insp-action="up" data-idx="${idx}" ${idx === 0 ? "disabled" : ""}>▲</button>
        <button class="rank-btn" data-insp-action="down" data-idx="${idx}" ${idx === candList.length - 1 ? "disabled" : ""}>▼</button>
      </div>
      <select data-insp-action="party" data-idx="${idx}">
        ${parties.map(p => `<option value="${p.id}" ${p.id === c.party ? "selected" : ""}>${escapeHtml(p.shortName)}</option>`).join("")}
      </select>
      <input type="text" data-insp-action="name" data-idx="${idx}" value="${escapeHtml(c.name)}" placeholder="氏名">
      <input class="votes-input" type="number" min="0" data-insp-action="votes" data-idx="${idx}" value="${voteVal}" placeholder="得票数(任意)">
      <button class="del-cand-btn" data-insp-action="del" data-idx="${idx}" title="削除">✕</button>
    `;
    listEl.appendChild(row);
  });

  // フッターサマリー
  const winBadges = (d.winners || []).map((pid, idx) => {
    const p = partyById(pid);
    return `<span class="seat-badge" style="background:${p.color}">${idx + 1}位: ${escapeHtml(p.shortName)}</span>`;
  }).join(" ");
  $("#inspWinnersBadge").innerHTML = winBadges || "なし";
  $("#inspShareText").textContent = d.maxPartyShare !== null ? `最多得票率: ${d.maxPartyShare.toFixed(1)}%` : "(手動順位)";

  // インスペクター内イベントバインド
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

// --- UI レンダリング ---
function renderAll() {
  renderPartyEditor();
  renderDistrictEditor();
  renderPrBlockEditor();
  renderValidation();
  renderMap();
}

/**
 * 政党エディタタブ描画
 */
function renderPartyEditor() {
  const container = $("#partyListContainer");
  container.innerHTML = "";

  parties.forEach((p, idx) => {
    const card = document.createElement("div");
    card.className = "party-edit-card";
    card.innerHTML = `
      <input type="color" data-action="party-color" data-idx="${idx}" value="${p.color}">
      <input type="text" data-action="party-name" data-idx="${idx}" value="${escapeHtml(p.name)}" placeholder="政党名">
      <input type="text" data-action="party-short" data-idx="${idx}" value="${escapeHtml(p.shortName)}" placeholder="略称">
      <button class="party-del-btn" data-action="party-del" data-idx="${idx}" title="政党を削除">✕</button>
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
        parties[idx].name = e.target.value.trim() || `政党${idx + 1}`;
        renderMap();
        updateBatchPartyOptions();
        markDirty();
      });
    } else if (act === "party-short") {
      el.addEventListener("change", e => {
        pushHistory();
        parties[idx].shortName = e.target.value.trim() || `党${idx + 1}`;
        renderMap();
        updateBatchPartyOptions();
        updateDistrictInspector();
        markDirty();
      });
    } else if (act === "party-del") {
      el.addEventListener("click", () => {
        if (parties.length <= 1) {
          notify("少なくとも1つの政党が必要です");
          return;
        }
        pushHistory();
        parties.splice(idx, 1);
        recalcAll();
        renderAll();
        updateDistrictInspector();
        markDirty("政党を削除しました");
      });
    }
  });
}

/**
 * 選挙区エディタタブ描画（アコーディオン折り畳み対応）
 */
function renderDistrictEditor() {
  const container = $("#districtListContainer");
  container.innerHTML = "";

  const filterText = ($("#districtFilterInput").value || "").toLowerCase();
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

    // 当選者バッジミニ表示（折り畳み時用）
    const miniWinnerBadges = (d.winners || []).map((pid, idx) => {
      const p = partyById(pid);
      return `<span class="seat-badge" style="background:${p.color}">${idx + 1}位:${escapeHtml(p.shortName)}</span>`;
    }).join(" ");

    // ヘッダー部（名称・アコーディオン開閉・個別定数）
    const head = document.createElement("div");
    head.className = "district-card-head";
    head.innerHTML = `
      <div class="district-head-left" data-action="toggle-accordion" data-id="${id}">
        <span class="accordion-toggle-icon">▼</span>
        <span class="district-card-title">${escapeHtml(d.name)} <small>(${escapeHtml(id)})</small></span>
        <span class="collapsed-badge">${miniWinnerBadges || "未定"}</span>
      </div>
      <div class="district-card-seats">
        <span>定数:</span>
        <input type="number" min="1" max="20" data-action="district-seats" data-id="${id}" value="${d.seats}">
      </div>
    `;
    card.appendChild(head);

    // 候補者一覧
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
          <button class="rank-btn" data-action="cand-up" data-id="${id}" data-idx="${cIdx}" ${cIdx === 0 ? "disabled" : ""}>▲</button>
          <button class="rank-btn" data-action="cand-down" data-id="${id}" data-idx="${cIdx}" ${cIdx === candList.length - 1 ? "disabled" : ""}>▼</button>
        </div>
        <select data-action="cand-party" data-id="${id}" data-idx="${cIdx}">
          ${parties.map(p => `<option value="${p.id}" ${p.id === c.party ? "selected" : ""}>${escapeHtml(p.shortName)}</option>`).join("")}
        </select>
        <input type="text" data-action="cand-name" data-id="${id}" data-idx="${cIdx}" value="${escapeHtml(c.name)}" placeholder="候補者名">
        <input class="votes-input" type="number" min="0" data-action="cand-votes" data-id="${id}" data-idx="${cIdx}" value="${voteVal}" placeholder="得票数(任意)">
        <button class="del-cand-btn" data-action="cand-del" data-id="${id}" data-idx="${cIdx}" title="候補者削除">✕</button>
      `;
      card.appendChild(row);
    });

    const addCandBtn = document.createElement("button");
    addCandBtn.className = "small-btn district-add-cand-btn";
    addCandBtn.style.marginTop = "6px";
    addCandBtn.style.width = "100%";
    addCandBtn.textContent = "＋ 候補者を追加";
    addCandBtn.dataset.action = "cand-add";
    addCandBtn.dataset.id = id;
    card.appendChild(addCandBtn);

    // サマリー行
    const summaryLine = document.createElement("div");
    summaryLine.className = "district-summary-line";
    const winnerBadges = (d.winners || []).map((pid, idx) => {
      const p = partyById(pid);
      return `<span class="seat-badge" style="background:${p.color}">${idx + 1}位: ${escapeHtml(p.shortName)}</span>`;
    }).join(" ");

    const shareInfo = d.maxPartyShare !== null
      ? `最多得票率: ${d.maxPartyShare.toFixed(1)}%`
      : `<span style="color:#2563eb;">手動設定順位</span>`;

    summaryLine.innerHTML = `
      <div class="district-winners-badge">${winnerBadges || "当選者なし"}</div>
      <span>${shareInfo}</span>
    `;
    card.appendChild(summaryLine);

    container.appendChild(card);
  });

  // イベントバインド
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
    } else if (act === "district-seats") {
      el.addEventListener("change", e => {
        pushHistory();
        districts[did].seats = Math.max(1, Number(e.target.value) || 1);
        recalcDistrict(did);
        renderDistrictEditor();
        renderMap();
        updateDistrictInspector();
        markDirty();
      });
    } else if (act === "cand-votes") {
      el.addEventListener("input", e => {
        const val = e.target.value.trim();
        districts[did].candidates[idx].votes = val !== "" ? Math.max(0, Number(val) || 0) : null;
        recalcDistrict(did);
        renderMap();
        updateDistrictInspector();
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
        markDirty();
      });
    } else if (act === "cand-add") {
      el.addEventListener("click", () => {
        pushHistory();
        if (!districts[did].candidates) districts[did].candidates = [];
        districts[did].candidates.push({
          id: `cand-${Math.random().toString(36).slice(2, 8)}`,
          name: "新候補者",
          party: parties[0]?.id || "ldp",
          votes: null,
          rank: districts[did].candidates.length + 1
        });
        recalcDistrict(did);
        renderDistrictEditor();
        renderMap();
        updateDistrictInspector();
        markDirty();
      });
    }
  });
}

/**
 * 比例区エディタタブ描画
 */
function renderPrBlockEditor() {
  const container = $("#prBlockListContainer");
  container.innerHTML = "";

  if (prBlocks.length === 0) {
    container.innerHTML = `
      <div class="info-box">
        現在、比例代表区は設定されていません（小選挙区制など）。<br>
        上の「＋ 新しい比例区を追加」ボタンから比例区ブロックを作成できます。
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
        <input type="text" data-pr-action="name" data-idx="${bIdx}" value="${escapeHtml(block.name)}" style="font-weight:700;font-size:13px;width:180px;">
        <button class="pr-block-del-btn" data-pr-action="del" data-idx="${bIdx}">削除</button>
      </div>

      <div class="field-grid-2">
        <label class="field">
          <span>個別定数</span>
          <input type="number" min="1" max="200" data-pr-action="seats" data-idx="${bIdx}" value="${block.seats}">
        </label>
        <label class="field">
          <span>配分方式</span>
          <select data-pr-action="allocation" data-idx="${bIdx}">
            <option value="dhondt" ${block.allocationMethod === "dhondt" ? "selected" : ""}>ドント式</option>
            <option value="sainte-lague" ${block.allocationMethod === "sainte-lague" ? "selected" : ""}>サン＝ラグ式</option>
            <option value="largest-remainder-hare" ${block.allocationMethod === "largest-remainder-hare" ? "selected" : ""}>最大剰余式(Hare)</option>
            <option value="largest-remainder-droop" ${block.allocationMethod === "largest-remainder-droop" ? "selected" : ""}>最大剰余式(Droop)</option>
          </select>
        </label>
      </div>

      <div class="mode-tabs" style="margin-top:4px;">
        <button class="${block.mode !== "shares" ? "active" : ""}" data-pr-action="mode-votes" data-idx="${bIdx}">得票数入力</button>
        <button class="${block.mode === "shares" ? "active" : ""}" data-pr-action="mode-shares" data-idx="${bIdx}">得票率(%)入力</button>
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
              <span class="pr-seat-chip">${seatCount} 議席</span>
            </div>
          `;
        }).join("")}
      </div>
    `;

    container.appendChild(card);
  });

  // イベントバインド
  container.querySelectorAll("[data-pr-action]").forEach(el => {
    const act = el.dataset.prAction;
    const idx = Number(el.dataset.idx);

    if (act === "name") {
      el.addEventListener("change", e => {
        pushHistory();
        prBlocks[idx].name = e.target.value.trim() || `比例区${idx + 1}`;
        renderMap();
        markDirty();
      });
    } else if (act === "seats") {
      el.addEventListener("change", e => {
        pushHistory();
        prBlocks[idx].seats = Math.max(1, Number(e.target.value) || 1);
        recalcPrBlock(prBlocks[idx]);
        renderPrBlockEditor();
        renderMap();
        markDirty();
      });
    } else if (act === "allocation") {
      el.addEventListener("change", e => {
        pushHistory();
        prBlocks[idx].allocationMethod = e.target.value;
        recalcPrBlock(prBlocks[idx]);
        renderPrBlockEditor();
        renderMap();
        markDirty();
      });
    } else if (act === "mode-votes") {
      el.addEventListener("click", () => {
        pushHistory();
        prBlocks[idx].mode = "votes";
        recalcPrBlock(prBlocks[idx]);
        renderPrBlockEditor();
        renderMap();
        markDirty();
      });
    } else if (act === "mode-shares") {
      el.addEventListener("click", () => {
        pushHistory();
        prBlocks[idx].mode = "shares";
        recalcPrBlock(prBlocks[idx]);
        renderPrBlockEditor();
        renderMap();
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
        markDirty("比例区を削除しました");
      });
    }
  });
}

/**
 * 検証タブ描画
 */
function renderValidation() {
  const container = $("#validationContainer");
  const items = [];

  const fList = geoData?.features || [];
  const ids = fList.map(f => idOf(f));
  const dups = ids.filter((id, i) => ids.indexOf(id) !== i);

  if (!ids.length) {
    items.push(["error", "GeoJSON地図データが読み込まれていません。"]);
  } else {
    if (ids.some(x => !x)) {
      items.push(["error", "選挙区IDが空の要素が存在します。IDフィールド設定を確認してください。"]);
    }
    if (dups.length) {
      items.push(["error", `重複する選挙区IDがあります: ${[...new Set(dups)].join(", ")}`]);
    }
    if (!dups.length && !ids.some(x => !x)) {
      items.push(["ok", `選挙区データ: ${ids.length}件、重複なしで正常です。`]);
    }
  }

  // 比例代表の検証
  if (prBlocks.length > 0) {
    prBlocks.forEach((b, i) => {
      const totalSeats = b.seats;
      const assigned = Object.values(b.allocated || {}).reduce((a, c) => a + c, 0);
      if (assigned !== totalSeats) {
        items.push(["warn", `比例区「${b.name || i + 1}」: 定数${totalSeats}に対し、配分結果が${assigned}議席です（有効得票数または得票率を確認してください）。`]);
      } else {
        items.push(["ok", `比例区「${b.name || i + 1}」: 定数${totalSeats}議席の配分が完全に整合しています。`]);
      }
    });
  }

  container.innerHTML = items.map(([type, msg]) => `
    <div class="validation-item ${type}">${escapeHtml(msg)}</div>
  `).join("");
}

// --- イベントバインド ---
function bindEvents() {
  // タブ切り替え
  $$(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // ヘルプモーダル
  const helpModal = $("#helpModal");
  $("#helpBtn").addEventListener("click", () => helpModal.classList.add("show"));
  $("#closeHelpModalBtn").addEventListener("click", () => helpModal.classList.remove("show"));
  $("#gotItHelpBtn").addEventListener("click", () => helpModal.classList.remove("show"));
  helpModal.addEventListener("click", e => {
    if (e.target === helpModal) helpModal.classList.remove("show");
  });

  // アコーディオン一括制御
  $("#expandAllDistrictsBtn").addEventListener("click", () => {
    collapsedDistrictIds.clear();
    renderDistrictEditor();
  });
  $("#collapseAllDistrictsBtn").addEventListener("click", () => {
    Object.keys(districts).forEach(id => collapsedDistrictIds.add(id));
    renderDistrictEditor();
  });

  // プリセット変更
  $("#presetSelect").addEventListener("change", e => applyPreset(e.target.value));

  // 一括定数変更
  $("#batchSetSeatsBtn").addEventListener("click", () => {
    batchSetDistrictSeats($("#batchSeatsInput").value);
  });

  // 候補者一括追加・削除補助
  $("#batchAddPartyCandBtn").addEventListener("click", () => {
    batchAddPartyCandidates($("#batchPartySelect").value);
  });
  $("#batchDelPartyCandBtn").addEventListener("click", () => {
    batchRemovePartyCandidates($("#batchPartySelect").value);
  });
  $("#setupMajorPartiesBtn").addEventListener("click", setupMajorPartiesCandidates);
  $("#clearAllCandidatesBtn").addEventListener("click", clearAllCandidates);

  // 表示設定関連
  ["showBalls", "showDistrictNames", "showWinnerNames", "showShareText", "showLegend"].forEach(id => {
    $("#" + id).addEventListener("change", () => {
      pushHistory();
      renderMap();
      markDirty();
    });
  });

  ["shadingMethod", "ballStyle", "prLayoutPosition"].forEach(id => {
    $("#" + id).addEventListener("change", () => {
      pushHistory();
      renderMap();
      markDirty();
    });
  });

  $("#electionTitle").addEventListener("input", () => {
    renderMap();
    markDirty();
  });
  $("#electionSubtitle").addEventListener("input", () => {
    renderMap();
    markDirty();
  });

  // 比例区追加
  $("#addPrBlockBtn").addEventListener("click", () => {
    pushHistory();
    const newIdx = prBlocks.length + 1;
    const votes = {};
    const shares = {};
    parties.forEach(p => { votes[p.id] = 0; shares[p.id] = "0.00"; });

    prBlocks.push({
      id: `pr-block-${Math.random().toString(36).slice(2, 7)}`,
      name: `第${newIdx}比例ブロック`,
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
    markDirty("比例代表区を追加しました");
  });

  $("#clearPrBlocksBtn").addEventListener("click", () => {
    if (!confirm("すべての比例代表区を消去しますか？")) return;
    pushHistory();
    prBlocks = [];
    renderPrBlockEditor();
    renderMap();
    markDirty("比例区を全消去しました");
  });

  // 政党追加
  $("#addPartyBtn").addEventListener("click", () => {
    pushHistory();
    const colors = ["#475569", "#7c3aed", "#0891b2", "#059669", "#d97706", "#dc2626"];
    const col = colors[parties.length % colors.length];
    const pid = `p_${Math.random().toString(36).slice(2, 7)}`;
    parties.push({
      id: pid,
      name: `新政党${parties.length + 1}`,
      shortName: `新党${parties.length + 1}`,
      color: col
    });
    recalcAll();
    renderAll();
    updateBatchPartyOptions();
    markDirty("政党を追加しました");
  });

  $("#resetPartiesBtn").addEventListener("click", async () => {
    if (!confirm("政党一覧を標準設定にリセットしますか？")) return;
    pushHistory();
    const partiesData = await fetch("data/parties.json").then(r => r.json());
    parties = partiesData.parties;
    recalcAll();
    renderAll();
    updateBatchPartyOptions();
    markDirty("政党をリセットしました");
  });

  // 選挙区検索フィルター
  $("#districtFilterInput").addEventListener("input", renderDistrictEditor);

  // ファイル読込（GeoJSON）
  $("#geojsonInput").addEventListener("change", e => e.target.files[0] && loadGeoJsonFile(e.target.files[0]));
  const dropzone = $("#dropzone");
  ["dragenter", "dragover"].forEach(ev => dropzone.addEventListener(ev, e => {
    e.preventDefault();
    dropzone.style.borderColor = "var(--navy)";
  }));
  ["dragleave", "drop"].forEach(ev => dropzone.addEventListener(ev, e => {
    e.preventDefault();
    dropzone.style.borderColor = "var(--line-dark)";
  }));
  dropzone.addEventListener("drop", e => {
    const f = e.dataTransfer.files[0];
    if (f) loadGeoJsonFile(f);
  });

  // クイックインスペクター閉じるボタン
  $("#inspCloseBtn").addEventListener("click", () => {
    selectedDistrictId = null;
    polyLayer.selectAll(".district-poly").classed("selected", false);
    $("#districtInspector").classList.remove("show");
  });

  // クイックインスペクター候補者追加
  $("#inspAddCandBtn").addEventListener("click", () => {
    if (!selectedDistrictId || !districts[selectedDistrictId]) return;
    pushHistory();
    const d = districts[selectedDistrictId];
    if (!d.candidates) d.candidates = [];
    d.candidates.push({
      id: `cand-${Math.random().toString(36).slice(2, 8)}`,
      name: "新候補者",
      party: parties[0]?.id || "ldp",
      votes: null,
      rank: d.candidates.length + 1
    });
    recalcDistrict(d.id);
    renderMap();
    updateDistrictInspector();
    renderDistrictEditor();
    markDirty();
  });

  // クイックインスペクター定数変更
  $("#inspSeatsInput").addEventListener("change", e => {
    if (!selectedDistrictId || !districts[selectedDistrictId]) return;
    pushHistory();
    districts[selectedDistrictId].seats = Math.max(1, Number(e.target.value) || 1);
    recalcDistrict(selectedDistrictId);
    renderMap();
    updateDistrictInspector();
    renderDistrictEditor();
    markDirty();
  });

  // 地図の背景クリックで選択解除
  $("#bgRect").addEventListener("click", () => {
    selectedDistrictId = null;
    polyLayer.selectAll(".district-poly").classed("selected", false);
    $("#districtInspector").classList.remove("show");
  });

  // Undo / Redo
  $("#undoBtn").addEventListener("click", undo);
  $("#redoBtn").addEventListener("click", redo);

  // プロジェクト保存・読込
  $("#newProjectBtn").addEventListener("click", () => {
    if (!confirm("新規プロジェクトを作成しますか？未保存の変更は失われます。")) return;
    pushHistory();
    $("#electionTitle").value = "新規選挙結果地図";
    $("#electionSubtitle").value = "各種選挙制度・前提に基づく集計";
    loadSampleData(false);
    notify("新規プロジェクトを開きました");
  });
  $("#saveProjectBtn").addEventListener("click", saveProjectFile);
  $("#loadProjectBtn").addEventListener("click", () => $("#projectInput").click());
  $("#projectInput").addEventListener("change", e => e.target.files[0] && loadProjectFile(e.target.files[0]));

  // 制度定義保存・読込
  $("#exportSystemBtn").addEventListener("click", exportSystemDefinition);
  $("#importSystemBtn").addEventListener("click", () => $("#systemInput").click());
  $("#systemInput").addEventListener("change", e => e.target.files[0] && importSystemDefinition(e.target.files[0]));

  // SVG / PNG エクスポート
  $("#exportSvgBtn").addEventListener("click", exportSvgMap);
  $("#exportPngBtn").addEventListener("click", exportPngMap);

  // ズーム制御
  const zoom = d3.zoom().scaleExtent([0.6, 10]).on("zoom", e => {
    rootGroup.attr("transform", e.transform);
  });
  svg.call(zoom);

  $("#zoomIn").addEventListener("click", () => svg.transition().duration(250).call(zoom.scaleBy, 1.25));
  $("#zoomOut").addEventListener("click", () => svg.transition().duration(250).call(zoom.scaleBy, 0.8));
  $("#zoomReset").addEventListener("click", () => svg.transition().duration(250).call(zoom.transform, d3.zoomIdentity));
  $("#fitMap").addEventListener("click", () => {
    svg.transition().duration(250).call(zoom.transform, d3.zoomIdentity);
    renderMap();
    setStatus("全体表示にリセット");
  });

  // キーボードショートカット
  window.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      $("#helpModal").classList.remove("show");
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
}

// --- ファイル処理 (IO & Exports) ---
function loadGeoJsonFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      if (d.type !== "FeatureCollection" || !Array.isArray(d.features)) {
        throw new Error("有効なGeoJSON (FeatureCollection) ではありません");
      }
      pushHistory();
      geoData = d;
      districts = {};
      selectedDistrictId = null;

      d.features.forEach(f => {
        const id = idOf(f);
        districts[id] = {
          id,
          name: f.properties?.name || id,
          seats: Number($("#batchSeatsInput").value) || 1,
          candidates: parties.slice(0, 3).map((p, idx) => ({
            id: `cand-${Math.random().toString(36).slice(2, 8)}`,
            name: `${p.shortName}候補`,
            party: p.id,
            votes: null,
            rank: idx + 1
          }))
        };
      });

      $("#dataStatus").textContent = `${file.name} （${d.features.length} 選挙区）`;
      recalcAll();
      renderAll();
      updateDistrictInspector();
      notify(`地図を読み込みました (${d.features.length}選挙区)`);
      markDirty();
    } catch (err) {
      notify(`地図読込エラー: ${err.message}`);
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
  a.download = `${safeFileName($("#electionTitle").value || "election-project")}.emproj.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
  markClean();
  notify("プロジェクトを保存しました");
}

function loadProjectFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const s = JSON.parse(reader.result);
      if (!s.geoData || !s.districts) throw new Error("有効なプロジェクトファイル形式ではありません");
      pushHistory();
      restore(s);
      markClean();
      notify("プロジェクトを読み込みました");
    } catch (err) {
      notify(`プロジェクト読込失敗: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

// 制度定義のみの保存・読込 (.emsys.json)
function exportSystemDefinition() {
  const systemData = {
    type: "election-system-definition",
    version: 1,
    name: PRESETS[currentPreset]?.name || "カスタム選挙制度",
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
  notify("選挙制度定義を保存しました");
}

function importSystemDefinition(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const s = JSON.parse(reader.result);
      if (s.type !== "election-system-definition") {
        throw new Error("有効な選挙制度定義ファイル (.emsys.json) ではありません");
      }
      pushHistory();
      if (s.preset && PRESETS[s.preset]) {
        currentPreset = s.preset;
        $("#presetSelect").value = s.preset;
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
      notify(`選挙制度定義「${s.name || "カスタム制度"}」を適用しました`);
      markDirty();
    } catch (err) {
      notify(`制度読込エラー: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

// --- 高品質SVGエクスポート（完全不透明・Wikipedia規格完全自己完結型） ---
function exportSvgMap() {
  const clone = svg.node().cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", SVG_W);
  clone.setAttribute("height", SVG_H);
  clone.setAttribute("viewBox", `0 0 ${SVG_W} ${SVG_H}`);

  const styleEl = document.createElementNS("http://www.w3.org/2000/svg", "style");
  styleEl.textContent = `
    .district-poly { stroke: #ffffff; stroke-width: 2.2; }
    .map-svg-title { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif; font-size: 26px; font-weight: 800; fill: #0f172a; }
    .map-svg-subtitle { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif; font-size: 12px; font-weight: 500; fill: #475569; }
    .district-label-text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif; font-size: 13px; font-weight: 700; text-anchor: middle; fill: #0f172a; paint-order: stroke; stroke: #ffffff; stroke-width: 5px; }
    .district-winner-text { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif; font-size: 11px; font-weight: 600; text-anchor: middle; fill: #1e293b; paint-order: stroke; stroke: #ffffff; stroke-width: 4px; }
    .district-share-text { font-family: Consolas, monospace; font-size: 10px; font-weight: 700; text-anchor: middle; fill: #334155; paint-order: stroke; stroke: #ffffff; stroke-width: 3px; }
    .seat-ball-circle { stroke: #ffffff; stroke-width: 1.8; }
    .seat-ball-number { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif; font-size: 8px; font-weight: 800; text-anchor: middle; dominant-baseline: central; fill: #ffffff; paint-order: stroke; stroke: #0f172a; stroke-width: 1.6px; }
    .pr-panel-bg { fill: #f8fafc; stroke: #cbd5e1; stroke-width: 1.2; rx: 4; }
    .pr-panel-title { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif; font-size: 14px; font-weight: 700; fill: #0f172a; }
    .pr-block-box { fill: #ffffff; stroke: #cbd5e1; stroke-width: 1; rx: 3; }
    .pr-block-name { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif; font-size: 12px; font-weight: 700; fill: #1e293b; }
    .pr-block-meta { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif; font-size: 10px; fill: #64748b; }
    .pr-seat-label { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif; font-size: 10px; fill: #334155; }
    .legend-panel-bg { fill: #ffffff; stroke: #cbd5e1; stroke-width: 1; rx: 3; }
    .legend-heading { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif; font-size: 12px; font-weight: 700; fill: #0f172a; }
    .legend-party-name { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif; font-size: 11px; font-weight: 600; fill: #1e293b; }
    .legend-party-seats { font-family: Consolas, monospace; font-size: 11px; font-weight: 700; text-anchor: end; fill: #0f172a; }
    .shading-legend-label { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Yu Gothic UI", "Meiryo", sans-serif; font-size: 9px; fill: #64748b; }
  `;
  clone.insertBefore(styleEl, clone.firstChild);

  const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bgRect.setAttribute("width", SVG_W);
  bgRect.setAttribute("height", SVG_H);
  bgRect.setAttribute("fill", "#ffffff");
  clone.insertBefore(bgRect, clone.firstChild);

  const meta = document.createElementNS("http://www.w3.org/2000/svg", "metadata");
  meta.textContent = `Election Map Studio v5 Professional | Wikipedia Standard | Generated: ${new Date().toISOString()}`;
  clone.insertBefore(meta, clone.firstChild);

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFileName($("#electionTitle").value || "election-map")}.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
  notify("Wikipedia規格の完全不透明SVGを書き出しました");
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
      a.download = `${safeFileName($("#electionTitle").value || "election-map")}.png`;
      a.click();
      URL.revokeObjectURL(u);
      URL.revokeObjectURL(url);
      notify("高解像度PNGを書き出しました");
    }, "image/png");
  };
  img.src = url;
}

// 実行開始
init().catch(err => {
  console.error(err);
  notify(`初期化エラー: ${err.message}`);
});
