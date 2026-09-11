const svg = d3.select("#map");
const width = 1000, height = 760;
const g = svg.append("g");
const mapLayer = g.append("g").attr("class","map-layer");
const textLayer = g.append("g").attr("class","text-layer");
const decoration = g.append("g").attr("class","decoration");

let geoData = null;
let parties = [];
let results = {};
let projection = d3.geoIdentity().reflectY(true).fitSize([760, 610], {type:"FeatureCollection",features:[]});
let path = d3.geoPath(projection);
let zoom = d3.zoom().scaleExtent([0.7, 6]).on("zoom", e => g.attr("transform", e.transform));
svg.call(zoom);

const sampleResults = {
  "OK-1":"A", "OK-2":"B", "OK-3":"C", "OK-4":"A", "OK-5":"B"
};

async function loadParties(){
  const data = await fetch("data/parties.json").then(r=>r.json());
  parties = data.parties;
  renderPartyLegend();
}

async function loadSample(){
  const data = await fetch("data/okayama-sample.geojson").then(r=>r.json());
  geoData = data;
  results = {...sampleResults};
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

function renderControls(){
  const el = document.querySelector("#districtList");
  if(!geoData){el.innerHTML="";return;}
  el.innerHTML = geoData.features.map((f,i)=>{
    const id = getId(f);
    const name = f.properties?.name || id || `選挙区${i+1}`;
    const selected = results[id] || parties[0]?.id;
    return `<div class="district-row">
      <span class="district-name">${name}</span>
      <select class="district-select" data-id="${id}">
        ${parties.map(p=>`<option value="${p.id}" ${p.id===selected?"selected":""}>${p.shortName}</option>`).join("")}
      </select>
    </div>`;
  }).join("");
  el.querySelectorAll("select").forEach(s=>s.addEventListener("change", e=>{
    results[e.target.dataset.id] = e.target.value;
    renderMapOnly();
  }));
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
  textLayer.selectAll("*").remove();
  decoration.selectAll("*").remove();

  decoration.append("text").attr("x",90).attr("y",45).attr("class","map-heading")
    .text(document.querySelector("#electionTitle").value);
  decoration.append("text").attr("x",90).attr("y",68).attr("class","map-subheading")
    .text("小選挙区制・最多得票方式 / DEMO MAP");

  mapLayer.selectAll("path")
    .data(geoData.features)
    .join("path")
    .attr("class","district")
    .attr("d",path)
    .attr("fill",d=>partyById(results[getId(d)])?.color || "#ddd")
    .on("click",(event,d)=>{
      const id = getId(d);
      const idx = parties.findIndex(p=>p.id===results[id]);
      results[id] = parties[(idx+1)%parties.length].id;
      renderControls();
      renderMapOnly();
    });

  const labels = geoData.features.map(f=>{
    const c = path.centroid(f);
    return {x:c[0],y:c[1],name:f.properties?.name || getId(f),party:partyById(results[getId(f)])};
  });

  textLayer.selectAll(".district-label").data(labels).join("text")
    .attr("class","district-label").attr("x",d=>d.x).attr("y",d=>d.y-4).text(d=>d.name);

  textLayer.selectAll(".district-winner").data(labels).join("text")
    .attr("class","district-winner").attr("x",d=>d.x).attr("y",d=>d.y+17).text(d=>d.party?.shortName || "");

  updateFooter();
}

function updateFooter(){
  const counts = {};
  Object.values(results).forEach(id=>counts[id]=(counts[id]||0)+1);
  document.querySelector("#mapLegend").textContent =
    parties.map(p=>`${p.shortName} ${counts[p.id]||0}議席`).join("　");
  document.querySelector("#mapTitle").textContent = document.querySelector("#electionTitle").value;
}

document.querySelector("#sampleBtn").addEventListener("click", loadSample);
document.querySelector("#electionTitle").addEventListener("input", updateFooter);
document.querySelector("#idField").addEventListener("change", render);

document.querySelector("#geojsonInput").addEventListener("change", async e=>{
  const file=e.target.files[0];
  if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    if(data.type!=="FeatureCollection") throw new Error("FeatureCollectionではありません");
    geoData=data;
    results={};
    data.features.forEach((f,i)=>results[getId(f)] = parties[i%parties.length].id);
    document.querySelector("#status").textContent=`${file.name} を読み込みました`;
    render();
  }catch(err){
    alert("GeoJSONの読み込みに失敗しました: "+err.message);
  }
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
  a.href=URL.createObjectURL(blob);
  a.download="election-result-map.svg";
  a.click();
  URL.revokeObjectURL(a.href);
});

(async()=>{ await loadParties(); await loadSample(); })();
