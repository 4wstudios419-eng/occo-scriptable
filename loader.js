const SCRIPT_URL = "https://occo-widget.netlify.app/widget.js";

const code = await new Request(SCRIPT_URL).loadString();

const AsyncFunction =
  Object.getPrototypeOf(async function(){}).constructor;

await new AsyncFunction(code)();
