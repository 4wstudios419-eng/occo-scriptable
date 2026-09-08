var CAD_URL = "https://occo-widget.netlify.app/cad/";
var WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=41.5120&longitude=-82.9377&current=temperature_2m,apparent_temperature,weather_code&temperature_unit=fahrenheit";
var SUPABASE_URL = "https://movapecdjjddkvavyprt.supabase.co";
var SUPABASE_KEY = "sb_publishable_zdjYToMI0h51qYx179V2cQ_wJJoRt5k";
var SESSION_KEY = "ATLAS_CAD_WIDGET_SESSION_V1";
var GOLD = new Color("#e8b832");
var MUTED = new Color("#9a9da3");
var LINE = new Color("#272a2f");

if (!config.runsInWidget && !config.runsInAccessoryWidget) {
  Safari.open(CAD_URL);
  Script.complete();
} else {
  var w = new ListWidget();
  w.url = CAD_URL;
  w.backgroundColor = new Color("#090909");
  w.setPadding(14, 16, 12, 16);

  try {
    var session = await getSavedSession();
    var items = session ? await getOpenResponses(session) : [];
    var wx = await getWeatherSafe();

    var head = w.addStack();
    head.layoutHorizontally();
    head.centerAlignContent();
    var brand = head.addText("ATLAS CAD");
    brand.textColor = Color.white();
    brand.font = Font.boldSystemFont(16);
    head.addSpacer();
    var count = head.addText(String(items.length));
    count.textColor = new Color("#111111");
    count.font = Font.boldSystemFont(10);
    count.backgroundColor = GOLD;
    count.cornerRadius = 9;

    w.addSpacer(9);

    if (!session) {
      addStatus(w, "Tap to sign in to ATLAS CAD");
    } else if (!items.length) {
      addStatus(w, "No open scene responses");
    } else {
      sortResponses(items);
      if (config.widgetFamily === "small") {
        addPrimaryResponse(w, items[0]);
      } else {
        addPrimaryResponse(w, items[0]);
        var limit = config.widgetFamily === "large" ? 3 : 2;
        var i;
        for (i = 1; i < Math.min(items.length, limit); i++) addCompactResponse(w, items[i]);
        if (items.length > limit && config.widgetFamily === "large") {
          var more = w.addText("+" + (items.length - limit) + " more");
          more.textColor = MUTED;
          more.font = Font.systemFont(9);
        }
      }
    }

    w.addSpacer();
    var divider = w.addStack();
    divider.size = new Size(0, 1);
    divider.backgroundColor = LINE;
    w.addSpacer(8);

    var footer = w.addStack();
    footer.layoutHorizontally();
    footer.centerAlignContent();
    if (wx) {
      var weather = footer.addText(wx.temp + " deg · " + wx.label);
      weather.textColor = MUTED;
      weather.font = Font.systemFont(10);
    }
    footer.addSpacer();
    var open = footer.addText("OPEN CAD >");
    open.textColor = GOLD;
    open.font = Font.boldSystemFont(10);
  } catch (e) {
    var fallback = w.addText("ATLAS CAD");
    fallback.textColor = Color.white();
    fallback.font = Font.boldSystemFont(16);
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
    var r = await postJson(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", { refresh_token: s.refresh_token });
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
  var idsList = [];
  var i;
  for (i = 0; i < cases.length; i++) idsList.push(cases[i].id);
  var ids = "(" + idsList.join(",") + ")";
  var notes = await getJson(SUPABASE_URL + "/rest/v1/case_notification?case_id=in." + encodeURIComponent(ids) + "&select=case_id,dispatch_location_description,dispatch_street_address,dispatch_city,dispatch_state,responding_time,on_scene_time,cleared_time,response_cancelled_time,scene_response_required", session.access_token);
  var noteMap = {};
  notes = notes || [];
  for (i = 0; i < notes.length; i++) noteMap[notes[i].case_id] = notes[i];
  var cutoff = Date.now() - 48 * 3600000;
  var out = [];
  for (i = 0; i < cases.length; i++) {
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

function sortResponses(items) {
  var priority = {"ON SCENE":0,"EN ROUTE":1,"PENDING":2};
  items.sort(function(a,b) {
    var pa = priority[a.stage] === undefined ? 9 : priority[a.stage];
    var pb = priority[b.stage] === undefined ? 9 : priority[b.stage];
    if (pa !== pb) return pa - pb;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

function addPrimaryResponse(w, x) {
  var card = w.addStack();
  card.layoutVertically();
  card.backgroundColor = new Color("#18140a");
  card.cornerRadius = 14;
  card.setPadding(10, 11, 10, 11);

  var top = card.addStack();
  top.layoutHorizontally();
  top.centerAlignContent();
  var num = top.addText(x.case_number || "ATLAS CASE");
  num.textColor = Color.white();
  num.font = Font.boldSystemFont(13);
  top.addSpacer(8);
  var stage = top.addText(x.stage);
  stage.textColor = GOLD;
  stage.font = Font.boldSystemFont(9);

  var addr = card.addText(shortLocation(x));
  addr.textColor = new Color("#c8cbd0");
  addr.font = Font.systemFont(10);
  addr.lineLimit = 1;
  card.addSpacer(2);
  var meta = card.addText(stageMeta(x));
  meta.textColor = MUTED;
  meta.font = Font.systemFont(8);
  w.addSpacer(8);
}

function addCompactResponse(w, x) {
  var row = w.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  var left = row.addStack();
  left.layoutVertically();
  var num = left.addText(x.case_number || "ATLAS CASE");
  num.textColor = Color.white();
  num.font = Font.boldSystemFont(11);
  var addr = left.addText(shortLocation(x));
  addr.textColor = MUTED;
  addr.font = Font.systemFont(9);
  addr.lineLimit = 1;
  row.addSpacer(8);
  var stage = row.addText(x.stage);
  stage.textColor = GOLD;
  stage.font = Font.boldSystemFont(9);
  stage.lineLimit = 1;
  w.addSpacer(8);
}

function shortLocation(x) {
  var parts = [];
  if (x.dispatch_location_description) parts.push(x.dispatch_location_description);
  else if (x.dispatch_street_address) parts.push(x.dispatch_street_address);
  if (x.dispatch_city) parts.push(x.dispatch_city);
  if (x.dispatch_state) parts.push(x.dispatch_state);
  return parts.length ? parts.join(" · ") : "Location pending";
}

function stageMeta(x) {
  if (x.on_scene_time) return "On scene since " + clock(x.on_scene_time);
  if (x.responding_time) return "Responding since " + clock(x.responding_time);
  return "Awaiting response status";
}

function clock(value) {
  try {
    var d = new Date(value);
    var h = d.getHours();
    var m = d.getMinutes();
    var suffix = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return h + ":" + (m < 10 ? "0" : "") + m + " " + suffix;
  } catch (e) { return ""; }
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
  x.textColor = MUTED;
  x.font = Font.systemFont(10);
}

function weatherLabel(code) {
  var map = {"0":"Clear","1":"Mostly Clear","2":"Partly Cloudy","3":"Cloudy","45":"Fog","48":"Freezing Fog","51":"Light Drizzle","53":"Drizzle","55":"Heavy Drizzle","61":"Light Rain","63":"Rain","65":"Heavy Rain","71":"Light Snow","73":"Snow","75":"Heavy Snow","80":"Rain Showers","81":"Showers","82":"Heavy Showers","95":"Thunderstorm","96":"Thunderstorm/Hail","99":"Severe Thunderstorm"};
  return map[String(code)] || "Weather";
}
