var CAD_URL = "https://occo-widget.netlify.app/cad/";
var WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=41.5120&longitude=-82.9377&current=temperature_2m,apparent_temperature,weather_code&temperature_unit=fahrenheit";
var SUPABASE_URL = "https://movapecdjjddkvavyprt.supabase.co";
var SUPABASE_KEY = "sb_publishable_zdjYToMI0h51qYx179V2cQ_wJJoRt5k";
var SESSION_KEY = "ATLAS_CAD_WIDGET_SESSION_V1";

if (!config.runsInWidget && !config.runsInAccessoryWidget) {
  Safari.open(CAD_URL);
  Script.complete();
} else {
  var w = new ListWidget();
  w.url = CAD_URL;
  w.backgroundColor = new Color("#0a0a0a");
  w.setPadding(12, 14, 11, 14);

  try {
    var session = await getSavedSession();
    var items = session ? await getOpenResponses(session) : [];
    var wx = await getWeatherSafe();
    var head = w.addStack();
    head.layoutHorizontally();
    head.centerAlignContent();
    var brand = head.addText("ATLAS CAD");
    brand.textColor = Color.white();
    brand.font = Font.boldSystemFont(14);
    head.addSpacer();
    var count = head.addText(String(items.length));
    count.textColor = new Color("#111111");
    count.font = Font.boldSystemFont(10);
    count.backgroundColor = new Color("#e8b832");
    count.cornerRadius = 9;
    w.addSpacer(8);

    if (!session) {
      addStatus(w, "Tap to sign in to ATLAS CAD");
    } else if (!items.length) {
      addStatus(w, "No open scene responses");
    } else {
      var limit = config.widgetFamily === "large" ? 4 : (config.widgetFamily === "small" ? 1 : 2);
      var i;
      for (i = 0; i < Math.min(items.length, limit); i++) addResponse(w, items[i]);
    }

    w.addSpacer();
    var footer = w.addStack();
    footer.layoutHorizontally();
    footer.centerAlignContent();
    if (wx) {
      var weather = footer.addText(wx.temp + " deg · " + wx.label);
      weather.textColor = Color.gray();
      weather.font = Font.systemFont(10);
    }
    footer.addSpacer();
    var open = footer.addText("OPEN CAD >");
    open.textColor = new Color("#e8b832");
    open.font = Font.boldSystemFont(10);
  } catch (e) {
    var fallback = w.addText("ATLAS CAD");
    fallback.textColor = Color.white();
    fallback.font = Font.boldSystemFont(14);
    w.addSpacer(8);
    addStatus(w, "Tap to open CAD");
  }
  Script.setWidget(w);
  Script.complete();
}

async function getSavedSession() {
  if (!Keychain.contains(SESSION_KEY)) return null;
  try {
    var s = JSON.parse(Keychain.get(SESSION_KEY));
    if (s && s.access_token && Date.now() < Number(s.expires_at || 0) - 60000) return s;
    if (!s || !s.refresh_token) return null;
    var body = { refresh_token: s.refresh_token };
    var r = await postJson(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", body);
    s = { access_token:r.access_token, refresh_token:r.refresh_token, user:r.user, expires_at:Date.now()+Number(r.expires_in || 3600)*1000 };
    Keychain.set(SESSION_KEY, JSON.stringify(s));
    return s;
  } catch (e) { return null; }
}

async function getOpenResponses(session) {
  var uid = session && session.user ? session.user.id : null;
  if (!uid) return [];
  var cases = await getJson(SUPABASE_URL + "/rest/v1/cases?lead_investigator_id=eq." + uid + "&status=eq.open&select=id,case_number,created_at&order=created_at.desc&limit=12", session.access_token);
  if (!cases || !cases.length) return [];
  var caseIds = [];
  var i;
  for (i=0;i<cases.length;i++) caseIds.push(cases[i].id);
  var ids = "(" + caseIds.join(",") + ")";
  var notes = await getJson(SUPABASE_URL + "/rest/v1/case_notification?case_id=in." + encodeURIComponent(ids) + "&select=case_id,dispatch_location_description,dispatch_street_address,dispatch_city,dispatch_state,responding_time,on_scene_time,cleared_time,response_cancelled_time,scene_response_required", session.access_token);
  var noteMap = {};
  notes = notes || [];
  for (i=0;i<notes.length;i++) noteMap[notes[i].case_id] = notes[i];
  var cutoff = Date.now() - 48 * 3600000;
  var out = [];
  for (i=0;i<cases.length;i++) {
    var c = cases[i];
    var n = noteMap[c.id] || {};
    var x = {};
    var k;
    for (k in c) x[k] = c[k];
    for (k in n) x[k] = n[k];
    if (x.cleared_time || x.response_cancelled_time) continue;
    var recent = new Date(x.created_at).getTime() >= cutoff;
    if (!(x.responding_time || x.on_scene_time || x.scene_response_required === true || recent)) continue;
    x.stage = x.on_scene_time ? "ON SCENE" : (x.responding_time ? "EN ROUTE" : "PENDING");
    out.push(x);
  }
  return out;
}

async function getWeatherSafe() {
  try {
    var req = new Request(WEATHER_URL);
    var d = await req.loadJSON();
    var c = d && d.current ? d.current : null;
    if (!c || typeof c.temperature_2m !== "number") return null;
    return { temp:Math.round(c.temperature_2m), label:weatherLabel(c.weather_code) };
  } catch (e) { return null; }
}

async function postJson(url, body) {
  var r = new Request(url);
  r.method = "POST";
  r.headers = { apikey:SUPABASE_KEY, "Content-Type":"application/json" };
  r.body = JSON.stringify(body);
  var text = await r.loadString();
  var d = null;
  try { d = text ? JSON.parse(text) : null; } catch (e) {}
  if (r.response.statusCode >= 300) throw new Error(d && d.message ? d.message : (text || "Request failed"));
  return d;
}

async function getJson(url, token) {
  var r = new Request(url);
  r.headers = { apikey:SUPABASE_KEY, Authorization:"Bearer " + token };
  var text = await r.loadString();
  var d = null;
  try { d = text ? JSON.parse(text) : null; } catch (e) {}
  if (r.response.statusCode >= 300) throw new Error(d && d.message ? d.message : (text || "Request failed"));
  return d;
}

function addStatus(w, text) {
  var x = w.addText(text);
  x.textColor = Color.gray();
  x.font = Font.systemFont(10);
}

function addResponse(w, x) {
  var row = w.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  var left = row.addStack();
  left.layoutVertically();
  var num = left.addText(x.case_number || "ATLAS CASE");
  num.textColor = Color.white();
  num.font = Font.boldSystemFont(11);
  var parts = [];
  if (x.dispatch_location_description) parts.push(x.dispatch_location_description);
  if (x.dispatch_street_address) parts.push(x.dispatch_street_address);
  if (x.dispatch_city) parts.push(x.dispatch_city);
  var addr = left.addText(parts.length ? parts.join(" · ") : "Location pending");
  addr.textColor = Color.gray();
  addr.font = Font.systemFont(9);
  addr.lineLimit = 1;
  row.addSpacer(8);
  var stage = row.addText(x.stage);
  stage.textColor = new Color("#e8b832");
  stage.font = Font.boldSystemFont(9);
  stage.lineLimit = 1;
  w.addSpacer(7);
}

function weatherLabel(code) {
  var map = {"0":"Clear","1":"Mostly Clear","2":"Partly Cloudy","3":"Cloudy","45":"Fog","48":"Freezing Fog","51":"Light Drizzle","53":"Drizzle","55":"Heavy Drizzle","61":"Light Rain","63":"Rain","65":"Heavy Rain","71":"Light Snow","73":"Snow","75":"Heavy Snow","80":"Rain Showers","81":"Showers","82":"Heavy Showers","95":"Thunderstorm","96":"Thunderstorm/Hail","99":"Severe Thunderstorm"};
  return map[String(code)] || "Weather";
}
