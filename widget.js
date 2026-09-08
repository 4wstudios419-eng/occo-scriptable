const WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=41.5120&longitude=-82.9377&current=temperature_2m,apparent_temperature,weather_code&temperature_unit=fahrenheit";
const BADGE_URL = "https://drive.google.com/uc?export=view&id=19XiusP7KOBAozk2FhaszPZrkK9Ht9H7-";
const SUPABASE_URL = "https://movapecdjjddkvavyprt.supabase.co";
const SUPABASE_KEY = "sb_publishable_zdjYToMI0h51qYx179V2cQ_wJJoRt5k";
const CAD_INGEST_URL = `${SUPABASE_URL}/functions/v1/atlas-cad-ingest`;
const SESSION_KEY = "ATLAS_CAD_WIDGET_SESSION_V1";

const qp = args?.queryParameters || {};
if (!config.runsInWidget && (qp.mode === "cad" || qp.action === "cad")) {
  await cadQuickStart();
  Script.complete();
  return;
}
if (!config.runsInWidget && qp.mode === "responses") {
  await openSceneResponses();
  Script.complete();
  return;
}
if (!config.runsInWidget && qp.mode === "menu") {
  await mainMenu();
  Script.complete();
  return;
}

if (!config.runsInWidget && !config.runsInAccessoryWidget) {
  await mainMenu();
  Script.complete();
  return;
}

await renderWidget();

async function renderWidget() {
  const w = new ListWidget();
  w.url = `scriptable:///run?scriptName=${encodeURIComponent(Script.name())}&mode=menu`;
  w.backgroundColor = new Color("#0a0a0a");
  w.setPadding(10, 12, 10, 12);

  try {
    try {
      const badge = await new Request(BADGE_URL).loadImage();
      const badgeOuter = w.addStack();
      badgeOuter.layoutHorizontally();
      badgeOuter.addSpacer();
      const badgeImg = badgeOuter.addImage(badge);
      badgeImg.imageSize = new Size(48, 48);
      badgeOuter.addSpacer();
      w.addSpacer(2);
    } catch {}

    addHeader(w, "OCCO / ATLAS");
    addSubheader(w, "OPEN SCENE RESPONSES");
    w.addSpacer(6);

    const session = await getWidgetSession();
    if (!session) {
      addStatus(w, "Tap to sign in and start CAD Quick Start.");
    } else {
      const responses = await getOpenSceneResponses(session);
      if (!responses.length) {
        addStatus(w, "No open scene responses");
      } else {
        for (const item of responses.slice(0, 3)) addResponseRow(w, item);
        if (responses.length > 3) {
          const more = w.addText(`+${responses.length - 3} more`);
          more.textColor = Color.gray();
          more.font = Font.systemFont(9);
        }
      }
    }

    const wx = await getWeatherSafe();
    if (wx) {
      w.addSpacer(6);
      addWeather(w, wx.temp, wx.feels, wx.label);
    }

    w.addSpacer();
    addFooter(w, "Tap for CAD / active responses");
  } catch {
    addHeader(w, "OCCO / ATLAS");
    w.addSpacer(8);
    addStatus(w, "Widget unavailable");
  }

  Script.setWidget(w);
  Script.complete();
}

async function mainMenu() {
  const session = await ensureSession();
  const menu = new Alert();
  menu.title = "OCCO / ATLAS";
  menu.message = "Choose an action.";
  menu.addAction("New CAD Case");
  menu.addAction("Open Scene Responses");
  menu.addAction("Open ATLAS");
  if (Keychain.contains(SESSION_KEY)) menu.addDestructiveAction("Sign Out CAD Session");
  menu.addCancelAction("Cancel");
  const choice = await menu.presentSheet();
  if (choice === 0) await cadQuickStart();
  else if (choice === 1) await openSceneResponses(session);
  else if (choice === 2) Safari.open("https://occoops.netlify.app/");
  else if (choice === 3 && Keychain.contains(SESSION_KEY)) {
    Keychain.remove(SESSION_KEY);
    await notify("ATLAS CAD", "Saved CAD session removed.");
  }
}

async function openSceneResponses(existingSession = null) {
  const session = existingSession || await ensureSession();
  const items = await getOpenSceneResponses(session);
  if (!items.length) {
    const a = new Alert();
    a.title = "Open Scene Responses";
    a.message = "No active scene responses were found.";
    a.addAction("OK");
    await a.presentAlert();
    return;
  }

  const picker = new Alert();
  picker.title = "Open Scene Responses";
  picker.message = "Select a case to open the response map and timestamps.";
  for (const item of items) picker.addAction(`${item.case_number} • ${item.stage}`);
  picker.addCancelAction("Cancel");
  const choice = await picker.presentSheet();
  if (choice < 0) return;
  const selected = items[choice];
  await showResponseViewer(session, selected);
}

async function cadQuickStart() {
  try {
    let session = await ensureSession();
    const profile = await getProfile(session);
    if (!profile?.active) throw new Error("Your ATLAS profile is inactive.");

    const first = new Alert();
    first.title = "ATLAS CAD Quick Start";
    first.message = `Signed in as ${profile.display_name || profile.email || "ATLAS user"}`;
    first.addTextField("Decedent / Identifier", "");
    first.addTextField("Reporting Agency / Source", "");
    first.addTextField("Reporting / Briefing Person", "");
    first.addTextField("Callback Number", "");
    first.addTextField("ZIP Code", "");
    first.addAction("Continue");
    first.addCancelAction("Cancel");
    if (await first.presentAlert() < 0) return;

    const decedent = first.textFieldValue(0).trim();
    const agency = first.textFieldValue(1).trim();
    const reportingPerson = first.textFieldValue(2).trim();
    const callback = first.textFieldValue(3).trim();
    const zip = first.textFieldValue(4).trim();
    if (!decedent) throw new Error("Decedent / Identifier is required.");

    const zipData = await lookupZip(zip);
    const second = new Alert();
    second.title = "Dispatch Location";
    second.message = "City and state are filled from ZIP when available.";
    second.addTextField("Facility / Place", "");
    second.addTextField("Street Address", "");
    second.addTextField("Unit / Room", "");
    second.addTextField("City", zipData.city || "");
    second.addTextField("State", zipData.state || "OH");
    second.addAction("Continue");
    second.addCancelAction("Cancel");
    if (await second.presentAlert() < 0) return;

    const facility = second.textFieldValue(0).trim();
    const street = second.textFieldValue(1).trim();
    const unit = second.textFieldValue(2).trim();
    const city = second.textFieldValue(3).trim();
    const state = second.textFieldValue(4).trim();

    const record = new Alert();
    record.title = "Record Type";
    record.message = "Use Test / Training while validating the widget.";
    record.addAction("Official");
    record.addAction("Test / Training");
    record.addCancelAction("Cancel");
    const recordChoice = await record.presentSheet();
    if (recordChoice < 0) return;
    const recordClass = recordChoice === 1 ? "test_training" : "official";

    session = await ensureSession(true);
    const now = new Date();
    const request = {
      action: "create_case",
      source: "occo_scriptable_cad_widget",
      external_event_id: `scriptable-create-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      decedent_name: decedent,
      case_category: "investigative",
      record_class: recordClass,
      fields: {
        notification_date: localDate(now),
        notification_time: localTime(now),
        contacting_agency: agency || null,
        reporting_person: reportingPerson || null,
        callback_number: callback || null,
        reported_circumstances: "Pending scene update",
        intake_decision: "pending_review",
        dispatch_location_description: facility || null,
        dispatch_street_address: street || null,
        dispatch_unit: unit || null,
        dispatch_city: city || null,
        dispatch_state: state || null,
        dispatch_zip: zip || null,
        investigation_pathway: "unknown_other",
        pathway_subtype: "Pending Investigation",
        pathway_considerations: []
      }
    };

    const result = await postJson(CAD_INGEST_URL, request, session.access_token);
    const item = {
      case_id: result.case_id,
      case_number: result.case_number || "ATLAS Case",
      dispatch_location_description: facility,
      dispatch_street_address: street,
      dispatch_unit: unit,
      dispatch_city: city,
      dispatch_state: state,
      dispatch_zip: zip,
      responding_time: null,
      on_scene_time: null,
      funeral_home_arrival_time: null,
      cleared_time: null,
      response_cancelled_time: null,
      stage: "Pending Response"
    };
    await showResponseViewer(session, item);
  } catch (e) {
    const a = new Alert();
    a.title = "CAD Quick Start";
    a.message = String(e?.message || e);
    a.addAction("OK");
    await a.presentAlert();
  }
}

async function showResponseViewer(session, item) {
  const address = buildAddress(item);
  const mapQuery = encodeURIComponent(address || item.case_number || "Ottawa County Ohio");
  const mapUrl = `https://www.google.com/maps?q=${mapQuery}&output=embed`;
  const token = JSON.stringify(session.access_token);
  const key = JSON.stringify(SUPABASE_KEY);
  const endpoint = JSON.stringify(CAD_INGEST_URL);
  const caseId = JSON.stringify(item.case_id);
  const caseNumber = escapeHtml(item.case_number || "ATLAS Case");
  const addressHtml = escapeHtml(address || "Location pending");

  const html = `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
html,body{margin:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0b0b0b;color:#fff}body{display:flex;flex-direction:column}.head{padding:10px 12px;background:#111;border-bottom:1px solid #2a2a2a}.case{font-size:17px;font-weight:800;color:#e8b832}.addr{font-size:12px;color:#c8c8c8;margin-top:2px}.map{flex:1;min-height:300px}.map iframe{width:100%;height:100%;border:0}.panel{background:#111;padding:10px;border-top:1px solid #2a2a2a;display:grid;grid-template-columns:1fr 1fr;gap:8px}.btn{border:1px solid #5b5b5b;background:#1b1b1b;color:#fff;border-radius:10px;padding:12px 6px;font-size:14px;font-weight:700}.btn.done{background:#243625;border-color:#47794b}.btn.clear{grid-column:1/-1;border-color:#9f7c24;color:#f4d35e}.btn.cancel{grid-column:1/-1;border-color:#7f3d3d;color:#ffb2b2}.status{grid-column:1/-1;text-align:center;font-size:12px;color:#aaa;min-height:17px;padding-top:2px}.nav{grid-column:1/-1;text-align:center;padding:4px}.nav a{color:#e8b832;text-decoration:none;font-weight:700;font-size:13px}
</style></head>
<body><div class="head"><div class="case">${caseNumber}</div><div class="addr">${addressHtml}</div></div>
<div class="map"><iframe src="${mapUrl}" allowfullscreen loading="eager"></iframe></div>
<div class="panel">
<button class="btn" id="responding" onclick="stamp('responding_at','Responding / En Route',this)">Responding / En Route</button>
<button class="btn" id="onscene" onclick="stamp('on_scene_at','On Scene',this)">On Scene</button>
<button class="btn" id="fh" onclick="stamp('funeral_home_arrived_at','Funeral Home Arrived',this)">Funeral Home Arrived</button>
<button class="btn clear" id="cleared" onclick="stamp('cleared_at','Cleared Scene',this)">Cleared Scene</button>
<button class="btn cancel" id="cancelled" onclick="stamp('response_cancelled_at','Response Cancelled',this)">Response Cancelled</button>
<div class="status" id="status">Ready</div>
<div class="nav"><a href="https://www.google.com/maps/search/?api=1&query=${mapQuery}">Open in Google Maps</a></div>
</div>
<script>
const TOKEN=${token}, KEY=${key}, ENDPOINT=${endpoint}, CASE_ID=${caseId};
async function stamp(field,label,btn){
  if(btn.disabled)return;
  const status=document.getElementById('status');
  status.textContent='Saving '+label+'…'; btn.disabled=true;
  const fields={}; fields[field]=new Date().toISOString(); if(field==='responding_at'||field==='on_scene_at')fields.scene_response_required=true;
  try{
    const r=await fetch(ENDPOINT,{method:'POST',headers:{'apikey':KEY,'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'},body:JSON.stringify({source:'occo_scriptable_cad_widget',external_event_id:'response-'+CASE_ID+'-'+field+'-'+Date.now(),case_id:CASE_ID,event_type:'response_timestamp',fields})});
    const data=await r.json();
    if(!r.ok||!data.ok)throw new Error(data.error||data.message||'Unable to save timestamp');
    btn.classList.add('done'); btn.textContent=label+' ✓'; status.textContent=label+' saved';
  }catch(e){btn.disabled=false;status.textContent=e.message||String(e);}
}
</script></body></html>`;

  const web = new WebView();
  await web.loadHTML(html);
  await web.present(true);
}

async function getOpenSceneResponses(session) {
  const uid = session?.user?.id;
  if (!uid) return [];
  const cases = await getJson(`${SUPABASE_URL}/rest/v1/cases?lead_investigator_id=eq.${encodeURIComponent(uid)}&status=eq.open&select=id,case_number,created_at&order=created_at.desc&limit=12`, session.access_token);
  if (!Array.isArray(cases) || !cases.length) return [];
  const ids = cases.map(x => x.id).filter(Boolean);
  const inFilter = `(${ids.join(",")})`;
  const notes = await getJson(`${SUPABASE_URL}/rest/v1/case_notification?case_id=in.${encodeURIComponent(inFilter)}&select=case_id,notification_date,dispatch_location_description,dispatch_street_address,dispatch_unit,dispatch_city,dispatch_state,dispatch_zip,scene_response_required,responding_time,on_scene_time,funeral_home_arrival_time,cleared_time,response_cancelled_time,intake_decision`, session.access_token);
  const byCase = new Map((notes || []).map(n => [n.case_id, n]));
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  return cases.map(c => ({...c, ...(byCase.get(c.id) || {}), case_id:c.id}))
    .filter(x => !x.cleared_time && !x.response_cancelled_time)
    .filter(x => x.responding_time || x.on_scene_time || x.funeral_home_arrival_time || x.scene_response_required === true || new Date(x.created_at).getTime() >= cutoff)
    .map(x => ({...x, stage: responseStage(x)}));
}

function responseStage(x) {
  if (x.response_cancelled_time) return "Cancelled";
  if (x.cleared_time) return "Cleared";
  if (x.funeral_home_arrival_time) return "Funeral Home Arrived";
  if (x.on_scene_time) return "On Scene";
  if (x.responding_time) return "Responding";
  return "Pending Response";
}

function buildAddress(item) {
  const line1 = [item.dispatch_location_description, item.dispatch_street_address, item.dispatch_unit].filter(Boolean).join(" ");
  const line2 = [item.dispatch_city, item.dispatch_state, item.dispatch_zip].filter(Boolean).join(" ");
  return [line1, line2].filter(Boolean).join(", ");
}

async function getWeatherSafe() {
  try {
    const weather = await new Request(WEATHER_URL).loadJSON();
    const current = weather?.current;
    if (!current || typeof current.temperature_2m !== "number") return null;
    return { temp: Math.round(current.temperature_2m), feels: typeof current.apparent_temperature === "number" ? Math.round(current.apparent_temperature) : null, label: weatherLabel(current.weather_code) };
  } catch { return null; }
}

async function lookupZip(zip) {
  if (!/^\d{5}$/.test(zip)) return { city: "", state: "" };
  try {
    const d = await new Request(`https://api.zippopotam.us/us/${encodeURIComponent(zip)}`).loadJSON();
    const place = d?.places?.[0];
    return { city: place?.["place name"] || "", state: place?.["state abbreviation"] || "" };
  } catch { return { city: "", state: "" }; }
}

async function getWidgetSession() {
  if (!Keychain.contains(SESSION_KEY)) return null;
  let saved = null;
  try { saved = JSON.parse(Keychain.get(SESSION_KEY)); } catch { return null; }
  if (!saved?.access_token) return null;
  if (Date.now() <= Number(saved.expires_at || 0) - 60000) return saved;
  if (!saved.refresh_token) return null;
  try {
    const r = await postJson(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, { refresh_token: saved.refresh_token }, null);
    saved = normalizeSession(r);
    Keychain.set(SESSION_KEY, JSON.stringify(saved));
    return saved;
  } catch { return null; }
}

async function ensureSession(forceRefresh = false) {
  let saved = null;
  if (Keychain.contains(SESSION_KEY)) { try { saved = JSON.parse(Keychain.get(SESSION_KEY)); } catch {} }
  if (saved?.refresh_token && (forceRefresh || !saved.access_token || Date.now() > Number(saved.expires_at || 0) - 60000)) {
    try {
      const r = await postJson(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, { refresh_token: saved.refresh_token }, null);
      saved = normalizeSession(r); Keychain.set(SESSION_KEY, JSON.stringify(saved)); return saved;
    } catch { Keychain.remove(SESSION_KEY); saved = null; }
  }
  if (saved?.access_token) return saved;

  const login = new Alert();
  login.title = "ATLAS Sign In";
  login.message = "Your password is used only to obtain an ATLAS session and is not stored by the widget.";
  login.addTextField("County Email", "");
  login.addSecureTextField("Password", "");
  login.addAction("Sign In"); login.addCancelAction("Cancel");
  if (await login.presentAlert() < 0) throw new Error("Sign in cancelled.");
  const email = login.textFieldValue(0).trim();
  const password = login.textFieldValue(1);
  const r = await postJson(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { email, password }, null);
  saved = normalizeSession(r); Keychain.set(SESSION_KEY, JSON.stringify(saved)); return saved;
}

function normalizeSession(r) {
  if (!r?.access_token || !r?.refresh_token) throw new Error("ATLAS sign in did not return a valid session.");
  return { access_token:r.access_token, refresh_token:r.refresh_token, user:r.user, expires_at:Date.now()+Number(r.expires_in||3600)*1000 };
}

async function getProfile(session) {
  const uid = session?.user?.id; if (!uid) throw new Error("ATLAS session has no user ID.");
  const rows = await getJson(`${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(uid)}&select=user_id,display_name,email,role,active`, session.access_token);
  if (!rows?.length) throw new Error("No OCCO profile is assigned to this ATLAS account.");
  return rows[0];
}

async function postJson(url, body, token) {
  const req = new Request(url); req.method = "POST";
  const headers = { apikey: SUPABASE_KEY, "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  req.headers = headers; req.body = JSON.stringify(body);
  const text = await req.loadString(); let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
  if (req.response.statusCode >= 300) throw new Error(data?.error || data?.message || text || `Request failed (${req.response.statusCode})`);
  return data;
}

async function getJson(url, token) {
  const req = new Request(url); req.headers = { apikey: SUPABASE_KEY, Authorization:`Bearer ${token}` };
  const text = await req.loadString(); let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
  if (req.response.statusCode >= 300) throw new Error(data?.message || text || `Request failed (${req.response.statusCode})`);
  return data;
}

async function notify(title, body) { const n = new Notification(); n.title=title; n.body=body; await n.schedule(); }
function localDate(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}
function localTime(d){return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;}
function escapeHtml(v){return String(v??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));}
function addHeader(w,text){const x=w.addText(text);x.textColor=new Color("#e8b832");x.font=Font.boldSystemFont(15);x.centerAlignText();}
function addSubheader(w,text){const x=w.addText(text);x.textColor=Color.white();x.font=Font.mediumSystemFont(9);x.centerAlignText();}
function addStatus(w,text){const x=w.addText(text);x.textColor=Color.gray();x.font=Font.systemFont(10);x.centerAlignText();}
function addResponseRow(w,item){const a=w.addText(`${item.case_number} • ${item.stage}`);a.textColor=Color.white();a.font=Font.boldSystemFont(11);const b=w.addText(buildAddress(item)||"Location pending");b.textColor=Color.gray();b.font=Font.systemFont(8);w.addSpacer(3);}
function addWeather(w,temp,feels,label){const a=w.addText("Weather");a.textColor=new Color("#e8b832");a.font=Font.boldSystemFont(10);const b=w.addText(feels===null?`${temp}°F`:`${temp}°F • Feels ${feels}°`);b.textColor=Color.white();b.font=Font.boldSystemFont(12);const c=w.addText(label);c.textColor=Color.gray();c.font=Font.systemFont(8);}
function addFooter(w,text){const x=w.addText(text);x.textColor=Color.gray();x.font=Font.systemFont(8);}
function weatherLabel(code){const map={0:"Clear",1:"Mostly Clear",2:"Partly Cloudy",3:"Cloudy",45:"Fog",48:"Freezing Fog",51:"Light Drizzle",53:"Drizzle",55:"Heavy Drizzle",61:"Light Rain",63:"Rain",65:"Heavy Rain",71:"Light Snow",73:"Snow",75:"Heavy Snow",80:"Rain Showers",81:"Showers",82:"Heavy Showers",95:"Thunderstorm",96:"Thunderstorm/Hail",99:"Severe Thunderstorm"};return map[code]||"Weather Updating";}
