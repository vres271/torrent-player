const express = require("express");

const app = express();
const port = Number(process.env.PORT || 3000);
const mode = process.env.MODE || "APP";

app.get("/test", async (req, res) => {
  try {
    const r = await fetch("https://ipinfo.io/json", { signal: AbortSignal.timeout(8000) });
    const data = await r.json();
    res.json({ mode, ip: data.ip, country: data.country, ok: true , hello: true});
  } catch (e) {
    res.status(500).json({ mode, ok: false, error: String(e?.message || e) });
  }
});

app.listen(port, () => console.log(`${mode} listening on ${port}`));
