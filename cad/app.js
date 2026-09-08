const SUPABASE_URL="https://movapecdjjddkvavyprt.supabase.co";
const SUPABASE_KEY="sb_publishable_zdjYToMI0h51qYx179V2cQ_wJJoRt5k";
const CAD_INGEST_URL=`${SUPABASE_URL}/functions/v1/atlas-cad-ingest`;
const SESSION_KEY="atlas_cad_pwa_session_v1";
const ACTIVE_CASE_KEY="atlas_cad_active_case_v1";
const THEME_KEY="atlas_cad_theme_v1";
let session=null,activeCase=null;

const $=id=>document.getElementById(id);
const views=["loginView","dashboardView","newCaseView","responseView"];
const show=id=>{views.forEach(v=>$(v).classList.toggle("hidden",v!==id));};

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
  $("navigateBtn").onclick=navigate;
  $("zipCode").addEventListener("change",zipLookup);
  $("facility").addEventListener("input",loadLocationSuggestions);
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
  document.body.dataset.theme=next;localStorage.setItem(THEME_KEY,next);$("themeToggle").textContent=next==="dark"?"☾":"☀";
}

async function login(){
  const email=$("email").value.trim(),password=$("password").value;
  if(!email||!password)return setStatus("loginStatus","Email and password are required.");
  try{
    setStatus("loginStatus","Signing in…");
    const r=await postJson(`${SUPABASE_URL}/auth/v1/token?grant_type=password`,{email,password});
    session=normalizeSession(r);localStorage.setItem(SESSION_KEY,JSON.stringify(session));
    $("password").value="";await loadDashboard();
  }catch(e){setStatus("loginStatus",e.message);}
}

async function restoreSession(){
  let s=JSON.parse(localStorage.getItem(SESSION_KEY)||"null");
  if(!s?.refresh_token)return null;
  if(Date.now()<Number(s.expires_at||0)-60000)return s;
  try{
    const r=await postJson(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,{refresh_token:s.refresh_token});
    s=normalizeSession(r);localStorage.setItem(SESSION_KEY,JSON.stringify(s));return s;
  }catch{localStorage.removeItem(SESSION_KEY);return null;}
}
function normalizeSession(r){if(!r?.access_token||!r?.refresh_token)throw new Error("ATLAS sign in failed.");return{access_token:r.access_token,refresh_token:r.refresh_token,user:r.user,expires_at:Date.now()+Number(r.expires_in||3600)*1000};}

async function loadDashboard(){
  try{
    session=await restoreSession()||session;if(!session){show("loginView");return;}
    const items=await getOpenResponses();
    $("responseCount").textContent=items.length;
    $("responsesList").innerHTML=items.length?"":"<div class='muted'>No open scene responses.</div>";
    items.forEach(item=>{
      const b=document.createElement("button");b.className="response-card";
      b.innerHTML=`<strong>${esc(item.case_number)}</strong><span>${esc(item.stage)}</span><span>${esc(buildAddress(item)||"Location pending")}</span>`;
      b.onclick=()=>openResponse(item);$("responsesList").appendChild(b);
    });
    show("dashboardView");
  }catch(e){show("loginView");setStatus("loginStatus",e.message);}
}

async function createCase(){
  const decedent=$("caseIdentifier").value.trim();
  if(!decedent)return setStatus("createStatus","Decedent / Identifier is required.");
  try{
    setStatus("createStatus","Creating case…");session=await restoreSession()||session;
    const now=new Date();
    const body={action:"create_case",source:"occo_cad_pwa",external_event_id:`pwa-create-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,decedent_name:decedent,case_category:"investigative",record_class:$("recordClass").value,fields:{notification_date:localDate(now),notification_time:localTime(now),contacting_agency:$("reportingAgency").value.trim()||null,reporting_person:$("briefingPerson").value.trim()||null,callback_number:$("callbackNumber").value.trim()||null,reported_circumstances:"Pending scene update",intake_decision:"pending_review",dispatch_location_description:$("facility").value.trim()||null,dispatch_street_address:$("street").value.trim()||null,dispatch_city:$("city").value.trim()||null,dispatch_state:$("state").value.trim()||"OH",dispatch_zip:$("zipCode").value.trim()||null,investigation_pathway:"unknown_other",pathway_subtype:"Pending Investigation",pathway_considerations:[]}};
    const r=await postJson(CAD_INGEST_URL,body,session.access_token);
    const item={case_id:r.case_id,case_number:r.case_number,dispatch_location_description:$("facility").value.trim(),dispatch_street_address:$("street").value.trim(),dispatch_city:$("city").value.trim(),dispatch_state:$("state").value.trim(),dispatch_zip:$("zipCode").value.trim(),stage:"Pending Response"};
    await openResponse(item);
  }catch(e){setStatus("createStatus",e.message);}
}

async function openResponse(item){
  activeCase=item;localStorage.setItem(ACTIVE_CASE_KEY,JSON.stringify(item));
  $("responseCaseNumber").textContent=item.case_number||"ATLAS Case";
  $("responseAddress").textContent=buildAddress(item)||"Location pending";
  const q=encodeURIComponent(buildAddress(item)||item.case_number||"Ottawa County Ohio");
  $("mapFrame").src=`https://www.google.com/maps?q=${q}&output=embed`;
  document.querySelectorAll("[data-stamp]").forEach(b=>b.classList.remove("done"));
  if(item.responding_time)document.querySelector('[data-stamp="responding_at"]').classList.add("done");
  if(item.on_scene_time)document.querySelector('[data-stamp="on_scene_at"]').classList.add("done");
  if(item.funeral_home_arrival_time)document.querySelector('[data-stamp="funeral_home_arrived_at"]').classList.add("done");
  show("responseView");
}

async function stamp(field,button){
  if(!activeCase?.case_id)return;
  try{
    setStatus("responseStatus","Saving…");session=await restoreSession()||session;
    const fields={[field]:new Date().toISOString()};if(field==="responding_at"||field==="on_scene_at")fields.scene_response_required=true;
    const r=await postJson(CAD_INGEST_URL,{source:"occo_cad_pwa",external_event_id:`response-${activeCase.case_id}-${field}-${Date.now()}`,case_id:activeCase.case_id,event_type:"response_timestamp",fields},session.access_token);
    button.classList.add("done");setStatus("responseStatus","Saved to ATLAS.");
    if(field==="cleared_at"||field==="response_cancelled_at"){localStorage.removeItem(ACTIVE_CASE_KEY);setTimeout(loadDashboard,700);}
  }catch(e){setStatus("responseStatus",e.message);}
}

function navigate(){
  if(!activeCase)return;const q=encodeURIComponent(buildAddress(activeCase)||"");
  window.location.href=`https://www.google.com/maps/dir/?api=1&destination=${q}&travelmode=driving`;
}

async function zipLookup(){
  const zip=$("zipCode").value.trim();if(!/^\d{5}$/.test(zip))return;
  try{const d=await fetch(`https://api.zippopotam.us/us/${encodeURIComponent(zip)}`).then(r=>r.json());const p=d?.places?.[0];if(p){$("city").value=p["place name"]||"";$("state").value=p["state abbreviation"]||"OH";}}catch{}
}

let locTimer=null;
function loadLocationSuggestions(){clearTimeout(locTimer);locTimer=setTimeout(async()=>{
  const q=$("facility").value.trim();if(q.length<2||!session)return;
  try{
    const rows=await getJson(`${SUPABASE_URL}/rest/v1/agency_reference_directory?active=eq.true&name=ilike.*${encodeURIComponent(q)}*&select=name,street_address,city,state,zip,directory_type&order=sort_order.asc,name.asc&limit=8`,session.access_token);
    const dl=$("locationSuggestions");dl.innerHTML="";(rows||[]).filter(x=>x.street_address).forEach(x=>{const o=document.createElement("option");o.value=x.name;o.dataset.street=x.street_address||"";o.dataset.city=x.city||"";o.dataset.state=x.state||"";o.dataset.zip=x.zip||"";dl.appendChild(o);});
  }catch{}
},220);}
$("facility").addEventListener("change",()=>{const v=$("facility").value;const o=[...$("locationSuggestions").options].find(x=>x.value===v);if(o){$("street").value=o.dataset.street||"";$("city").value=o.dataset.city||"";$("state").value=o.dataset.state||"OH";$("zipCode").value=o.dataset.zip||$("zipCode").value;}});

async function getOpenResponses(){
  const uid=session?.user?.id;if(!uid)return[];
  const cases=await getJson(`${SUPABASE_URL}/rest/v1/cases?lead_investigator_id=eq.${uid}&status=eq.open&select=id,case_number,created_at&order=created_at.desc&limit=20`,session.access_token);
  if(!cases?.length)return[];
  const ids=`(${cases.map(x=>x.id).join(",")})`;
  const notes=await getJson(`${SUPABASE_URL}/rest/v1/case_notification?case_id=in.${encodeURIComponent(ids)}&select=case_id,dispatch_location_description,dispatch_street_address,dispatch_unit,dispatch_city,dispatch_state,dispatch_zip,scene_response_required,responding_time,on_scene_time,funeral_home_arrival_time,cleared_time,response_cancelled_time`,session.access_token);
  const map=new Map((notes||[]).map(n=>[n.case_id,n]));
  const cutoff=Date.now()-48*3600000;
  return cases.map(c=>({...c,...(map.get(c.id)||{}),case_id:c.id})).filter(x=>!x.cleared_time&&!x.response_cancelled_time).filter(x=>x.responding_time||x.on_scene_time||x.funeral_home_arrival_time||x.scene_response_required===true||new Date(x.created_at).getTime()>=cutoff).map(x=>({...x,stage:x.on_scene_time?"On Scene":x.responding_time?"Responding / En Route":x.funeral_home_arrival_time?"Funeral Home Arrived":"Pending Response"}));
}

async function postJson(url,body,token=null){const h={apikey:SUPABASE_KEY,"Content-Type":"application/json"};if(token)h.Authorization=`Bearer ${token}`;const r=await fetch(url,{method:"POST",headers:h,body:JSON.stringify(body)});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{}if(!r.ok)throw new Error(d?.error||d?.message||t||`Request failed (${r.status})`);return d;}
async function getJson(url,token){const r=await fetch(url,{headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${token}`}});const t=await r.text();let d=null;try{d=t?JSON.parse(t):null}catch{}if(!r.ok)throw new Error(d?.message||t||`Request failed (${r.status})`);return d;}
function buildAddress(x){return [x.dispatch_location_description,x.dispatch_street_address,x.dispatch_unit,x.dispatch_city,x.dispatch_state,x.dispatch_zip].filter(Boolean).join(", ");}
function setStatus(id,msg){$(id).textContent=msg||"";}
function esc(v){return String(v||"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));}
function localDate(d){return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function localTime(d){return`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;}
