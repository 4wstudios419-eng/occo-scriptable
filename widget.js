const DASHBOARD_URL = "https://script.google.com/macros/s/AKfycbxjqt_Z5iNL6Ny_JbAyJzIYs6zMN3Zz2NshcJjJb9eGY_1xt91JoN7sYTmE4qoLg_d2pg/exec?action=dashboard";
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

if (!config.runsInWidget && !config.runsInAccessoryWidget) {
  const menu = new Alert();
  menu.title = "OCCO / ATLAS";
  menu.message = "Choose an action.";
  menu.addAction("CAD Quick Start");
  menu.addAction("Open ATLAS");
  if (Keychain.contains(SESSION_KEY)) menu.addDestructiveAction("Sign Out CAD Session");
  menu.addCancelAction("Cancel");
  const choice = await menu.presentSheet();
  if (choice === 0) await cadQuickStart();
  else if (choice === 1) Safari.open("https://occoops.netlify.app/");
  else if (choice === 2 && Keychain.contains(SESSION_KEY)) { Keychain.remove(SESSION_KEY); await notify("ATLAS CAD", "Saved CAD session removed."); }
  Script.complete();
  return;
}

let w = new ListWidget();
w.url = `scriptable:///run?scriptName=${encodeURIComponent(Script.name())}&mode=cad`;
w.backgroundColor = new Color("#0a0a0a");
w.setPadding(10, 12, 10, 12);

try {
  const req = new Request(DASHBOARD_URL);
  const data = await req.loadJSON();
  const weatherReq = new Request(WEATHER_URL);
  const weather = await weatherReq.loadJSON();
  const temp = Math.round(weather.current.temperature_2m);
  const feels = Math.round(weather.current.apparent_temperature);
  const wx = weatherLabel(weather.current.weather_code);
  const badgeReq = new Request(BADGE_URL);
  const badge = await badgeReq.loadImage();
  const badgeOuter = w.addStack();
  badgeOuter.layoutHorizontally(); badgeOuter.addSpacer();
  const badgeImg = badgeOuter.addImage(badge); badgeImg.imageSize = new Size(58, 58); badgeOuter.addSpacer();
  w.addSpacer(3); addHeader("OTTAWA COUNTY"); addSubheader("CORONER'S OFFICE"); w.addSpacer(6);
  addBig("Next Case", data.nextCaseNumber); w.addSpacer(5); addSection("On Call"); addRow("Investigator", data.onCallInvestigator);
  if (data.currentInvestigatorPhone) addRow("Phone", data.currentInvestigatorPhone);
  w.addSpacer(5); addSection("Funeral Home"); addRow("", data.funeralHomeOfMonth); w.addSpacer(5); addWeather(temp, feels, wx); w.addSpacer();
  addFooter("Tap for CAD Quick Start • Updated " + formatTime(data.updatedAt));
} catch (err) {
  addHeader("OCCO"); w.addSpacer(8); let error = w.addText(String(err)); error.textColor = Color.red(); error.font = Font.systemFont(10);
}
Script.setWidget(w); Script.complete();

async function cadQuickStart(){
  try {
    const session = await ensureSession();
    const profile = await getProfile(session);
    if (!profile?.active) throw new Error("Your ATLAS profile is inactive.");

    const first = new Alert();
    first.title = "ATLAS CAD Quick Start";
    first.message = `Signed in as ${profile.display_name || profile.email || "ATLAS user"}`;
    first.addTextField("Decedent / Case Identifier", "");
    first.addTextField("Reporting Agency / Source", "");
    first.addTextField("Reporting / Briefing Person", "");
    first.addTextField("Callback Number", "");
    first.addAction("Continue"); first.addCancelAction("Cancel");
    if (await first.presentAlert() < 0) return;
    const decedent = first.textFieldValue(0).trim();
    const agency = first.textFieldValue(1).trim();
    const reportingPerson = first.textFieldValue(2).trim();
    const callback = first.textFieldValue(3).trim();
    if (!decedent) throw new Error("Decedent / Case Identifier is required.");

    const second = new Alert();
    second.title = "Dispatch Location";
    second.addTextField("Facility / Place", "");
    second.addTextField("Street Address", "");
    second.addTextField("Unit / Room", "");
    second.addTextField("City", "");
    second.addTextField("State", "OH");
    second.addTextField("ZIP", "");
    second.addAction("Continue"); second.addCancelAction("Cancel");
    if (await second.presentAlert() < 0) return;

    const facility = second.textFieldValue(0).trim();
    const street = second.textFieldValue(1).trim();
    const unit = second.textFieldValue(2).trim();
    const city = second.textFieldValue(3).trim();
    const state = second.textFieldValue(4).trim();
    const zip = second.textFieldValue(5).trim();

    const classAlert = new Alert();
    classAlert.title = "Case Classification";
    ["Investigative", "Non-Investigative"].forEach(x=>classAlert.addAction(x));
    classAlert.addCancelAction("Cancel");
    const classIndex = await classAlert.presentSheet();
    if (classIndex < 0) return;
    const caseCategory = classIndex === 1 ? "non_investigative" : "investigative";

    const sceneAlert = new Alert();
    sceneAlert.title = "Scene Response";
    sceneAlert.addAction("Respond to Scene"); sceneAlert.addAction("No Scene Response"); sceneAlert.addCancelAction("Cancel");
    const sceneIndex = await sceneAlert.presentSheet();
    if (sceneIndex < 0) return;
    const sceneResponse = sceneIndex === 0;

    const pathwayAlert = new Alert();
    pathwayAlert.title = "Primary Pathway";
    const pathways = [
      ["Natural / Medical Event","natural_medical"], ["Poisoning / Toxic Exposure","poisoning_toxic"],
      ["Suspected Suicide","suicide"], ["Homicide / Assault","homicide_assault"],
      ["Transportation Incident","transportation"], ["Drowning / Submersion","drowning_submersion"],
      ["Workplace Incident","workplace"], ["Infant Death / SUIDI","infant_suidi"], ["Undetermined / Pending","undetermined_pending"]
    ];
    pathways.forEach(p=>pathwayAlert.addAction(p[0])); pathwayAlert.addCancelAction("Skip");
    const pathwayIndex = await pathwayAlert.presentSheet();
    const pathway = pathwayIndex >= 0 ? pathways[pathwayIndex][1] : null;

    const note = new Alert();
    note.title = "Reported Circumstances";
    note.addTextField("Brief circumstances", "");
    note.addAction("Create Case"); note.addCancelAction("Cancel");
    if (await note.presentAlert() < 0) return;
    const circumstances = note.textFieldValue(0).trim();

    const fresh = await ensureSession(true);
    const caseRow = await createNumberedCase(fresh, profile.user_id, caseCategory);
    await saveDecedent(fresh, caseRow.id, decedent, profile.user_id);

    const now = new Date();
    const payload = {
      source: "occo_scriptable_cad_widget",
      external_event_id: `scriptable-${caseRow.id}-${Date.now()}`,
      case_id: caseRow.id,
      notification_date: localDate(now),
      notification_time: localTime(now),
      contacting_agency: agency || null,
      reporting_person: reportingPerson || null,
      callback_number: callback || null,
      reported_circumstances: circumstances || null,
      scene_response_required: sceneResponse,
      dispatch_location_description: facility || null,
      dispatch_street_address: street || null,
      dispatch_unit: unit || null,
      dispatch_city: city || null,
      dispatch_state: state || null,
      dispatch_zip: zip || null,
      investigation_pathway: pathway
    };
    const ingest = await postJson(CAD_INGEST_URL, payload, fresh.access_token, true);
    const done = new Alert();
    done.title = `${caseRow.case_number} Created`;
    done.message = ingest?.status === "needs_review"
      ? "CAD Quick Start reached ATLAS, but one or more fields need review."
      : "CAD Quick Start was received by ATLAS and Dispatch is populated.";
    done.addAction("Open ATLAS"); done.addAction("Done");
    const open = await done.presentAlert();
    if (open === 0) Safari.open("https://occoops.netlify.app/");
  } catch (e) {
    const a = new Alert(); a.title = "CAD Quick Start"; a.message = String(e?.message || e); a.addAction("OK"); await a.presentAlert();
  }
}

async function ensureSession(forceRefresh=false){
  let saved = null;
  if (Keychain.contains(SESSION_KEY)) { try { saved = JSON.parse(Keychain.get(SESSION_KEY)); } catch {} }
  if (saved?.refresh_token && (forceRefresh || !saved.access_token || Date.now() > Number(saved.expires_at || 0)-60000)) {
    try {
      const r = await postJson(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {refresh_token:saved.refresh_token}, null, false);
      saved = normalizeSession(r); Keychain.set(SESSION_KEY, JSON.stringify(saved)); return saved;
    } catch { Keychain.remove(SESSION_KEY); saved = null; }
  }
  if (saved?.access_token) return saved;
  const login = new Alert(); login.title = "ATLAS Sign In"; login.message = "Your password is used only to obtain an ATLAS session and is not stored by the widget.";
  login.addTextField("County Email", ""); login.addSecureTextField("Password", ""); login.addAction("Sign In"); login.addCancelAction("Cancel");
  if (await login.presentAlert() < 0) throw new Error("Sign in cancelled.");
  const email = login.textFieldValue(0).trim(), password = login.textFieldValue(1);
  const r = await postJson(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {email,password}, null, false);
  saved = normalizeSession(r); Keychain.set(SESSION_KEY, JSON.stringify(saved)); return saved;
}
function normalizeSession(r){ if(!r?.access_token || !r?.refresh_token) throw new Error("ATLAS sign in did not return a valid session."); return {access_token:r.access_token,refresh_token:r.refresh_token,user:r.user,expires_at:Date.now()+Number(r.expires_in||3600)*1000}; }
async function getProfile(session){
  const uid = session?.user?.id; if(!uid) throw new Error("ATLAS session has no user ID.");
  const rows = await getJson(`${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(uid)}&select=user_id,display_name,email,role,active`, session.access_token);
  if(!rows?.length) throw new Error("No OCCO profile is assigned to this ATLAS account."); return rows[0];
}
async function createNumberedCase(session, leadId, category){
  return await postJson(`${SUPABASE_URL}/rest/v1/rpc/create_numbered_case`, {p_case_category:category,p_record_class:"official",p_lead_investigator_id:leadId,p_record_class_reason:null}, session.access_token, false);
}
async function saveDecedent(session, caseId, decedent, userId){
  const req = new Request(`${SUPABASE_URL}/rest/v1/case_decedent?on_conflict=case_id`); req.method="POST";
  req.headers={apikey:SUPABASE_KEY,Authorization:`Bearer ${session.access_token}`,"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal"};
  req.body=JSON.stringify([{case_id:caseId,decedent_name:decedent,updated_by:userId}]); await req.loadString(); if(req.response.statusCode>=300) throw new Error(`Unable to save decedent identifier (${req.response.statusCode}).`);
}
async function postJson(url, body, token, functionCall){
  const req = new Request(url); req.method="POST"; req.headers={apikey:SUPABASE_KEY,"Content-Type":"application/json"}; if(token) req.headers.Authorization=`Bearer ${token}`; req.body=JSON.stringify(body);
  let data; try { data=await req.loadJSON(); } catch { const t=await req.loadString(); throw new Error(t||`Request failed (${req.response.statusCode})`); }
  if(req.response.statusCode>=300) throw new Error(data?.error||data?.message||`Request failed (${req.response.statusCode})`); return data;
}
async function getJson(url, token){ const req=new Request(url); req.headers={apikey:SUPABASE_KEY,Authorization:`Bearer ${token}`}; const d=await req.loadJSON(); if(req.response.statusCode>=300) throw new Error(d?.message||`Request failed (${req.response.statusCode})`); return d; }
async function notify(title, body){ const n=new Notification(); n.title=title; n.body=body; await n.schedule(); }
function localDate(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function localTime(d){ return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }
function addHeader(text){let line=w.addText(text);line.textColor=new Color("#e8b832");line.font=Font.boldSystemFont(15);line.centerAlignText();}
function addSubheader(text){let line=w.addText(text);line.textColor=Color.white();line.font=Font.mediumSystemFont(10);line.centerAlignText();}
function addSection(text){let line=w.addText(text);line.textColor=new Color("#e8b832");line.font=Font.boldSystemFont(11);}
function addBig(label,value){let lbl=w.addText(label);lbl.textColor=Color.gray();lbl.font=Font.systemFont(9);let val=w.addText(value||"—");val.textColor=Color.white();val.font=Font.boldSystemFont(27);}
function addRow(label,value){let text=label?`${label}: ${value||"—"}`:`${value||"—"}`;let row=w.addText(text);row.textColor=Color.white();row.font=Font.systemFont(11);}
function addWeather(temp,feels,label){let title=w.addText("Weather");title.textColor=new Color("#e8b832");title.font=Font.boldSystemFont(11);let line=w.addText(`${temp}°F • Feels ${feels}°`);line.textColor=Color.white();line.font=Font.boldSystemFont(14);let desc=w.addText(label);desc.textColor=Color.gray();desc.font=Font.systemFont(9);}
function addFooter(text){let line=w.addText(text);line.textColor=Color.gray();line.font=Font.systemFont(8);}
function formatTime(value){if(!value)return"—";try{return new Date(value).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});}catch{return"—";}}
function weatherLabel(code){const map={0:"Clear",1:"Mostly Clear",2:"Partly Cloudy",3:"Cloudy",45:"Fog",48:"Freezing Fog",51:"Light Drizzle",53:"Drizzle",55:"Heavy Drizzle",61:"Light Rain",63:"Rain",65:"Heavy Rain",71:"Light Snow",73:"Snow",75:"Heavy Snow",80:"Rain Showers",81:"Showers",82:"Heavy Showers",95:"Thunderstorm",96:"Thunderstorm/Hail",99:"Severe Thunderstorm"};return map[code]||"Weather Updating";}
