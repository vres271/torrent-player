const express = require("express");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const app = express();
const port = Number(process.env.PORT || 8080);

const normalUrl = process.env.NORMAL_URL;
const vpnUrl = process.env.VPN_URL;

app.get("/", (req, res) => res.sendFile("/app/index.html"));

app.get("/api/test", async (req, res) => {
  const fetchJson = async (url) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return r.json();
  };

  const [normal, vpn] = await Promise.allSettled([
    fetchJson(normalUrl),
    fetchJson(vpnUrl),
  ]);

  const toLine = (label, r) => {
    if (r.status === "fulfilled") {
      const d = r.value;
      return `${label}: ${d.ip} ${d.country} - ${d.ok ? "OK" : "FAIL"}`;
    }
    return `${label}: ERROR - ${String(r.reason?.message || r.reason)}`;
  };

  res.json({
    lines: [
      toLine("VPN", vpn),
      toLine("NORMAL", normal),
    ],
    raw: { vpn, normal }
  });
});

app.get("/api/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  const provider = String(req.query.provider || "all").trim();

  if (!q) return res.status(400).json({ ok: false, error: "Missing q" });

  const base = process.env.TORAPI_BASE; // например http://amnezia-vpn:8443
  const url = `${base}/api/search/title/${encodeURIComponent(provider)}?query=${encodeURIComponent(q)}`;

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const text = await r.text();

    // TorAPI может вернуть JSON; если нет — отдадим как текст
    try {
      res.json({ ok: true, provider, query: q, data: JSON.parse(text) });
    } catch {
      res.json({ ok: true, provider, query: q, raw: text });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});


app.get("/api/torrent", async (req, res) => {
  const url = String(req.query.url || "");
  if (!url) return res.status(400).json({ ok: false, error: "Missing url" });

  // dl-proxy в VPN netns доступен как amnezia-vpn:8090
  const proxied = `http://amnezia-vpn:8090/torrent?url=${encodeURIComponent(url)}`;

  const r = await fetch(proxied, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    return res.status(502).send(text || `Upstream ${r.status}`);
  }

  // стримим клиенту
  res.statusCode = r.status;

  // безопасные заголовки
  const ct = r.headers.get("content-type");
  if (ct) res.setHeader("content-type", ct);

  const cd = r.headers.get("content-disposition");
  if (cd) res.setHeader("content-disposition", cd);

  // НЕ ставь content-length/transfer-encoding/content-encoding — пусть Node сам решит
  // и не копируй connection/keep-alive и т.п.

  if (!r.body) { res.end(); return; }

  await pipeline(Readable.fromWeb(r.body), res);

});

app.get("/api/magnet", async (req, res) => {
  const provider = String(req.query.provider || "").trim();
  const id = String(req.query.id || "").trim();

  if (!provider) return res.status(400).json({ ok: false, error: "Missing provider" });
  if (!id) return res.status(400).json({ ok: false, error: "Missing id" });

  const base = process.env.TORAPI_BASE;
  if (!base) return res.status(500).json({ ok: false, error: "Missing TORAPI_BASE env" });

  // Нормализуем provider: в UI у тебя "RuTracker", а TorAPI в path использует "rutracker"
  const providerMap = {
    rutracker: "rutracker",
    RuTracker: "rutracker",
    kinozal: "kinozal",
    Kinozal: "kinozal",
    rutor: "rutor",
    RuTor: "rutor",
    nonameclub: "nonameclub",
    NoNameClub: "nonameclub",
  };

  const p = providerMap[provider] || provider.toLowerCase();

  // TorAPI docs: /api/search/id/<provider>?query=<id> [web:407]
  const url = `${base}/api/search/id/${encodeURIComponent(p)}?query=${encodeURIComponent(id)}`;

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const data = await r.json();

    const item = Array.isArray(data) ? data[0] : data;
    const magnet = item?.Magnet || item?.magnet || null;

    if (!magnet) return res.status(502).json({ ok: false, error: "No magnet in TorAPI response" });

    res.json({ ok: true, magnet });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.listen(port, () => console.log(`webui on ${port}`));
