const SUPABASE_URL="https://movapecdjjddkvavyprt.supabase.co";
const SUPABASE_KEY="sb_publishable_zdjYToMI0h51qYx179V2cQ_wJJoRt5k";
const CAD_INGEST_URL=`${SUPABASE_URL}/functions/v1/atlas-cad-ingest`;
const SESSION_KEY="atlas_cad_pwa_session_v1";
const ACTIVE_CASE_KEY="atlas_cad_active_case_v1";
const THEME_KEY="atlas_cad_theme_v1";
const MAPBOX_CONFIG_URL="/.netlify/functions/mapbox-config";
let session=null,activeCase=null,mapboxToken=null,routeMap=null,userMarker=null,destinationMarker=null;

const $=id=>document.getElementById(id);
const views=["loginView","dashboardView","newCaseView","responseView"];
const show=id=>views.forEach(v=>$(v).classList.toggle("hidden",v!==id));

init();
async function init(){
  document.body.dataset.theme=localStorage.getItem(THEME_KEY)||"dark";
  $("themeToggle").textContent=document.body.dataset.theme==="dark"?"☾":"☀";
  $("themeToggle").onclick=toggleTheme;
  $("loginBtn").onclick=login;
  $("newCaseBtn").onclick=()=>show("newCaseView");
  $("refreshBtn").onclick=loadDashboard;
  $("createCaseBtn").onclick=createCase;
  document.querySelectorAll("[data-back]").forEach(b=>b.onclick=()=>{localStorage.removeItem(ACTIVE_CASE_KEY);loadDashboard();});
  document.querySelectorAll("[data-stamp]").forEach(b=>b.onclick=()=>stamp(b.dataset.stamp,b));
  $("navigateBtn").onclick=navigateGoogle;
  $("googleMapsBtn").onclick=navigateGoogle;
  $("wazeBtn").onclick=navigateWaze;
  try{mapboxToken=await loadMapboxToken();}catch{}
  try{session=await restoreSession();}catch{}
  if(!session){show("loginView");return;}
  try{
    const saved=JSON.parse(localStorage.getItem(ACTIVE_CASE_KEY)||"null");
    if(saved?.case_id){activeCase=saved;await openResponse(saved);return;}
  }catch{}
  await loadDashboard();
  if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});
}

function toggleTheme(){
  const next=document.body.dataset.theme==="dark"?"light":"dark";
  document.body.dataset.theme=next;
  localStorage.setItem(THEME_KEY,next);
  $("themeToggle").textContent=next==="dark"?"☾":"☀";
}

async function login(){
  const email=$("email").value.trim(),password=$("password").value;
  if(!email||!password)return setStatus("loginStatus","Email and password are required.");
  try{
    setStatus("loginStatus","Signing in…");
    const r=await postJson(`${SUPABASE_URL}/auth/v1/token?grant_type=password`,{email,password});
    session=normalizeSession(r);
    localStorage.setItem(SESSION_KEY,JSON.stringify(session));
    $("password").value="";
    await loadDashboard();
  }catch(e){setStatus("loginStatus",e.message);}
}

async function restoreSession(){
  let s=JSON.parse(localStorage.getItem(SESSION_KEY)||"null");
  if(!s?.refresh_token)return null;
  if(Date.now()<Number(s.expires_at||0)-60000)return s;
  try{
    const r=await postJson(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,{refresh_token:s.refresh_token});
    s=normalizeSession(r);
    localStorage.setItem(SESSION_KEY,JSON.stringify(s));
    return s;
  }catch{
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function normalizeSession(r){
  if(!r?.access_token||!r?.refresh_token)throw new Error("ATLAS sign in failed.");
  return{access_token:r.access_token,refresh_token:r.refresh_token,user:r.user,expires_at:Date.now()+Number(r.expires_in||3600)*1000};
}

async function loadDashboard(){
  try{
    session=await restoreSession()||session;
    if(!session){show("loginView");return;}
    const items=await getOpenResponses();
    $("responseCount").textContent=items.length;
    $("responsesList").innerHTML=items.length?"":"<div class='muted'>No open scene responses.</div>";
    items.forEach(item=>{
      const b=document.createElement("button");
      b.className="response-card";
      b.innerHTML=`<strong>${esc(item.case_number)}</strong><span>${esc(item.stage)}</span><span>${esc(buildAddress(item)||"Location pending")}</span>`;
      b.onclick=()=>openResponse(item);
      $("responsesList").appendChild(b);
    });
    show("dashboardView");
  }catch(e){show("loginView");setStatus("loginStatus",e.message);}
}

async function createCase(){
  const address=$("sceneAddress").value.trim();
  if(!address)return setStatus("createStatus","Scene address or location is required.");
  try{
    setStatus("createStatus","Creating response…");
    session=await restoreSession()||session;
    const now=new Date();
    const body={
      action:"create_case",
      source:"occo_cad_pwa",
      external_event_id:`pwa-create-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      decedent_name:"CAD Generated",
      case_category:"investigative",
      record_class:$("recordClass").value,
      fields:{
        notification_date:localDate(now),
        notification_time:localTime(now),
        reported_circumstances:"Pending scene update",
        intake_decision:"pending_review",
        dispatch_location_description:address,
        investigation_pathway:"unknown_other",
        pathway_subtype:"Pending Investigation",
        pathway_considerations:[]
      }
    };
    const r=await postJson(CAD_INGEST_URL,body,session.access_token);
    const item={case_id:r.case_id,case_number:r.case_number,dispatch_location_description:address,stage:"Pending Response"};
    $("sceneAddress").value="";
    await openResponse(item);
  }catch(e){setStatus("createStatus",e.message);}
}

async function openResponse(item){
  activeCase=item;
  localStorage.setItem(ACTIVE_CASE_KEY,JSON.stringify(item));
  $("responseCaseNumber").textContent=item.case_number||"ATLAS Case";
  $("responseAddress").textContent=buildAddress(item)||"Location pending";
  updateStage(item);
  resetStampButtons();
  applySavedStamp("responding_at",item.responding_time);
  applySavedStamp("on_scene_at",item.on_scene_time);
  show("responseView");
  setTimeout(()=>prepareRoute(item),50);
}

async function prepareRoute(item){
  const destination=buildAddress(item);
  $("routeEta").textContent="--";
  $("nextManeuver").classList.add("hidden");
  if(!destination){
    $("routeHeadline").textContent="Scene location missing";
    $("routeDetail").textContent="Add or correct the scene address in ATLAS.";
    return;
  }
  if(!mapboxToken){
    try{mapboxToken=await loadMapboxToken();}catch{}
  }
  if(!mapboxToken||typeof mapboxgl==="undefined"){
    $("routeHeadline").textContent="Mapbox unavailable";
    $("routeDetail").textContent="Google Maps and Waze remain available below.";
    return;
  }
  try{
    $("routeHeadline").textContent="Locating scene…";
    $("routeDetail").textContent=destination;
    const dest=await geocodeAddress(destination);
    if(!dest)throw new Error("Scene address could not be located.");
    const origin=await currentPosition();
    await renderRoute(origin,dest,destination);
  }catch(e){
    $("routeHeadline").textContent="Route unavailable";
    $("routeDetail").textContent=e.message||"Use Google Maps or Waze below.";
  }
}

async function loadMapboxToken(){
  const r=await fetch(MAPBOX_CONFIG_URL,{cache:"no-store"});
  const d=await r.json().catch(()=>({}));
  if(!r.ok||!d.token)throw new Error(d.error||"Mapbox configuration unavailable.");
  return d.token;
}

async function geocodeAddress(address){
  const url=`https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(address)}&limit=1&country=US&access_token=${encodeURIComponent(mapboxToken)}`;
  const r=await fetch(url);
  const d=await r.json();
  if(!r.ok)throw new Error(d.message||"Unable to locate scene address.");
  const feature=d.features?.[0];
  if(!feature?.geometry?.coordinates)return null;
  return feature.geometry.coordinates;
}

function currentPosition(){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation)return reject(new Error("Location services are not available on this device."));
    navigator.geolocation.getCurrentPosition(
      p=>resolve([p.coords.longitude,p.coords.latitude]),
      ()=>reject(new Error("Allow location access to build the live route.")),
      {enableHighAccuracy:true,timeout:12000,maximumAge:15000}
    );
  });
}

async function renderRoute(origin,dest,destinationLabel){
  mapboxgl.accessToken=mapboxToken;
  if(routeMap){routeMap.remove();routeMap=null;}
  routeMap=new mapboxgl.Map({container:"map",style:"mapbox://styles/mapbox/standard",center:origin,zoom:12,attributionControl:true});
  routeMap.addControl(new mapboxgl.NavigationControl({showCompass:false}),"top-right");
  const directionsUrl=`https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${origin[0]},${origin[1]};${dest[0]},${dest[1]}?alternatives=false&geometries=geojson&overview=full&steps=true&access_token=${encodeURIComponent(mapboxToken)}`;
  const r=await fetch(directionsUrl);
  const d=await r.json();
  if(!r.ok||!d.routes?.length)throw new Error(d.message||"No driving route was found.");
  const route=d.routes[0];
  const minutes=Math.max(1,Math.round(route.duration/60));
  const miles=route.distance/1609.344;
  const arrival=new Date(Date.now()+route.duration*1000);
  $("routeHeadline").textContent=`${minutes} min · ${miles.toFixed(miles<10?1:0)} mi`;
  $("routeDetail").textContent=`Estimated arrival ${formatClock(arrival)} · ${destinationLabel}`;
  $("routeEta").textContent=formatClock(arrival);
  const steps=route.legs?.[0]?.steps||[];
  const maneuver=steps.find(s=>s?.maneuver?.instruction&&s.distance>20)||steps[0];
  if(maneuver?.maneuver?.instruction){
    $("nextManeuver").innerHTML=`${esc(maneuver.maneuver.instruction)}<small>${maneuver.distance>160?`${(maneuver.distance/1609.344).toFixed(1)} mi`:Math.round(maneuver.distance*3.28084)+" ft"}</small>`;
    $("nextManeuver").classList.remove("hidden");
  }
  await new Promise(resolve=>routeMap.on("load",resolve));
  routeMap.addSource("atlas-route",{type:"geojson",data:{type:"Feature",properties:{},geometry:route.geometry}});
  routeMap.addLayer({id:"atlas-route-line",type:"line",source:"atlas-route",layout:{"line-join":"round","line-cap":"round"},paint:{"line-color":"#e8b832","line-width":6,"line-opacity":0.92}});
  userMarker=new mapboxgl.Marker({color:"#2d7ff9"}).setLngLat(origin).addTo(routeMap);
  destinationMarker=new mapboxgl.Marker({color:"#e8b832"}).setLngLat(dest).addTo(routeMap);
  const bounds=new mapboxgl.LngLatBounds();
  route.geometry.coordinates.forEach(c=>bounds.extend(c));
  routeMap.fitBounds(bounds,{padding:48,maxZoom:15,duration:500});
}

function resetStampButtons(){
  document.querySelectorAll("[data-stamp]").forEach(b=>{
    b.classList.remove("done");
    const field=b.dataset.stamp;
    b.innerHTML=stampLabel(field);
  });
}

function applySavedStamp(field,value){
  if(!value)return;
  const b=document.querySelector(`[data-stamp="${field}"]`);
  if(!b)return;
  b.classList.add("done");
  b.innerHTML=`${stampLabel(field)}<small>${formatClock(value)}</small>`;
}

function stampLabel(field){
  return({responding_at:"Responding / En Route",on_scene_at:"On Scene",cleared_at:"Cleared Scene",response_cancelled_at:"Response Cancelled"})[field]||field;
}

async function stamp(field,button){
  if(!activeCase?.case_id)return;
  try{
    setStatus("responseStatus","Saving…");
    session=await restoreSession()||session;
    const now=new Date();
    const iso=now.toISOString();
    const fields={[field]:iso};
    if(field==="responding_at"||field==="on_scene_at")fields.scene_response_required=true;
    await postJson(CAD_INGEST_URL,{source:"occo_cad_pwa",external_event_id:`response-${activeCase.case_id}-${field}-${Date.now()}`,case_id:activeCase.case_id,event_type:"response_timestamp",fields},session.access_token);
    button.classList.add("done");
    button.innerHTML=`${stampLabel(field)}<small>${formatClock(iso)}</small>`;
    if(field==="responding_at"){activeCase.responding_time=iso;activeCase.stage="Responding / En Route";}
    if(field==="on_scene_at"){activeCase.on_scene_time=iso;activeCase.stage="On Scene";}
    localStorage.setItem(ACTIVE_CASE_KEY,JSON.stringify(activeCase));
    updateStage(activeCase);
    setStatus("responseStatus","Saved to ATLAS.");
    if(field==="cleared_at"||field==="response_cancelled_at"){
      localStorage.removeItem(ACTIVE_CASE_KEY);
      setTimeout(loadDashboard,700);
    }
  }catch(e){setStatus("responseStatus",e.message);}
}

function updateStage(item){
  $("responseStage").textContent=item?.on_scene_time?"ON SCENE":item?.responding_time?"EN ROUTE":"PENDING";
}

function navigationDestination(){return buildAddress(activeCase)||"";}
function navigateGoogle(){
  const destination=navigationDestination();
  if(!destination)return setStatus("responseStatus","Scene location is missing.");
  const q=encodeURIComponent(destination);
  window.location.href=`https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving&dir_action=navigate`;
}
function navigateWaze(){
  const destination=navigationDestination();
  if(!destination)return setStatus("responseStatus","Scene location is missing.");
  window.location.href=`https://www.waze.com/ul?q=${encodeURIComponent(destination)}&navigate=yes`;
}

async function getOpenResponses(){
  const uid=session?.user?.id;
  if(!uid)return[];
  const cases=await getJson(`${SUPABASE_URL}/rest/v1/cases?lead_investigator_id=eq.${uid}&status=eq.open&select=id,case_number,created_at&order=created_at.desc&limit=20`,session.access_token);
  if(!cases?.length)return[];
  const ids=`(${cases.map(x=>x.id).join(",")})`;
  const notes=await getJson(`${SUPABASE_URL}/rest/v1/case_notification?case_id=in.${encodeURIComponent(ids)}&select=case_id,dispatch_location_description,dispatch_street_address,dispatch_unit,dispatch_city,dispatch_state,dispatch_zip,scene_response_required,responding_time,on_scene_time,cleared_time,response_cancelled_time`,session.access_token);
  const map=new Map((notes||[]).map(n=>[n.case_id,n]));
  const cutoff=Date.now()-48*3600000;
  return cases.map(c=>({...c,...(map.get(c.id)||{}),case_id:c.id}))
    .filter(x=>!x.cleared_time&&!x.response_cancelled_time)
    .filter(x=>x.responding_time||x.on_scene_time||x.scene_response_required===true||new Date(x.created_at).getTime()>=cutoff)
    .map(x=>({...x,stage:x.on_scene_time?"On Scene":x.responding_time?"Responding / En Route":"Pending Response"}));
}

async function postJson(url,body,token=null){
  const h={apikey:SUPABASE_KEY,"Content-Type":"application/json"};
  if(token)h.Authorization=`Bearer ${token}`;
  const r=await fetch(url,{method:"POST",headers:h,body:JSON.stringify(body)});
  const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{}
  if(!r.ok)throw new Error(d?.error||d?.message||t||`Request failed (${r.status})`);return d;
}
async function getJson(url,token){
  const r=await fetch(url,{headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${token}`}});
  const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{}
  if(!r.ok)throw new Error(d?.message||t||`Request failed (${r.status})`);return d;
}
function buildAddress(x){return [x?.dispatch_location_description,x?.dispatch_street_address,x?.dispatch_unit,x?.dispatch_city,x?.dispatch_state,x?.dispatch_zip].filter(Boolean).join(", ");}
function setStatus(id,msg){$(id).textContent=msg||"";}
function esc(v){return String(v||"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));}
function localDate(d){return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function localTime(d){return`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;}
function formatClock(v){try{return new Date(v).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});}catch{return"";}}
