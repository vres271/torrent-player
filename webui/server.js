const express = require("express");

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

  // Пробрасываем заголовки, чтобы браузер скачал файл
  res.setHeader("content-type", r.headers.get("content-type") || "application/x-bittorrent");
  const cd = r.headers.get("content-disposition");
  if (cd) res.setHeader("content-disposition", cd);

  // стримим клиенту
  r.body.pipeTo(WritableStreamFromNode(res));
});


app.listen(port, () => console.log(`webui on ${port}`));
