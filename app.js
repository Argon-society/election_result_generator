const svg=d3.select("#map"), W=1200,H=820;
const root=svg.append("g"), mapLayer=root.append("g"), ballLayer=root.append("g"), textLayer=root.append("g"), deco=root.append("g");
let geoData=null, parties=[], results={}, currentMode="votes", selectedId=null;
let projection,path;
const zoom=d3.zoom().scaleExtent([.7,8]).on("zoom",e=>root.attr("transform",e.transform));
svg.call(zoom);

const sampleVotes={
 "OK-1":{A:52000,B:43000,C:12000,D:7000},"OK-2":{A:18000,B:51000,C:31000,D:9000},
 "OK-3":{A:21000,B:18000,C:47000,D:11000},"OK-4":{A:56000,B:24000,C:13000,D:8000},
 "OK-5":{A:30000,B:45000,C:22000,D:6000}
};

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const system=()=>$("#system").value;
const seatCount=()=>system()==="smd"?1:Math.max(1,+$("#seatCount").value||1);
const party=id=>parties.find(p=>p.id===id)||parties[0];
const mode=()=>currentMode;

function idOf(f){
 const field=$("#idField").value;
 if(field==="id")return f.id;
 if(field==="name")return f.properties?.name;
 if(field==="code")return f.properties?.code;
 return f.id??f.properties?.id??f.properties?.code??f.properties?.name;
}
function ensure(id){
 if(!results[id])results[id]={votes:{},winners:[]};
 parties.forEach(p=>{if(results[id].votes[p.id]==null)results[id].votes[p.id]=0});
 return results[id];
}
function notify(msg){const t=$("#toast");t.textContent=msg;t.classList.add("show");clearTimeout(notify.timer);notify.timer=setTimeout(()=>t.classList.remove("show"),2200)}

async function init(){
 parties=await fetch("data/parties.json").then(r=>r.json()).then(x=>x.parties);
 await loadSample();
}
async function loadSample(){
 geoData=await fetch("data/okayama-sample.geojson").then(r=>r.json());
 results={};
 geoData.features.forEach(f=>{const id=idOf(f);results[id]={votes:{...(sampleVotes[id]||{})},winners:[]}});
 recalcAll();$("#dataStatus").textContent="岡山県サンプルを読み込み済み";renderAll();
}
function recalc(id){
 const r=ensure(id);if(mode()!=="votes")return;
 const entries=parties.map(p=>({id:p.id,v:+r.votes[p.id]||0}));
 const n=seatCount();
 if(system()==="smd")r.winners=entries.sort((a,b)=>b.v-a.v).slice(0,1).map(x=>x.id);
 else if(system()==="mmd")r.winners=entries.sort((a,b)=>b.v-a.v).slice(0,n).map(x=>x.id);
 else{
   const divs=$("#allocationMethod").value==="sainte-lague"?[1,3,5,7,9,11,13,15,17,19,21,23,25,27,29,31,33,35,37,39,41,43,45,47,49]:Array.from({length:n},(_,i)=>i+1);
   const q=[];entries.forEach(p=>divs.slice(0,n).forEach(d=>q.push({id:p.id,q:p.v/d})));
   q.sort((a,b)=>b.q-a.q||a.id.localeCompare(b.id));r.winners=q.slice(0,n).map(x=>x.id);
 }
}
function recalcAll(){Object.keys(results).forEach(recalc)}

function renderControls(){
 const list=$("#districtList"), n=seatCount();
 list.innerHTML=geoData.features.map((f,i)=>{
   const id=idOf(f),r=ensure(id),name=f.properties?.name||id||`選挙区${i+1}`;
   if(mode()==="votes")return `<div class="district-card"><div class="district-head"><span class="district-name">${name}</span><span class="district-meta">${n}議席</span></div><div class="vote-grid">${parties.map(p=>`<label class="vote-party"><i class="vote-dot" style="background:${p.color}"></i>${p.shortName}<input class="vote-input" data-id="${id}" data-party="${p.id}" type="number" min="0" step="1" value="${r.votes[p.id]||0}"></label>`).join("")}</div></div>`;
   return `<div class="district-card"><div class="district-head"><span class="district-name">${name}</span><span class="district-meta">${n}議席</span></div><div class="winner-grid">${Array.from({length:n},(_,s)=>`<div class="winner-row"><span>${s+1}位</span><select class="winner-input" data-id="${id}" data-seat="${s}">${parties.map(p=>`<option value="${p.id}" ${r.winners[s]===p.id?"selected":""}>${p.shortName}</option>`).join("")}</select></div>`).join("")}</div></div>`;
 }).join("");
 $$(".vote-input").forEach(x=>x.addEventListener("input",e=>{ensure(e.target.dataset.id).votes[e.target.dataset.party]=Math.max(0,+e.target.value||0);recalc(e.target.dataset.id);renderMap()}));
 $$(".winner-input").forEach(x=>x.addEventListener("change",e=>{ensure(e.target.dataset.id).winners[+e.target.dataset.seat]=e.target.value;renderMap()}));
}
function renderPartyLegend(){
 const counts={};Object.values(results).forEach(r=>(r.winners||[]).forEach(x=>counts[x]=(counts[x]||0)+1));
 $("#partyLegend").innerHTML=parties.map(p=>`<div class="party-row"><i class="swatch" style="background:${p.color}"></i><span>${p.name}</span><span class="party-seat">${counts[p.id]||0}議席</span></div>`).join("");
}
function subtitle(){
 if(system()==="smd")return"小選挙区制・最多得票";
 if(system()==="mmd")return`複数人区・上位${seatCount()}名`;
 return`比例代表・${$("#allocationMethod").value==="dhondt"?"D'Hondt":"Sainte-Laguë"}・${seatCount()}議席`;
}
function renderMap(){
 if(!geoData)return;
 projection=d3.geoIdentity().reflectY(true).fitExtent([[105,105],[1095,690]],geoData);
 path=d3.geoPath(projection);
 [mapLayer,ballLayer,textLayer,deco].forEach(x=>x.selectAll("*").remove());
 deco.append("text").attr("class","map-heading").attr("x",105).attr("y",48).text($("#electionTitle").value);
 deco.append("text").attr("class","map-subheading").attr("x",105).attr("y",68).text(subtitle()+"  •  ELECTION MAP STUDIO");
 const feats=geoData.features;
 mapLayer.selectAll("path").data(feats).join("path").attr("class",d=>"district"+(idOf(d)===selectedId?" selected":"")).attr("d",path)
 .attr("fill",d=>party(ensure(idOf(d)).winners[0])?.color||"#d7dce3")
 .on("click",(e,d)=>{selectedId=idOf(d);renderMap();highlightControl(selectedId)});
 const info=feats.map(f=>{const id=idOf(f),r=ensure(id),c=path.centroid(f);return{id,x:c[0],y:c[1],name:f.properties?.name||id,w:r.winners||[],votes:r.votes}});
 if($("#showLabels").checked)textLayer.selectAll(".district-label").data(info).join("text").attr("class","district-label").attr("x",d=>d.x).attr("y",d=>d.y-8).text(d=>d.name);
 if(system()==="smd"){
   textLayer.selectAll(".district-winner").data(info).join("text").attr("class","district-winner").attr("x",d=>d.x).attr("y",d=>d.y+13).text(d=>party(d.w[0])?.shortName||"");
   if($("#showVoteShare").checked)textLayer.selectAll(".district-share").data(info).join("text").attr("class","district-share").attr("x",d=>d.x).attr("y",d=>d.y+27).text(d=>shareText(d));
 }else if($("#showBalls").checked){
   const balls=[];info.forEach(d=>{const r=8,gap=20,total=(d.w.length-1)*gap;d.w.forEach((pid,i)=>balls.push({x:d.x-total/2+i*gap,y:d.y+19,pid,seat:i+1}))});
   ballLayer.selectAll(".seat-ball").data(balls).join("circle").attr("class","seat-ball").attr("cx",d=>d.x).attr("cy",d=>d.y).attr("r",8).attr("fill",d=>party(d.pid)?.color||"#999");
   ballLayer.selectAll(".seat-ball-label").data(balls).join("text").attr("class","seat-ball-label").attr("x",d=>d.x).attr("y",d=>d.y+.5).text(d=>d.seat);
   if($("#showVoteShare").checked)textLayer.selectAll(".district-share").data(info).join("text").attr("class","district-share").attr("x",d=>d.x).attr("y",d=>d.y+35).text(d=>shareText(d));
 }
 updateSummary();
}
function shareText(d){
 const total=Object.values(d.votes).reduce((a,b)=>a+(+b||0),0);if(!total)return"";
 const win=d.w[0],v=+d.votes[win]||0;return `${party(win)?.shortName||""} ${((v/total)*100).toFixed(1)}%`;
}
function updateSummary(){
 const counts={};Object.values(results).forEach(r=>(r.winners||[]).forEach(id=>counts[id]=(counts[id]||0)+1));
 $("#mapTitle").textContent=$("#electionTitle").value;$("#mapSubtitle").textContent=subtitle();
 $("#seatSummary").textContent=parties.map(p=>`${p.shortName} ${counts[p.id]||0}`).join("　");
 renderPartyLegend();
}
function highlightControl(id){const cards=[...$("#districtList").children],idx=geoData.features.findIndex(f=>idOf(f)===id);cards.forEach((c,i)=>c.style.outline=i===idx?"2px solid #9eb7d2":"")}
function renderAll(){renderControls();renderPartyLegend();renderMap();updateSummary()}

$$(".segmented button").forEach(b=>b.addEventListener("click",()=>{$$(".segmented button").forEach(x=>x.classList.remove("active"));b.classList.add("active");currentMode=b.dataset.mode;recalcAll();renderAll()}));
["system","seatCount","allocationMethod","idField"].forEach(id=>$( "#"+id).addEventListener("change",()=>{if(system()==="smd")$("#seatCount").value=1;else if(+$("#seatCount").value<2)$("#seatCount").value=2;recalcAll();renderAll()}));
["showLabels","showBalls","showVoteShare","electionTitle"].forEach(id=>$("#"+id).addEventListener(id==="electionTitle"?"input":"change",renderMap));
$("#loadSampleBtn").addEventListener("click",loadSample);
$("#zoomIn").addEventListener("click",()=>svg.transition().call(zoom.scaleBy,1.3));
$("#zoomOut").addEventListener("click",()=>svg.transition().call(zoom.scaleBy,.77));
$("#zoomReset").addEventListener("click",()=>svg.transition().call(zoom.transform,d3.zoomIdentity));
$("#fitMap").addEventListener("click",()=>{renderMap();svg.transition().call(zoom.transform,d3.zoomIdentity);notify("地図を最適な表示位置に調整しました")});

function loadGeo(file){
 const reader=new FileReader();reader.onload=()=>{try{const d=JSON.parse(reader.result);if(d.type!=="FeatureCollection")throw Error("FeatureCollectionではありません");geoData=d;results={};d.features.forEach((f,i)=>{const id=idOf(f);results[id]={votes:{},winners:[parties[i%parties.length]?.id].filter(Boolean)};parties.forEach(p=>results[id].votes[p.id]=0)});$("#dataStatus").textContent=`${file.name} を読み込み済み`;recalcAll();renderAll();notify("GeoJSONを読み込みました")}catch(e){notify("GeoJSONの読み込みに失敗しました")}};reader.readAsText(file)}
$("#geojsonInput").addEventListener("change",e=>e.target.files[0]&&loadGeo(e.target.files[0]));
const dz=$("#dropzone");["dragenter","dragover"].forEach(x=>dz.addEventListener(x,e=>{e.preventDefault();dz.style.borderColor="#3978b9"}));["dragleave","drop"].forEach(x=>dz.addEventListener(x,e=>{e.preventDefault();dz.style.borderColor="#aeb9c8"}));dz.addEventListener("drop",e=>{const f=e.dataTransfer.files[0];if(f)loadGeo(f)});

$("#exportSvgBtn").addEventListener("click",()=>{
 const clone=svg.node().cloneNode(true);clone.setAttribute("xmlns","http://www.w3.org/2000/svg");clone.setAttribute("width",W);clone.setAttribute("height",H);
 const cssText=`.district{stroke:#fff;stroke-width:2.2}.district-label{font-size:15px;font-weight:850;text-anchor:middle;fill:#1b2636;paint-order:stroke;stroke:#fff;stroke-width:4px}.district-winner{font-size:10px;font-weight:750;text-anchor:middle;fill:#263142;paint-order:stroke;stroke:#fff;stroke-width:3px}.district-share{font-size:8px;text-anchor:middle;fill:#536173}.seat-ball{stroke:#fff;stroke-width:1.7}.seat-ball-label{font-size:7px;font-weight:900;text-anchor:middle;dominant-baseline:middle;fill:#fff;paint-order:stroke;stroke:#30343a;stroke-width:1px}.map-heading{font-size:27px;font-weight:850;fill:#152033}.map-subheading{font-size:11px;fill:#6c7788}`;
 const st=document.createElementNS("http://www.w3.org/2000/svg","style");st.textContent=cssText;clone.insertBefore(st,clone.firstChild);
 const xml='<?xml version="1.0" encoding="UTF-8"?>\n'+new XMLSerializer().serializeToString(clone);
 const blob=new Blob([xml],{type:"image/svg+xml;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="election-result-map.svg";a.click();setTimeout(()=>URL.revokeObjectURL(url),500);notify("SVGを書き出しました");
});
init().catch(e=>notify("初期データの読み込みに失敗しました"));
