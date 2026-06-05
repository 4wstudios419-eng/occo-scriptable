const DASHBOARD_URL = "https://script.google.com/macros/s/AKfycbxjqt_Z5iNL6Ny_JbAyJzIYs6zMN3Zz2NshcJjJb9eGY_1xt91JoN7sYTmE4qoLg_d2pg/exec?action=dashboard";

const WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=41.5120&longitude=-82.9377&current=temperature_2m,apparent_temperature,weather_code&temperature_unit=fahrenheit";

const BADGE_URL = "https://drive.google.com/uc?export=view&id=19XiusP7KOBAozk2FhaszPZrkK9Ht9H7-";

let w = new ListWidget();
w.url = "https://occoops.netlify.app/";
w.backgroundColor = new Color("#0a0a0a");
w.setPadding(12, 12, 12, 12);

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
  badgeOuter.layoutHorizontally();
  badgeOuter.addSpacer();

  const badgeImg = badgeOuter.addImage(badge);
  badgeImg.imageSize = new Size(82, 82);

  badgeOuter.addSpacer();

  w.addSpacer(4);

  addHeader("OTTAWA COUNTY");
  addSubheader("CORONER'S OFFICE");

  w.addSpacer(8);

  addBig("Next Case", data.nextCaseNumber);

  w.addSpacer(6);

  addRow("On Call", data.onCallInvestigator);
  addRow("Funeral Home", data.funeralHomeOfMonth);

  if (data.autopsyTox) {
    addRow("Pending", data.autopsyTox.pending);
    addRow("Complete", data.autopsyTox.complete);
  }

  w.addSpacer(8);

  addWeather(temp, feels, wx);

  w.addSpacer();

  addFooter("Updated " + formatTime(data.updatedAt));

} catch (err) {
  addHeader("OCCO");
  w.addSpacer(8);

  let error = w.addText(String(err));
  error.textColor = Color.red();
  error.font = Font.systemFont(10);
}

Script.setWidget(w);
Script.complete();

function addHeader(text) {
  let line = w.addText(text);
  line.textColor = new Color("#e8b832");
  line.font = Font.boldSystemFont(16);
  line.centerAlignText();
}

function addSubheader(text) {
  let line = w.addText(text);
  line.textColor = Color.white();
  line.font = Font.mediumSystemFont(11);
  line.centerAlignText();
}

function addBig(label, value) {
  let lbl = w.addText(label);
  lbl.textColor = Color.gray();
  lbl.font = Font.systemFont(10);

  let val = w.addText(value || "—");
  val.textColor = Color.white();
  val.font = Font.boldSystemFont(28);
}

function addRow(label, value) {
  let row = w.addText(`${label}: ${value || "—"}`);
  row.textColor = Color.white();
  row.font = Font.systemFont(12);
}

function addWeather(temp, feels, label) {
  let title = w.addText("Weather");
  title.textColor = new Color("#e8b832");
  title.font = Font.boldSystemFont(12);

  let line = w.addText(`${temp}°F • Feels ${feels}°`);
  line.textColor = Color.white();
  line.font = Font.boldSystemFont(15);

  let desc = w.addText(label);
  desc.textColor = Color.gray();
  desc.font = Font.systemFont(10);
}

function addFooter(text) {
  let line = w.addText(text);
  line.textColor = Color.gray();
  line.font = Font.systemFont(9);
}

function formatTime(value) {
  if (!value) return "—";

  try {
    return new Date(value).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit"
    });
  } catch {
    return "—";
  }
}

function weatherLabel(code) {
  const map = {
    0: "Clear",
    1: "Mostly Clear",
    2: "Partly Cloudy",
    3: "Cloudy",
    45: "Fog",
    48: "Freezing Fog",
    51: "Light Drizzle",
    53: "Drizzle",
    55: "Heavy Drizzle",
    61: "Light Rain",
    63: "Rain",
    65: "Heavy Rain",
    71: "Light Snow",
    73: "Snow",
    75: "Heavy Snow",
    80: "Rain Showers",
    81: "Showers",
    82: "Heavy Showers",
    95: "Thunderstorm",
    96: "Thunderstorm/Hail",
    99: "Severe Thunderstorm"
  };

  return map[code] || "Weather Updating";
}
