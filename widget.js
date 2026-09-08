const CAD_URL = "https://occo-widget.netlify.app/cad/";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=41.5120&longitude=-82.9377&current=temperature_2m,apparent_temperature,weather_code&temperature_unit=fahrenheit";
const SUPABASE_URL = "https://movapecdjjddkvavyprt.supabase.co";
const SUPABASE_KEY = "sb_publishable_zdjYToMI0h51qYx179V2cQ_wJJoRt5k";
const SESSION_KEY = "ATLAS_CAD_WIDGET_SESSION_V1";

if (!config.runsInWidget && !config.runsInAccessoryWidget) {
  Safari.open(CAD_URL);
  Script.complete();
  return;
}

const w = new ListWidget();
w.url = CAD_URL;
w.backgroundColor = new Color("#0a0a0a");
w.setPadding(12, 14, 11, 14);

try {
  const session = await getSavedSession();
  const items = session ? await getOpenResponses(session) : [];
  const wx = await getWeatherSafe();

  const head = w.addStack();
  head.layoutHorizontally();
  head.centerAlignContent();
  const brand = head.addText("ATLAS CAD");
  brand.textColor = Color.white();
  brand.font = Font.boldSystemFont(14);
  head.addSpacer();
  const count = head.addText(String(items.length));
  count.textColor = new Color("#111111");
  count.font = Font.boldSystemFont(10);
  count.backgroundColor = new Color("#e8b832");
  count.cornerRadius = 9;
  count.textOpacity = 1;

  w.addSpacer(8);

  if (!session) {
    addStatus("Tap to sign in to ATLAS CAD");
  } else if (!items.length) {
    addStatus("No open scene responses");
  } else {
    const limit = config.widgetFamily === "large" ? 4 : config.widgetFamily === "small" ? 1 : 2;
    items.slice(0, limit).forEach(addResponse);
    if (items.length > limit && config.widgetFamily !== "small") {
      const more = w.addText(`+${items.length - limit} more response${items.length - limit === 1 ? "" : "s"}`);
      more.textColor = Color.gray();
      more.font = Font.systemFont(9);
    }
  }

  w.addSpacer();
  const footer = w.addStack();
  footer.layoutHorizontally();
  footer.centerAlignContent();
  if (wx) {
    const weather = footer.addText(`${wx.temp}° · ${wx.label}`);
    weather.textColor = Color.gray();
    weather.font = Font.systemFont(10);
  }
  footer.addSpacer();
  const open = footer.addText("OPEN CAD ›");
  open.textColor = new Color("#e8b832");
  open.font = Font.boldSystemFont(10);
} catch {
  const brand = w.addText("ATLAS CAD");
  brand.textColor = Color.white();
  brand.font = Font.boldSystemFont(14);
  w.addSpacer(8);
  addStatus("Tap to open CAD");
}

Script.setWidget(w);
Script.complete();

async function getSavedSession(){
  if(!Keychain.contains(SESSION_KEY)) return null;
  try {
    let s = JSON.parse(Keychain.get(SESSION_KEY));
    if (s?.access_token && Date.now() < Number(s.expires_at||0)-60000) return s;
    if (!s?.refresh_token) return null;
    const r = await postJson(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,{refresh_token:s.refresh_token});
    s = {access_token:r.access_token,refresh_token:r.refresh_token,user:r.user,expires_at:Date.now()+Number(r.expires_in||3600)*1000};
    Keychain.set(SESSION_KEY,JSON.stringify(s));
    return s;
  } catch { return null; }
}

async function getOpenResponses(session){
  const uid=session?.user?.id; if(!uid)return[];
  const cases=await getJson(`${SUPABASE_URL}/rest/v1/cases?lead_investigator_id=eq.${uid}&status=eq.open&select=id,case_number,created_at&order=created_at.desc&limit=12`,session.access_token);
  if(!cases?.length)return[];
  const ids=`(${cases.map(x=>x.id).join(",")})`;
  const notes=await getJson(`${SUPABASE_URL}/rest/v1/case_notification?case_id=in.${encodeURIComponent(ids)}&select=case_id,dispatch_location_description,dispatch_street_address,dispatch_city,dispatch_state,responding_time,on_scene_time,cleared_time,response_cancelled_time,scene_response_required`,session.access_token);
  const map=new Map((notes||[]).map(n=>[n.case_id,n]));
  const cutoff=Date.now()-48*3600000;
  return cases.map(c=>({...c,...(map.get(c.id)||{})}))
    .filter(x=>!x.cleared_time&&!x.response_cancelled_time)
    .filter(x=>x.responding_time||x.on_scene_time||x.scene_response_required===true||new Date(x.created_at).getTime()>=cutoff)
    .map(x=>({...x,stage:x.on_scene_time?"ON SCENE":x.responding_time?"EN ROUTE":"PENDING"}));
}

async function getWeatherSafe(){
  try{const d=await new Request(WEATHER_URL).loadJSON();const c=d?.current;if(!c||typeof c.temperature_2m!=="number")return null;return{temp:Math.round(c.temperature_2m),label:weatherLabel(c.weather_code)}}catch{return null;}
}

async function postJson(url,body){const r=new Request(url);r.method="POST";r.headers={apikey:SUPABASE_KEY,"Content-Type":"application/json"};r.body=JSON.stringify(body);const text=await r.loadString();let d=null;try{d=text?JSON.parse(text):null}catch{}if(r.response.statusCode>=300)throw new Error(d?.message||text||"Request failed");return d;}
async function getJson(url,token){const r=new Request(url);r.headers={apikey:SUPABASE_KEY,Authorization:`Bearer ${token}`};const text=await r.loadString();let d=null;try{d=text?JSON.parse(text):null}catch{}if(r.response.statusCode>=300)throw new Error(d?.message||text||"Request failed");return d;}
function addStatus(text){const x=w.addText(text);x.textColor=Color.gray();x.font=Font.systemFont(10);}
function addResponse(x){
  const row=w.addStack();row.layoutHorizontally();row.centerAlignContent();
  const left=row.addStack();left.layoutVertically();left.size=new Size(0,0);
  const num=left.addText(x.case_number||"ATLAS CASE");num.textColor=Color.white();num.font=Font.boldSystemFont(11);
  const place=[x.dispatch_location_description,x.dispatch_street_address,x.dispatch_city].filter(Boolean).join(" · ")||"Location pending";
  const addr=left.addText(place);addr.textColor=Color.gray();addr.font=Font.systemFont(9);addr.lineLimit=1;
  row.addSpacer(8);
  const stage=row.addText(x.stage);stage.textColor=new Color("#e8b832");stage.font=Font.boldSystemFont(9);stage.lineLimit=1;
  w.addSpacer(7);
}
function weatherLabel(code){const map={0:"Clear",1:"Mostly Clear",2:"Partly Cloudy",3:"Cloudy",45:"Fog",48:"Freezing Fog",51:"Light Drizzle",53:"Drizzle",55:"Heavy Drizzle",61:"Light Rain",63:"Rain",65:"Heavy Rain",71:"Light Snow",73:"Snow",75:"Heavy Snow",80:"Rain Showers",81:"Showers",82:"Heavy Showers",95:"Thunderstorm",96:"Thunderstorm/Hail",99:"Severe Thunderstorm"};return map[code]||"Weather";}
