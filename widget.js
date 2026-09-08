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
  else if (choice === 2 && Keychain.contains(SESSION_KEY)) {
    Keychain.remove(SESSION_KEY);
    await notify("ATLAS CAD", "Saved CAD session removed.");
  }
  Script.complete();
  return;
}

let w = new ListWidget();
w.url = `scriptable:///run?scriptName=${encodeURIComponent(Script.name())}&mode=cad`;
w.backgroundColor = new Color("#0a0a0a");
w.setPadding(10, 12, 10, 12);

try {
  const data = await new Request(DASHBOARD_URL).loadJSON();
  try {
    const badge = await new Request(BADGE_URL).loadImage();
    const badgeOuter = w.addStack();
    badgeOuter.layoutHorizontally();
    badgeOuter.addSpacer();
    const badgeImg = badgeOuter.addImage(badge);
    badgeImg.imageSize = new Size(58, 58);
    badgeOuter.addSpacer();
    w.addSpacer(3);
  } catch {}

  addHeader("OTTAWA COUNTY");
  addSubheader("CORONER'S OFFICE");
  w.addSpacer(6);
  addBig("Next Case", data?.nextCaseNumber);
  w.addSpacer(5);
  addSection("On Call");
  addRow("Investigator", data?.onCallInvestigator);
  if (data?.currentInvestigatorPhone) addRow("Phone", data.currentInvestigatorPhone);
  w.addSpacer(5);
  addSection("Funeral Home");
  addRow("", data?.funeralHomeOfMonth);

  const wx = await getWeatherSafe();
  if (wx) {
    w.addSpacer(5);
    addWeather(wx.temp, wx.feels, wx.label);
  }

  w.addSpacer();
  addFooter("Tap for CAD Quick Start • Updated " + formatTime(data?.updatedAt));
} catch {
  addHeader("OCCO");
  w.addSpacer(8);
  const error = w.addText("Dashboard unavailable");
  error.textColor = Color.red();
  error.font = Font.systemFont(10);
}

Script.setWidget(w);
Script.complete();

async function getWeatherSafe() {
  try {
    const weather = await new Request(WEATHER_URL).loadJSON();
    const current = weather?.current;
    if (!current || typeof current.temperature_2m !== "number") return null;
    return {
      temp: Math.round(current.temperature_2m),
      feels: typeof current.apparent_temperature === "number" ? Math.round(current.apparent_temperature) : null,
      label: weatherLabel(current.weather_code)
    };
  } catch {
    return null;
  }
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
    const done = new Alert();
    done.title = `${result.case_number || "ATLAS Case"} Created`;
    done.message = result?.status === "needs_review" || result?.status === "partial"
      ? "Case created. One or more CAD fields need review in ATLAS."
      : "Case created. Dispatch is populated and remains pending investigation until updated in ATLAS.";
    done.addAction("Open ATLAS");
    done.addAction("Done");
    const open = await done.presentAlert();
    if (open === 0) Safari.open("https://occoops.netlify.app/");
  } catch (e) {
    const a = new Alert();
    a.title = "CAD Quick Start";
    a.message = String(e?.message || e);
    a.addAction("OK");
    await a.presentAlert();
  }
}

async function lookupZip(zip) {
  if (!/^\d{5}$/.test(zip)) return { city: "", state: "" };
  try {
    const d = await new Request(`https://api.zippopotam.us/us/${encodeURIComponent(zip)}`).loadJSON();
    const place = d?.places?.[0];
    return {
      city: place?.["place name"] || "",
      state: place?.["state abbreviation"] || ""
    };
  } catch {
    return { city: "", state: "" };
  }
}

async function ensureSession(forceRefresh = false) {
  let saved = null;
  if (Keychain.contains(SESSION_KEY)) {
    try { saved = JSON.parse(Keychain.get(SESSION_KEY)); } catch {}
  }

  if (saved?.refresh_token && (forceRefresh || !saved.access_token || Date.now() > Number(saved.expires_at || 0) - 60000)) {
    try {
      const r = await postJson(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, { refresh_token: saved.refresh_token }, null);
      saved = normalizeSession(r);
      Keychain.set(SESSION_KEY, JSON.stringify(saved));
      return saved;
    } catch {
      Keychain.remove(SESSION_KEY);
      saved = null;
    }
  }

  if (saved?.access_token) return saved;

  const login = new Alert();
  login.title = "ATLAS Sign In";
  login.message = "Your password is used only to obtain an ATLAS session and is not stored by the widget.";
  login.addTextField("County Email", "");
  login.addSecureTextField("Password", "");
  login.addAction("Sign In");
  login.addCancelAction("Cancel");
  if (await login.presentAlert() < 0) throw new Error("Sign in cancelled.");

  const email = login.textFieldValue(0).trim();
  const password = login.textFieldValue(1);
  const r = await postJson(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, { email, password }, null);
  saved = normalizeSession(r);
  Keychain.set(SESSION_KEY, JSON.stringify(saved));
  return saved;
}

function normalizeSession(r) {
  if (!r?.access_token || !r?.refresh_token) throw new Error("ATLAS sign in did not return a valid session.");
  return {
    access_token: r.access_token,
    refresh_token: r.refresh_token,
    user: r.user,
    expires_at: Date.now() + Number(r.expires_in || 3600) * 1000
  };
}

async function getProfile(session) {
  const uid = session?.user?.id;
  if (!uid) throw new Error("ATLAS session has no user ID.");
  const rows = await getJson(`${SUPABASE_URL}/rest/v1/user_profiles?user_id=eq.${encodeURIComponent(uid)}&select=user_id,display_name,email,role,active`, session.access_token);
  if (!rows?.length) throw new Error("No OCCO profile is assigned to this ATLAS account.");
  return rows[0];
}

async function postJson(url, body, token) {
  const req = new Request(url);
  req.method = "POST";
  const headers = { apikey: SUPABASE_KEY, "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  req.headers = headers;
  req.body = JSON.stringify(body);
  const text = await req.loadString();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (req.response.statusCode >= 300) throw new Error(data?.error || data?.message || text || `Request failed (${req.response.statusCode})`);
  return data;
}

async function getJson(url, token) {
  const req = new Request(url);
  req.headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` };
  const text = await req.loadString();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  if (req.response.statusCode >= 300) throw new Error(data?.message || text || `Request failed (${req.response.statusCode})`);
  return data;
}

async function notify(title, body) {
  const n = new Notification();
  n.title = title;
  n.body = body;
  await n.schedule();
}

function localDate(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function localTime(d) { return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }
function addHeader(text) { const x=w.addText(text); x.textColor=new Color("#e8b832"); x.font=Font.boldSystemFont(15); x.centerAlignText(); }
function addSubheader(text) { const x=w.addText(text); x.textColor=Color.white(); x.font=Font.mediumSystemFont(10); x.centerAlignText(); }
function addSection(text) { const x=w.addText(text); x.textColor=new Color("#e8b832"); x.font=Font.boldSystemFont(11); }
function addBig(label,value) { const a=w.addText(label); a.textColor=Color.gray(); a.font=Font.systemFont(9); const b=w.addText(value||"—"); b.textColor=Color.white(); b.font=Font.boldSystemFont(27); }
function addRow(label,value) { const x=w.addText(label?`${label}: ${value||"—"}`:`${value||"—"}`); x.textColor=Color.white(); x.font=Font.systemFont(11); }
function addWeather(temp,feels,label) { const a=w.addText("Weather"); a.textColor=new Color("#e8b832"); a.font=Font.boldSystemFont(11); const b=w.addText(feels===null?`${temp}°F`:`${temp}°F • Feels ${feels}°`); b.textColor=Color.white(); b.font=Font.boldSystemFont(14); const c=w.addText(label); c.textColor=Color.gray(); c.font=Font.systemFont(9); }
function addFooter(text) { const x=w.addText(text); x.textColor=Color.gray(); x.font=Font.systemFont(8); }
function formatTime(value) { if(!value)return"—"; try{return new Date(value).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});}catch{return"—";} }
function weatherLabel(code) { const map={0:"Clear",1:"Mostly Clear",2:"Partly Cloudy",3:"Cloudy",45:"Fog",48:"Freezing Fog",51:"Light Drizzle",53:"Drizzle",55:"Heavy Drizzle",61:"Light Rain",63:"Rain",65:"Heavy Rain",71:"Light Snow",73:"Snow",75:"Heavy Snow",80:"Rain Showers",81:"Showers",82:"Heavy Showers",95:"Thunderstorm",96:"Thunderstorm/Hail",99:"Severe Thunderstorm"}; return map[code]||"Weather Updating"; }
