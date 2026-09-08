const CAD_URL = "https://occo-widget.netlify.app/cad/";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=41.5120&longitude=-82.9377&current=temperature_2m,apparent_temperature,weather_code&temperature_unit=fahrenheit";
const BADGE_URL = "https://drive.google.com/uc?export=view&id=19XiusP7KOBAozk2FhaszPZrkK9Ht9H7-";
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
w.setPadding(10, 12, 10, 12);

try {
  try {
    const badge = await new Request(BADGE_URL).loadImage();
    const row = w.addStack(); row.layoutHorizontally(); row.addSpacer();
    const img = row.addImage(badge); img.imageSize = new Size(46,46); row.addSpacer();
    w.addSpacer(2);
  } catch {}

  addHeader("OCCO / ATLAS");
  addSubheader("OPEN SCENE RESPONSES");
  w.addSpacer(6);

  const session = await getSavedSession();
  if (!session) {
    addStatus("Tap to open ATLAS CAD");
  } else {
    const items = await getOpenResponses(session);
    if (!items.length) addStatus("No open scene responses");
    else {
      for (const x of items.slice(0,3)) addResponse(x);
      if (items.length > 3) {
        const more = w.addText(`+${items.length-3} more`);
        more.textColor = Color.gray(); more.font = Font.systemFont(9);
      }
    }
  }

  const wx = await getWeatherSafe();
  if (wx) {
    w.addSpacer(6);
    const t = w.addText(`${wx.temp}°F${wx.feels===null?"":` • Feels ${wx.feels}°`}`);
    t.textColor = Color.white(); t.font = Font.boldSystemFont(12);
    const d = w.addText(wx.label); d.textColor = Color.gray(); d.font = Font.systemFont(8);
  }

  w.addSpacer();
  const foot = w.addText("Tap to open ATLAS CAD"); foot.textColor = new Color("#e8b832"); foot.font = Font.boldSystemFont(9);
} catch {
  addHeader("OCCO / ATLAS");
  addStatus("Tap to open ATLAS CAD");
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
  const notes=await getJson(`${SUPABASE_URL}/rest/v1/case_notification?case_id=in.${encodeURIComponent(ids)}&select=case_id,dispatch_location_description,dispatch_street_address,dispatch_city,dispatch_state,responding_time,on_scene_time,funeral_home_arrival_time,cleared_time,response_cancelled_time,scene_response_required`,session.access_token);
  const map=new Map((notes||[]).map(n=>[n.case_id,n]));
  const cutoff=Date.now()-48*3600000;
  return cases.map(c=>({...c,...(map.get(c.id)||{})}))
    .filter(x=>!x.cleared_time&&!x.response_cancelled_time)
    .filter(x=>x.responding_time||x.on_scene_time||x.funeral_home_arrival_time||x.scene_response_required===true||new Date(x.created_at).getTime()>=cutoff)
    .map(x=>({...x,stage:x.on_scene_time?"On Scene":x.responding_time?"Responding":x.funeral_home_arrival_time?"Funeral Home Arrived":"Pending Response"}));
}

async function getWeatherSafe(){
  try{const d=await new Request(WEATHER_URL).loadJSON();const c=d?.current;if(!c||typeof c.temperature_2m!=="number")return null;return{temp:Math.round(c.temperature_2m),feels:typeof c.apparent_temperature==="number"?Math.round(c.apparent_temperature):null,label:weatherLabel(c.weather_code)}}catch{return null;}
}

async function postJson(url,body){const r=new Request(url);r.method="POST";r.headers={apikey:SUPABASE_KEY,"Content-Type":"application/json"};r.body=JSON.stringify(body);const text=await r.loadString();let d=null;try{d=text?JSON.parse(text):null}catch{}if(r.response.statusCode>=300)throw new Error(d?.message||text||"Request failed");return d;}
async function getJson(url,token){const r=new Request(url);r.headers={apikey:SUPABASE_KEY,Authorization:`Bearer ${token}`};const text=await r.loadString();let d=null;try{d=text?JSON.parse(text):null}catch{}if(r.response.statusCode>=300)throw new Error(d?.message||text||"Request failed");return d;}
function addHeader(text){const x=w.addText(text);x.textColor=new Color("#e8b832");x.font=Font.boldSystemFont(15);x.centerAlignText();}
function addSubheader(text){const x=w.addText(text);x.textColor=Color.white();x.font=Font.mediumSystemFont(9);x.centerAlignText();}
function addStatus(text){const x=w.addText(text);x.textColor=Color.gray();x.font=Font.systemFont(10);x.centerAlignText();}
function addResponse(x){const a=w.addText(`${x.case_number} • ${x.stage}`);a.textColor=Color.white();a.font=Font.boldSystemFont(11);const place=[x.dispatch_location_description,x.dispatch_city].filter(Boolean).join(" • ");if(place){const b=w.addText(place);b.textColor=Color.gray();b.font=Font.systemFont(8);}w.addSpacer(3);}
function weatherLabel(code){const map={0:"Clear",1:"Mostly Clear",2:"Partly Cloudy",3:"Cloudy",45:"Fog",48:"Freezing Fog",51:"Light Drizzle",53:"Drizzle",55:"Heavy Drizzle",61:"Light Rain",63:"Rain",65:"Heavy Rain",71:"Light Snow",73:"Snow",75:"Heavy Snow",80:"Rain Showers",81:"Showers",82:"Heavy Showers",95:"Thunderstorm",96:"Thunderstorm/Hail",99:"Severe Thunderstorm"};return map[code]||"Weather Updating";}
