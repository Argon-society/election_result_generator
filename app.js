
const SVG_W=1280, SVG_H=860;
const svg=d3.select("#map");
const root=svg.append("g");
const mapLayer=root.append("g");
const ballLayer=root.append("g");
const textLayer=root.append("g");
const overlayLayer=root.append("g");

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];

let parties=[];
let geoData=null;
let results={};
let currentMode="votes";
let selectedId=null;
let projection=null;
let path=null;
let dirty=true;
let history=[];
let future=[];
let historyLock=false;
let projectName="election-result-map";

const SAMPLE_VOTES={
  "OK-1":{A:52000,B:43000,C:12000,D:7000},
  "OK-2":{A:18000,B:51000,C:31000,D:9000},
  "OK-3":{A:21000,B:18000,C:47000,D:11000},
  "OK-4":{A:56000,B:24000,C:13000,D:8000},
  "OK-5":{A:30000,B:45000,C:22000,D:6000}
};

const PRESETS={
  "shugiin-smd":{
    system:"smd", seats:1, allocation:"dhondt",
    hint:"衆議院の小選挙区は各選挙区1議席。候補者の最多得票者が当選します。"
  },
  "shugiin-pr":{
    system:"pr", seats:11, allocation:"dhondt",
    hint:"衆議院比例代表は地域ブロック単位の比例代表。政党得票をドント式で議席配分します。実際のブロック定数に合わせて議席数を変更してください。"
  },
  "sangiin-district":{
    system:"mmd", seats:2, allocation:"dhondt",
    hint:"参議院選挙区は都道府県等を単位とする選挙区。定数は選挙区ごとに異なるため、このツールでは地区ごとに設定・集計できます。"
  },
  "sangiin-pr":{
    system:"pr", seats:50, allocation:"dhondt",
    hint:"参議院比例代表は全国を1選挙区とする比例代表。政党票と候補者票を区別して扱う拡張が可能です。"
  },
  "mmd-sntv":{
    system:"mmd", seats:3, allocation:"dhondt",
    hint:"大選挙区・単記非移譲式では有権者は1候補に投票し、得票上位から定数分が当選します。党派色は候補者の所属政党から表示します。"
  },
  "mmd-party":{
    system:"mmd", seats:3, allocation:"dhondt",
    hint:"複数人区・党派順位方式。候補者単位の得票順位、または設定順位をそのまま当選枠に割り当てます。"
  },
  "custom":{
    system:"smd", seats:1, allocation:"dhondt",
    hint:"自由設定。制度の説明文を確認しながら、地図表示に必要な当選枠を設定してください。"
  }
};

function notify(msg){
  const t=$("#toast"); t.textContent=msg; t.classList.add("show");
  clearTimeout(notify.timer); notify.timer=setTimeout(()=>t.classList.remove("show"),2100);
}

function idOf(f){
  const field=$("#idField").value;
  if(field==="id") return String(f.id ?? "");
  if(field==="name") return String(f.properties?.name ?? "");
  if(field==="code") return String(f.properties?.code ?? "");
  return String(f.id ?? f.properties?.id ?? f.properties?.code ?? f.properties?.name ?? "");
}

function getSeatCount(){
  return $("#system").value==="smd" ? 1 : Math.max(1, Number($("#seatCount").value)||1);
}

function party(pid){ return parties.find(p=>p.id===pid) || null; }

function ensureResult(id){
  if(!results[id]) results[id]={votes:{}, candidates:[], winners:[]};
  parties.forEach(p=>{ if(results[id].votes[p.id]==null) results[id].votes[p.id]=0; });
  return results[id];
}

function candidateTemplate(id,pid="",name="",votes=0){
  return {id:`${id}-${Math.random().toString(36).slice(2,8)}`, party:pid, name:name||"候補者", votes:Number(votes)||0};
}

function normalizeResult(id){
  const r=ensureResult(id);
  if(!Array.isArray(r.candidates)) r.candidates=[];
  return r;
}

function pushHistory(){
  if(historyLock) return;
  const state=JSON.stringify(snapshot());
  history.push(state);
  if(history.length>60) history.shift();
  future=[];
  dirty=true; updateSaveState();
}

function undo(){
  if(!history.length) return;
  future.push(JSON.stringify(snapshot()));
  const prev=JSON.parse(history.pop());
  historyLock=true; restore(prev); historyLock=false;
}
function redo(){
  if(!future.length) return;
  history.push(JSON.stringify(snapshot()));
  const next=JSON.parse(future.pop());
  historyLock=true; restore(next); historyLock=false;
}

function snapshot(){
  return {
    version:4, projectName,
    title:$("#electionTitle").value, subtitle:$("#electionSubtitle").value,
    preset:$("#preset").value, system:$("#system").value,
    seats:Number($("#seatCount").value)||1, allocation:$("#allocationMethod").value,
    mode:currentMode, idField:$("#idField").value,
    showLabels:$("#showLabels").checked, showBalls:$("#showBalls").checked,
    showVoteShare:$("#showVoteShare").checked, showNames:$("#showNames").checked,
    geoData, results, selectedId
  };
}

function restore(s){
  projectName=s.projectName||"election-result-map";
  $("#electionTitle").value=s.title||"選挙結果地図";
  $("#electionSubtitle").value=s.subtitle||"Election Map Studio";
  $("#preset").value=s.preset||"custom"; $("#system").value=s.system||"smd";
  $("#seatCount").value=s.seats||1; $("#allocationMethod").value=s.allocation||"dhondt";
  $("#idField").value=s.idField||"auto";
  ["showLabels","showBalls","showVoteShare","showNames"].forEach(k=>$("#"+k).checked=s[k]!==false);
  currentMode=s.mode==="ranking"?"ranking":"votes";
  $$(".mode-tabs button").forEach(b=>b.classList.toggle("active",b.dataset.mode===currentMode));
  geoData=s.geoData; results=s.results||{}; selectedId=s.selectedId||null;
  updatePresetHint(); recalcAll(); renderAll(); setStatus("復元しました");
}

function markDirty(msg){
  dirty=true; updateSaveState();
  if(msg) setStatus(msg);
}
function markClean(){
  dirty=false; updateSaveState();
}

function updateSaveState(){
  $("#saveState").textContent=dirty?"未保存の変更あり":"保存済み";
  $("#saveState").style.color=dirty?"#8a5a19":"#376c4e";
}
function setStatus(msg){$("#statusText").textContent=msg;}

async function init(){
  parties=await fetch("data/parties.json").then(r=>r.json()).then(x=>x.parties);
  await loadSample(false);
  updatePresetHint(); bindUI(); renderAll();
  setStatus("準備完了");
}

async function loadSample(makeHistory=true){
  const d=await fetch("data/okayama-sample.geojson").then(r=>r.json());
  geoData=d; results={}; selectedId=null;
  d.features.forEach(f=>{
    const id=idOf(f);
    const votes={...(SAMPLE_VOTES[id]||{})};
    const candidates=parties.map((p,i)=>candidateTemplate(id,p.id,`${p.shortName}候補`,votes[p.id]||0));
    results[id]={votes,candidates,winners:[]};
  });
  if(makeHistory) pushHistory();
  recalcAll(); renderAll();
  $("#dataStatus").textContent="岡山県サンプル（簡略図）";
  markDirty("サンプル地図を読み込みました");
}

function applyPreset(){
  const p=PRESETS[$("#preset").value];
  $("#system").value=p.system; $("#seatCount").value=p.seats; $("#allocationMethod").value=p.allocation;
  updatePresetHint(); recalcAll(); renderAll();
  pushHistory(); markDirty("制度プリセットを変更しました");
}

function updatePresetHint(){
  const p=PRESETS[$("#preset").value]||PRESETS.custom;
  $("#systemHint").textContent=p.hint;
  $("#allocationMethod").disabled=$("#system").value!=="pr";
  $("#seatCount").disabled=$("#system").value==="smd";
}

function rankedCandidates(r){
  return (r.candidates||[]).filter(c=>party(c.party)).sort((a,b)=>Number(b.votes)-Number(a.votes) || a.name.localeCompare(b.name,"ja"));
}

function recalc(id){
  const r=normalizeResult(id);
  const n=getSeatCount();
  if(currentMode==="ranking") return;
  if($("#system").value==="smd"){
    const arr=rankedCandidates(r);
    r.winners=arr.slice(0,1).map(c=>c.party);
    return;
  }
  if($("#system").value==="mmd"){
    const arr=rankedCandidates(r);
    r.winners=arr.slice(0,n).map(c=>c.party);
    return;
  }
  const entries=parties.map(p=>({id:p.id,v:Number(r.votes[p.id])||0}));
  const divs=$("#allocationMethod").value==="sainte-lague"
    ? Array.from({length:n},(_,i)=>1+2*i)
    : Array.from({length:n},(_,i)=>1+i);
  const q=[];
  entries.forEach(p=>divs.forEach(d=>q.push({id:p.id,q:p.v/d,base:p.v,divisor:d})));
  q.sort((a,b)=>b.q-a.q || a.id.localeCompare(b.id));
  r.winners=q.slice(0,n).map(x=>x.id);
  r.prQuotients=q.slice(0,n);
}

function recalcAll(){ if(!geoData)return; geoData.features.forEach(f=>recalc(idOf(f))); }

function buildCandidatesFor(id,r){
  if(!(r.candidates||[]).length){
    r.candidates=parties.map(p=>candidateTemplate(id,p.id,`${p.shortName}候補`,r.votes[p.id]||0));
  }
  parties.forEach(p=>{
    if(!r.candidates.some(c=>c.party===p.id)) r.candidates.push(candidateTemplate(id,p.id,`${p.shortName}候補`,r.votes[p.id]||0));
  });
}

function renderEditor(){
  const host=$("#resultEditor");
  const n=getSeatCount();
  const isPR=$("#system").value==="pr";
  host.innerHTML="";
  geoData.features.forEach((f,idx)=>{
    const id=idOf(f), r=normalizeResult(id), name=f.properties?.name||id||`選挙区${idx+1}`;
    buildCandidatesFor(id,r);
    const block=document.createElement("div"); block.className="district-block"; block.dataset.id=id;
    const head=document.createElement("div"); head.className="district-head";
    head.innerHTML=`<span class="district-name">${escapeHtml(name)}</span><span class="district-meta">${n}議席</span>`;
    block.appendChild(head);
    if(isPR){
      if(currentMode==="votes"){
        const note=document.createElement("div"); note.className="result-table-note"; note.textContent="政党票を入力。議席は選択した比例配分方式で自動計算。"; block.appendChild(note);
        parties.forEach(p=>{
          const row=document.createElement("div"); row.className="result-row";
          row.innerHTML=`<span class="rank">${escapeHtml(p.shortName)}</span><select data-kind="party-vote-party" data-id="${id}"><option value="${p.id}">${escapeHtml(p.name)}</option></select><input class="votes" type="number" min="0" step="1" data-kind="party-vote" data-id="${id}" data-party="${p.id}" value="${Number(r.votes[p.id])||0}">`;
          block.appendChild(row);
        });
      } else {
        const note=document.createElement("div"); note.className="result-table-note"; note.textContent=`第1位から第${n}位までを議席順として指定。`; block.appendChild(note);
        for(let s=0;s<n;s++){
          const row=document.createElement("div"); row.className="result-row";
          const selected=r.winners[s]||parties[0]?.id||"";
          row.innerHTML=`<span class="rank">${s+1}位</span><select data-kind="winner-slot" data-id="${id}" data-seat="${s}">${parties.map(p=>`<option value="${p.id}" ${selected===p.id?"selected":""}>${escapeHtml(p.shortName)}</option>`).join("")}</select><span class="rank">議席</span>`;
          block.appendChild(row);
        }
      }
    } else {
      if(currentMode==="votes"){
        const note=document.createElement("div"); note.className="result-table-note"; note.textContent="候補者単位で得票数を入力。上位議席数名を当選とします。"; block.appendChild(note);
        r.candidates.forEach(c=>{
          const row=document.createElement("div"); row.className="result-row";
          row.innerHTML=`<span class="rank">${escapeHtml(c.name)}</span><select data-kind="candidate-party" data-id="${id}" data-cid="${c.id}">${parties.map(p=>`<option value="${p.id}" ${p.id===c.party?"selected":""}>${escapeHtml(p.shortName)}</option>`).join("")}</select><input class="votes" type="number" min="0" step="1" data-kind="candidate-votes" data-id="${id}" data-cid="${c.id}" value="${Number(c.votes)||0}">`;
          block.appendChild(row);
        });
        if($("#system").value==="smd" || $("#system").value==="mmd"){
          const add=document.createElement("button"); add.textContent="候補者を追加"; add.dataset.action="addCandidate"; add.dataset.id=id; add.style.marginTop="7px"; add.style.width="100%"; block.appendChild(add);
        }
      } else {
        const note=document.createElement("div"); note.className="result-table-note"; note.textContent=`第1位から第${n}位までを当選順位として指定。`; block.appendChild(note);
        for(let s=0;s<n;s++){
          const row=document.createElement("div"); row.className="result-row";
          const selected=r.winners[s]||parties[0]?.id||"";
          row.innerHTML=`<span class="rank">${s+1}位</span><select data-kind="winner-slot" data-id="${id}" data-seat="${s}">${parties.map(p=>`<option value="${p.id}" ${selected===p.id?"selected":""}>${escapeHtml(p.shortName)}</option>`).join("")}</select><span class="rank">当選枠</span>`;
          block.appendChild(row);
        }
      }
    }
    host.appendChild(block);
  });

  host.querySelectorAll("input,select").forEach(el=>{
    el.addEventListener("change",()=>{ pushHistory(); handleEditorChange(el); });
    el.addEventListener("input",()=>{ handleEditorChange(el); });
  });
  host.querySelectorAll("[data-action=addCandidate]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      pushHistory();
      const r=normalizeResult(btn.dataset.id);
      r.candidates.push(candidateTemplate(btn.dataset.id,parties[0]?.id,"新候補",0));
      renderEditor(); renderMap(); markDirty("候補者を追加しました");
    });
  });
}

function handleEditorChange(el){
  const id=el.dataset.id, r=normalizeResult(id);
  const kind=el.dataset.kind;
  if(kind==="party-vote"){
    r.votes[el.dataset.party]=Math.max(0,Number(el.value)||0);
  }else if(kind==="candidate-votes"){
    const c=r.candidates.find(x=>x.id===el.dataset.cid); if(c)c.votes=Math.max(0,Number(el.value)||0);
    syncPartyVotesFromCandidates(r);
  }else if(kind==="candidate-party"){
    const c=r.candidates.find(x=>x.id===el.dataset.cid); if(c)c.party=el.value;
    syncPartyVotesFromCandidates(r);
  }else if(kind==="winner-slot"){
    r.winners[Number(el.dataset.seat)]=el.value;
  }
  if(currentMode==="votes") recalc(id);
  renderMap(); renderPartyLegend(); renderValidation(); markDirty();
}

function syncPartyVotesFromCandidates(r){
  const totals={}; parties.forEach(p=>totals[p.id]=0);
  (r.candidates||[]).forEach(c=>{ if(totals[c.party]!=null) totals[c.party]+=Number(c.votes)||0; });
  Object.assign(r.votes,totals);
}

function fillDemo(){
  if(!geoData)return;
  pushHistory();
  geoData.features.forEach(f=>{
    const id=idOf(f),r=normalizeResult(id);
    r.candidates=parties.map(p=>candidateTemplate(id,p.id,`${p.shortName}候補`,SAMPLE_VOTES[id]?.[p.id]||0));
    r.votes={...(SAMPLE_VOTES[id]||{})};
  });
  recalcAll(); renderAll(); markDirty("サンプル結果を反映しました");
}
function clearResults(){
  if(!geoData)return;
  pushHistory();
  geoData.features.forEach(f=>{
    const id=idOf(f),r=normalizeResult(id);
    r.votes={}; parties.forEach(p=>r.votes[p.id]=0);
    r.candidates=parties.map(p=>candidateTemplate(id,p.id,`${p.shortName}候補`,0));
    r.winners=[];
  });
  recalcAll(); renderAll(); markDirty("結果を消去しました");
}

function shareText(d){
  const total=Object.values(d.votes||{}).reduce((a,b)=>a+(Number(b)||0),0);
  if(!total || !d.w.length) return "";
  const win=d.w[0],v=Number(d.votes[win])||0;
  return `${party(win)?.shortName||""} ${((v/total)*100).toFixed(1)}%`;
}

function ballItems(info){
  const balls=[];
  info.forEach(d=>{
    const n=d.w.length;
    const gap=n>=8?16:20;
    const total=(n-1)*gap;
    d.w.forEach((pid,i)=>balls.push({
      x:d.x-total/2+i*gap, y:d.y+21, pid, seat:i+1, district:d.id
    }));
  });
  return balls;
}

function renderMap(){
  if(!geoData)return;
  projection=d3.geoIdentity().reflectY(true).fitExtent([[90,120],[1190,735]],geoData);
  path=d3.geoPath(projection);
  [mapLayer,ballLayer,textLayer,overlayLayer].forEach(x=>x.selectAll("*").remove());

  overlayLayer.append("text").attr("class","map-heading").attr("x",90).attr("y",44).text($("#electionTitle").value);
  overlayLayer.append("text").attr("class","map-subheading").attr("x",90).attr("y",65).text($("#electionSubtitle").value);

  const feats=geoData.features;
  const info=feats.map((f,i)=>{
    const id=idOf(f),r=normalizeResult(id), c=path.centroid(f);
    return {f,id,x:c[0],y:c[1],name:f.properties?.name||id||`選挙区${i+1}`,w:[...(r.winners||[])],votes:r.votes||[],candidates:r.candidates||[]};
  });

  mapLayer.selectAll("path").data(info,d=>d.id).join("path")
    .attr("class",d=>"district"+(d.id===selectedId?" selected":""))
    .attr("d",d=>path(d.f))
    .attr("fill",d=>party(d.w[0])?.color||"#d4d9de")
    .on("click",(e,d)=>{
      selectedId=d.id; renderMap(); highlightEditor(d.id);
      setStatus(`${d.name} を選択`);
    });

  if($("#showLabels").checked){
    textLayer.selectAll(".district-label").data(info,d=>d.id).join("text")
      .attr("class","district-label").attr("x",d=>d.x).attr("y",d=>d.y-8).text(d=>d.name);
  }

  if($("#showNames").checked){
    textLayer.selectAll(".district-winner").data(info,d=>d.id).join("text")
      .attr("class","district-winner").attr("x",d=>d.x).attr("y",d=>d.y+10)
      .text(d=>formatWinnerName(d));
  }

  if($("#showVoteShare").checked){
    textLayer.selectAll(".district-share").data(info,d=>d.id).join("text")
      .attr("class","district-share").attr("x",d=>d.x).attr("y",d=>d.y+28)
      .text(d=>shareText(d));
  }

  if($("#showBalls").checked && $("#system").value!=="smd"){
    const balls=ballItems(info);
    ballLayer.selectAll(".seat-ball").data(balls,d=>`${d.district}-${d.seat}`).join("circle")
      .attr("class","seat-ball").attr("cx",d=>d.x).attr("cy",d=>d.y).attr("r",8)
      .attr("fill",d=>party(d.pid)?.color||"#888")
      .append("title").text(d=>`${d.seat}位　${party(d.pid)?.name||d.pid}`);
    ballLayer.selectAll(".seat-ball-label").data(balls,d=>`${d.district}-${d.seat}`).join("text")
      .attr("class","seat-ball-label").attr("x",d=>d.x).attr("y",d=>d.y+0.5).text(d=>d.seat);
  }

  if($("#system").value==="pr"){
    overlayLayer.append("text").attr("class","map-note").attr("x",90).attr("y",780)
      .text($("#allocationMethod").value==="dhondt"?"議席配分：ドント式":"議席配分：サン＝ラグ式");
  }

  updateSummary();
}

function formatWinnerName(d){
  if(!d.w.length)return "";
  if($("#system").value==="mmd" && currentMode==="votes"){
    const r=results[d.id], arr=rankedCandidates(r).slice(0,Math.min(3,d.w.length));
    return arr.map(c=>`${party(c.party)?.shortName||""}`).join(" / ");
  }
  return d.w.slice(0,3).map(pid=>party(pid)?.shortName||"").join(" / ");
}

function updateSummary(){
  const counts={};
  Object.values(results).forEach(r=>(r.winners||[]).forEach(pid=>counts[pid]=(counts[pid]||0)+1));
  $("#mapTitle").textContent=$("#electionTitle").value;
  $("#mapSubtitle").textContent=$("#electionSubtitle").value;
  $("#documentTitle").textContent=$("#electionTitle").value||"選挙結果地図";
  $("#seatSummary").textContent=parties.map(p=>`${p.shortName} ${counts[p.id]||0}`).join("　");
}

function renderPartyLegend(){
  const counts={};
  Object.values(results).forEach(r=>(r.winners||[]).forEach(pid=>counts[pid]=(counts[pid]||0)+1));
  $("#partyLegend").innerHTML=parties.map(p=>`
    <div class="party-row">
      <span class="swatch" style="background:${p.color}"></span>
      <span>${escapeHtml(p.name)}</span>
      <span class="party-seat">${counts[p.id]||0}議席</span>
    </div>`).join("");
}

function renderValidation(){
  const items=[];
  const ids=geoData?.features.map(f=>idOf(f))||[];
  const dup=ids.filter((x,i)=>ids.indexOf(x)!==i);
  if(!ids.length) items.push(["error","GeoJSONに選挙区がありません。"]);
  if(dup.length) items.push(["error",`重複IDがあります：${[...new Set(dup)].join(", ")}`]);
  if(ids.some(x=>!x)) items.push(["error","IDが空の選挙区があります。ID項目を変更してください。"]);
  if(!dup.length && !ids.some(x=>!x)) items.push(["ok",`選挙区ID：${ids.length}件　重複なし`]);
  const n=getSeatCount();
  if($("#system").value!=="smd" && n<2) items.push(["warn","複数議席制度では2議席以上を推奨します。"]);
  if($("#system").value==="pr" && currentMode==="ranking") items.push(["warn","比例代表の順位指定は簡易表示用です。政党得票による配分は「得票数」を使用してください。"]);
  $("#validation").innerHTML=items.map(([type,msg])=>`<div class="validation-item ${type}">${escapeHtml(msg)}</div>`).join("");
}

function highlightEditor(id){
  $$(".district-block").forEach(x=>x.style.background=x.dataset.id===id?"#f0f4f7":"#fff");
  const el=$(`.district-block[data-id="${CSS.escape(id)}"]`);
  if(el)el.scrollIntoView({block:"nearest"});
}

function renderAll(){
  updatePresetHint();
  renderEditor();
  renderMap();
  renderPartyLegend();
  renderValidation();
  updateSaveState();
}

function loadGeo(file){
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const d=JSON.parse(reader.result);
      if(d.type!=="FeatureCollection" || !Array.isArray(d.features)) throw new Error("FeatureCollectionではありません");
      const ids=d.features.map(f=>idOf(f));
      if(ids.some(x=>!x) || new Set(ids).size!==ids.length) throw new Error("選挙区IDが空または重複しています");
      pushHistory();
      geoData=d; results={}; selectedId=null;
      d.features.forEach((f,i)=>{
        const id=idOf(f), votes={};
        parties.forEach(p=>votes[p.id]=0);
        results[id]={votes,candidates:parties.map(p=>candidateTemplate(id,p.id,`${p.shortName}候補`,0)),winners:[]};
      });
      $("#dataStatus").textContent=`${file.name}　${d.features.length}選挙区`;
      recalcAll(); renderAll(); markDirty("GeoJSONを読み込みました");
      notify("GeoJSONを読み込みました");
    }catch(err){ notify(`読み込み失敗：${err.message}`); }
  };
  reader.readAsText(file);
}

function saveProjectFile(){
  const data=JSON.stringify(snapshot(),null,2);
  const blob=new Blob([data],{type:"application/json;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a"); a.href=url; a.download=`${projectName||"election-result-map"}.emproj.json`; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),400);
  markClean(); notify("プロジェクトを保存しました");
}

function loadProjectFile(file){
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const s=JSON.parse(reader.result);
      if(!s.geoData || !s.geoData.features) throw new Error("プロジェクト形式ではありません");
      restore(s); markClean(); notify("プロジェクトを読み込みました");
    }catch(err){notify(`プロジェクト読込失敗：${err.message}`);}
  };
  reader.readAsText(file);
}

function exportSvg(){
  const clone=svg.node().cloneNode(true);
  clone.setAttribute("xmlns","http://www.w3.org/2000/svg");
  clone.setAttribute("width",SVG_W); clone.setAttribute("height",SVG_H);
  clone.setAttribute("viewBox",`0 0 ${SVG_W} ${SVG_H}`);
  const style=document.createElementNS("http://www.w3.org/2000/svg","style");
  style.textContent=`
    .district{stroke:#fff;stroke-width:2.4}.district-label{font-size:13px;font-weight:700;text-anchor:middle;fill:#202a33;paint-order:stroke;stroke:#fff;stroke-width:5px}.district-winner{font-size:11px;font-weight:700;text-anchor:middle;fill:#25313c;paint-order:stroke;stroke:#fff;stroke-width:4px}.district-share{font-size:9px;text-anchor:middle;fill:#5a6670}.seat-ball{stroke:#fff;stroke-width:1.6}.seat-ball-label{font-size:7px;font-weight:700;text-anchor:middle;dominant-baseline:middle;fill:#fff;paint-order:stroke;stroke:#2c3237;stroke-width:1.2px}.map-heading{font-size:25px;font-weight:700;fill:#1e252c}.map-subheading{font-size:11px;fill:#65707b}.map-note{font-size:9px;fill:#7a848d}.pr-group-label{font-size:10px;font-weight:700;fill:#47515a}`;
  clone.insertBefore(style,clone.firstChild);
  const meta=document.createElementNS("http://www.w3.org/2000/svg","metadata");
  meta.textContent=`Election Map Studio v4 Professional | ${new Date().toISOString()}`;
  clone.insertBefore(meta,clone.firstChild);
  const xml='<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(clone);
  const blob=new Blob([xml],{type:"image/svg+xml;charset=utf-8"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url; a.download=`${safeFileName($("#electionTitle").value||"election-map")}.svg`; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),500); notify("SVGを書き出しました");
}

function exportPng(){
  const clone=svg.node().cloneNode(true);
  clone.setAttribute("xmlns","http://www.w3.org/2000/svg");
  clone.setAttribute("width",SVG_W); clone.setAttribute("height",SVG_H);
  const xml=new XMLSerializer().serializeToString(clone);
  const blob=new Blob([xml],{type:"image/svg+xml;charset=utf-8"});
  const url=URL.createObjectURL(blob), img=new Image();
  img.onload=()=>{
    const c=document.createElement("canvas"); c.width=SVG_W*2; c.height=SVG_H*2;
    const ctx=c.getContext("2d"); ctx.fillStyle="#fff"; ctx.fillRect(0,0,c.width,c.height); ctx.scale(2,2); ctx.drawImage(img,0,0);
    c.toBlob(b=>{
      const u=URL.createObjectURL(b),a=document.createElement("a");a.href=u;a.download=`${safeFileName($("#electionTitle").value||"election-map")}.png`;a.click();
      URL.revokeObjectURL(u); URL.revokeObjectURL(url);
    },"image/png");
  };
  img.src=url;
}

function safeFileName(s){return s.replace(/[\\/:*?"<>|]/g,"_").slice(0,80)||"election-map";}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}

const zoom=d3.zoom().scaleExtent([.6,8]).on("zoom",e=>root.attr("transform",e.transform));
svg.call(zoom);

function bindUI(){
  $$(".mode-tabs button").forEach(b=>b.addEventListener("click",()=>{
    if(currentMode===b.dataset.mode)return;
    pushHistory();
    currentMode=b.dataset.mode;
    $$(".mode-tabs button").forEach(x=>x.classList.toggle("active",x===b));
    recalcAll(); renderAll(); markDirty("入力モードを変更しました");
  }));

  $("#preset").addEventListener("change",applyPreset);
  ["system","seatCount","allocationMethod","idField"].forEach(id=>{
    $("#"+id).addEventListener("change",()=>{
      pushHistory();
      if($("#system").value==="smd")$("#seatCount").value=1;
      if($("#system").value!=="smd" && Number($("#seatCount").value)<2)$("#seatCount").value=2;
      recalcAll(); updatePresetHint(); renderAll(); markDirty("制度設定を変更しました");
    });
  });

  ["showLabels","showBalls","showVoteShare","showNames"].forEach(id=>$("#"+id).addEventListener("change",renderMap));
  $("#electionTitle").addEventListener("input",()=>{renderMap();markDirty()});
  $("#electionSubtitle").addEventListener("input",()=>{renderMap();markDirty()});
  $("#fillDemoBtn").addEventListener("click",fillDemo);
  $("#clearResultsBtn").addEventListener("click",clearResults);

  $("#loadSampleBtn")?.addEventListener("click",()=>loadSample(true));
  $("#geojsonInput").addEventListener("change",e=>e.target.files[0]&&loadGeo(e.target.files[0]));
  const dz=$("#dropzone");
  ["dragenter","dragover"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.style.borderColor="#4d718f"}));
  ["dragleave","drop"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.style.borderColor="#9ba5af"}));
  dz.addEventListener("drop",e=>{const f=e.dataTransfer.files[0];if(f)loadGeo(f)});

  $("#saveProjectBtn").addEventListener("click",saveProjectFile);
  $("#loadProjectBtn").addEventListener("click",()=>$("#projectInput").click());
  $("#projectInput").addEventListener("change",e=>e.target.files[0]&&loadProjectFile(e.target.files[0]));
  $("#newProjectBtn").addEventListener("click",()=>{
    pushHistory(); loadSample(false); $("#electionTitle").value="新しい選挙結果地図"; $("#electionSubtitle").value="Election Map Studio";
    renderAll(); markDirty("新規プロジェクトを作成しました");
  });

  $("#exportSvgBtn").addEventListener("click",exportSvg);
  $("#exportPngBtn").addEventListener("click",exportPng);

  $("#zoomIn").addEventListener("click",()=>svg.transition().call(zoom.scaleBy,1.25));
  $("#zoomOut").addEventListener("click",()=>svg.transition().call(zoom.scaleBy,.8));
  $("#zoomReset").addEventListener("click",()=>svg.transition().call(zoom.transform,d3.zoomIdentity));
  $("#fitMap").addEventListener("click",()=>{svg.transition().call(zoom.transform,d3.zoomIdentity);renderMap();setStatus("全体表示");});

  window.addEventListener("keydown",e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();undo()}
    else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="y"){e.preventDefault();redo()}
    else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){e.preventDefault();saveProjectFile()}
  });
}

init().catch(err=>notify(`初期化に失敗しました：${err.message}`));
