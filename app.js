const svg = d3.select("#map");
const width = 1000, height = 760;
const g = svg.append("g");
const mapLayer = g.append("g").attr("class","map-layer");
const ballLayer = g.append("g").attr("class","ball-layer");
const textLayer = g.append("g").attr("class","text-layer");
const decoration = g.append("g").attr("class","decoration");

let geoData = null;
let parties = [];
let results = {};
let projection = d3.geoIdentity().reflectY(true).fitSize([760, 610], {type:"FeatureCollection",features:[]});
let path = d3.geoPath(projection);
let zoom = d3.zoom().scaleExtent([0.7, 6]).on("zoom", e => g.attr("transform", e.transform));
svg.call(zoom);

const sampleVotes = {
  "OK-1": {"A":52000,"B":43000,"C":12000,"D":7000},
  "OK-2": {"A":18000,"B":51000,"C":31000,"D":9000},
  "OK-3": {"A":21000,"B":18000,"C":47000,"D":11000},
  "OK-4": {"A":56000,"B":24000,"C":13000,"D":8000},
  "OK-5": {"A":30000,"B":45000,"C":22000,"D":6000}
};

function mode(){ return document.querySelector('input[name="resultMode"]:checked').value; }
function system(){ return document.querySelector("#system").value; }
function seats(){ return system()==="smd" ? 1 : Math.max(1, Number(document.querySelector("#seatCount").value)||1); }

async function loadParties(){
  const data = await fetch("data/parties.json").then(r=>r.json());
  parties = data.parties;
  renderPartyLegend();
}

async function loadSample(){
  const data = await fetch("data/okayama-sample.geojson").then(r=>r.json());
  geoData = data;
  results = {};
  data.features.forEach((f,i)=>{
    const id = getId(f);
    const votes = {...(sampleVotes[id] || {})};
    results[id] = {votes, winners: []};
  });
  recalculateAll();
  document.querySelector("#status").textContent = "岡山県サンプルを表示中（地図形状はデモ用）";
  render();
}

function getId(feature){
  const field = document.querySelector("#idField").value;
  if(field === "id") return feature.id;
  if(field === "name") return feature.properties?.name;
  if(field === "code") return feature.properties?.code;
  return feature.id ?? feature.properties?.id ?? feature.properties?.code ?? feature.properties?.name;
}

function partyById(id){ return parties.find(p=>p.id===id) || parties[0]; }

function renderPartyLegend(){
  const el = document.querySelector("#partyLegend");
  el.innerHTML = parties.map(p=>`
    <div class="party-row">
      <span class="swatch" style="background:${p.color}"></span>
      <span>${p.name}</span>
      <span style="margin-left:auto;color:#687386">${p.shortName}</span>
    </div>`).join("");
}

function ensureResult(id){
  if(!results[id]) results[id] = {votes:{}, winners:[]};
  if(!results[id].votes) results[id].votes = {};
  if(!results[id].winners) results[id].winners = [];
  parties.forEach(p=>{ if(results[id].votes[p.id] == null) results[id].votes[p.id]=0; });
  return results[id];
}

function renderControls(){
  const el = document.querySelector("#districtList");
  if(!geoData){el.innerHTML="";return;}
  const m = mode(), sys = system(), n = seats();
  el.innerHTML = geoData.features.map((f,i)=>{
    const id = getId(f), r = ensureResult(id);
    const name = f.properties?.name || id || `選挙区${i+1}`;
    if(m==="votes"){
      return `<div class="district-card">
        <div class="district-head"><span class="district-name">${name}</span><span class="district-seat-summary">${n}議席</span></div>
        <div class="vote-grid">
          ${parties.map(p=>`
            <label class="vote-party"><span class="vote-dot" style="background:${p.color}"></span>${p.shortName}</label>
            <input class="vote-input" type="number" min="0" step="1" data-id="${id}" data-party="${p.id}" value="${Number(r.votes[p.id]||0)}">
          `).join("")}
        </div>
      </div>`;
    }
    return `<div class="district-card">
      <div class="district-head"><span class="district-name">${name}</span><span class="district-seat-summary">${n}議席</span></div>
      ${Array.from({length:n},(_,seat)=>`
        <div class="direct-seat">
          <label>${seat+1}位</label>
          <select class="district-select" data-id="${id}" data-seat="${seat}">
            ${parties.map(p=>`<option value="${p.id}" ${p.id===r.winners[seat]?"selected":""}>${p.shortName}</option>`).join("")}
          </select>
        </div>`).join("")}
    </div>`;
  }).join("");

  el.querySelectorAll(".vote-input").forEach(inp=>inp.addEventListener("input", e=>{
    const r=ensureResult(e.target.dataset.id);
    r.votes[e.target.dataset.party]=Math.max(0, Number(e.target.value)||0);
    recalculate(e.target.dataset.id);
    renderMapOnly();
  }));
  el.querySelectorAll(".district-select").forEach(s=>s.addEventListener("change", e=>{
    const r=ensureResult(e.target.dataset.id);
    const seat=Number(e.target.dataset.seat);
    r.winners[seat]=e.target.value;
    renderMapOnly();
  }));
}

function allocation(votes, count){
  const entries = parties.map(p=>({id:p.id,votes:Number(votes[p.id]||0)}));
  if(system()==="smd") return entries.sort((a,b)=>b.votes-a.votes)[0] ? [entries.sort((a,b)=>b.votes-a.votes)[0].id] : [];
  if(system()==="mmd"){
    return entries.sort((a,b)=>b.votes-a.votes).slice(0,count).map(x=>x.id);
  }
  const winners=[];
  const quotients=[];
  for(const p of entries){
    for(let d=1;d<=count;d++) quotients.push({id:p.id,q:p.votes/d});
  }
  quotients.sort((a,b)=>b.q-a.q || a.id.localeCompare(b.id));
  quotients.slice(0,count).forEach(x=>winners.push(x.id));
  return winners;
}

function recalculate(id){
  if(mode()!=="votes") return;
  const r=ensureResult(id);
  r.winners=allocation(r.votes,seats());
}

function recalculateAll(){
  Object.keys(results).forEach(recalculate);
}

function render(){
  renderControls();
  renderMapOnly();
}

function renderMapOnly(){
  if(!geoData) return;
  projection = d3.geoIdentity().reflectY(true).fitExtent([[90,95],[910,650]], geoData);
  path = d3.geoPath(projection);
  mapLayer.selectAll("*").remove();
  ballLayer.selectAll("*").remove();
  textLayer.selectAll("*").remove();
  decoration.selectAll("*").remove();

  const sys=system(), n=seats();
  decoration.append("text").attr("x",90).attr("y",45).attr("class","map-heading")
    .text(document.querySelector("#electionTitle").value);
  const subtitle = sys==="smd" ? "小選挙区制・最多得票方式" : sys==="mmd" ? `複数人区・上位${n}名` : `比例代表・D'Hondt方式・${n}議席`;
  decoration.append("text").attr("x",90).attr("y",68).attr("class","map-subheading").text(subtitle+" / DEMO MAP");

  mapLayer.selectAll("path")
    .data(geoData.features)
    .join("path")
    .attr("class","district")
    .attr("d",path)
    .attr("fill",d=>{
      const r=ensureResult(getId(d));
      const winners=r.winners||[];
      return partyById(winners[0])?.color || "#ddd";
    })
    .on("click",(event,d)=>{
      if(mode()==="votes") return;
      const id=getId(d), r=ensureResult(id);
      if(sys==="smd"){
        const idx=parties.findIndex(p=>p.id===r.winners[0]);
        r.winners=[parties[(idx+1)%parties.length].id];
      }else{
        const idx=parties.findIndex(p=>p.id===r.winners[0]);
        const next=parties[(idx+1)%parties.length].id;
        r.winners=[next,...r.winners.slice(1)];
      }
      renderControls(); renderMapOnly();
    });

  const labels = geoData.features.map(f=>{
    const c=path.centroid(f), r=ensureResult(getId(f));
    return {x:c[0],y:c[1],name:f.properties?.name || getId(f),winners:r.winners||[]};
  });

  textLayer.selectAll(".district-label").data(labels).join("text")
    .attr("class","district-label").attr("x",d=>d.x).attr("y",d=>d.y-4).text(d=>d.name);

  if(sys==="smd"){
    textLayer.selectAll(".district-winner").data(labels).join("text")
      .attr("class","district-winner").attr("x",d=>d.x).attr("y",d=>d.y+17)
      .text(d=>partyById(d.winners[0])?.shortName || "");
  }else{
    const ballData=[];
    labels.forEach(d=>{
      const radius = Math.min(11, Math.max(7, 42/Math.sqrt(d.winners.length+1)));
      const gap=radius*2+5;
      const total=(d.winners.length-1)*gap;
      d.winners.forEach((pid,i)=>{
        ballData.push({x:d.x-total/2+i*gap,y:d.y+22,pid,radius,seat:i+1});
      });
    });
    ballLayer.selectAll(".seat-ball").data(ballData).join("circle")
      .attr("class","seat-ball").attr("cx",d=>d.x).attr("cy",d=>d.y).attr("r",d=>d.radius)
      .attr("fill",d=>partyById(d.pid)?.color || "#999");
    ballLayer.selectAll(".seat-ball-label").data(ballData).join("text")
      .attr("class","seat-ball-label").attr("x",d=>d.x).attr("y",d=>d.y+0.5).text(d=>d.seat);
  }

  updateFooter();
}

function updateFooter(){
  const counts={};
  Object.values(results).forEach(r=>(r.winners||[]).forEach(id=>counts[id]=(counts[id]||0)+1));
  document.querySelector("#mapLegend").textContent =
    parties.map(p=>`${p.shortName} ${counts[p.id]||0}議席`).join("　");
  document.querySelector("#mapTitle").textContent=document.querySelector("#electionTitle").value;
}

document.querySelector("#sampleBtn").addEventListener("click",loadSample);
document.querySelector("#electionTitle").addEventListener("input",updateFooter);
document.querySelector("#idField").addEventListener("change",render);

document.querySelector("#system").addEventListener("change",()=>{
  const n=document.querySelector("#seatCount");
  if(system()==="smd") n.value=1;
  else if(Number(n.value)<2) n.value=2;
  recalculateAll(); render();
});
document.querySelector("#seatCount").addEventListener("change",()=>{
  if(system()==="smd") document.querySelector("#seatCount").value=1;
  recalculateAll(); render();
});
document.querySelectorAll('input[name="resultMode"]').forEach(r=>r.addEventListener("change",()=>{
  recalculateAll(); render();
}));

document.querySelector("#geojsonInput").addEventListener("change",async e=>{
  const file=e.target.files[0]; if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    if(data.type!=="FeatureCollection") throw new Error("FeatureCollectionではありません");
    geoData=data; results={};
    data.features.forEach((f,i)=>{
      const id=getId(f);
      results[id]={votes:{},winners:[parties[i%parties.length]?.id].filter(Boolean)};
      parties.forEach(p=>results[id].votes[p.id]=0);
    });
    document.querySelector("#status").textContent=`${file.name} を読み込みました`;
    render();
  }catch(err){alert("GeoJSONの読み込みに失敗しました: "+err.message);}
});

document.querySelector("#zoomIn").addEventListener("click",()=>svg.transition().call(zoom.scaleBy,1.35));
document.querySelector("#zoomOut").addEventListener("click",()=>svg.transition().call(zoom.scaleBy,0.75));
document.querySelector("#zoomReset").addEventListener("click",()=>svg.transition().call(zoom.transform,d3.zoomIdentity));

document.querySelector("#exportBtn").addEventListener("click",()=>{
  const clone=svg.node().cloneNode(true);
  clone.setAttribute("xmlns","http://www.w3.org/2000/svg");
  clone.setAttribute("width","1000"); clone.setAttribute("height","760");
  const source='<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(clone);
  const blob=new Blob([source],{type:"image/svg+xml;charset=utf-8"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob); a.download="election-result-map.svg"; a.click();
  URL.revokeObjectURL(a.href);
});

(async()=>{await loadParties();await loadSample();})();
