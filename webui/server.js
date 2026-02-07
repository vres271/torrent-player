const express = require("express");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const app = express();
const port = Number(process.env.PORT || 8080);

const normalUrl = process.env.NORMAL_URL;
const vpnUrl = process.env.VPN_URL;

function providerToPath(provider) {
  const p = String(provider || "").trim();
  const map = {
    rutracker: "rutracker",
    RuTracker: "rutracker",
    kinozal: "kinozal",
    Kinozal: "kinozal",
    rutor: "rutor",
    RuTor: "rutor",
    nonameclub: "nonameclub",
    NoNameClub: "nonameclub",
  };
  return map[p] || p.toLowerCase();
}

async function torApiMagnet(provider, id) {
  const base = process.env.TORAPI_BASE;
  if (!base) throw new Error("Missing TORAPI_BASE env");

  const p = providerToPath(provider);
  const url = `${base}/api/search/id/${encodeURIComponent(p)}?query=${encodeURIComponent(id)}`;

  const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const data = await r.json();

  const item = Array.isArray(data) ? data[0] : data;
  const magnet = item?.Magnet || item?.magnet || null;
  if (!magnet) throw new Error("No magnet in TorAPI response");

  return magnet;
}

app.get("/", (req, res) => res.sendFile("/app/index.html"));

app.get("/api/test", async (req, res) => {
  const fetchJson = async (url) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return r.json();
  };

  const [normal, vpn] = await Promise.allSettled([fetchJson(normalUrl), fetchJson(vpnUrl)]);

  const toLine = (label, r) => {
    if (r.status === "fulfilled") {
      const d = r.value;
      return `${label}: ${d.ip} ${d.country} - ${d.ok ? "OK" : "FAIL"}`;
    }
    return `${label}: ERROR - ${String(r.reason?.message || r.reason)}`;
  };

  res.json({
    lines: [toLine("VPN", vpn), toLine("NORMAL", normal)],
    raw: { vpn, normal },
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

  const proxied = `http://amnezia-vpn:8090/torrent?url=${encodeURIComponent(url)}`;

  const r = await fetch(proxied, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    return res.status(502).send(text || `Upstream ${r.status}`);
  }

  res.statusCode = r.status;

  const ct = r.headers.get("content-type");
  if (ct) res.setHeader("content-type", ct);

  const cd = r.headers.get("content-disposition");
  if (cd) res.setHeader("content-disposition", cd);

  if (!r.body) {
    res.end();
    return;
  }

  await pipeline(Readable.fromWeb(r.body), res);
});

app.get("/api/magnet", async (req, res) => {
  const provider = String(req.query.provider || "").trim();
  const id = String(req.query.id || "").trim();

  if (!provider) return res.status(400).json({ ok: false, error: "Missing provider" });
  if (!id) return res.status(400).json({ ok: false, error: "Missing id" });

  try {
    const magnet = await torApiMagnet(provider, id);
    res.json({ ok: true, magnet });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.get("/api/qb/add", async (req, res) => {
  const provider = String(req.query.provider || "").trim();
  const id = String(req.query.id || "").trim();
  if (!provider || !id) return res.status(400).json({ ok: false, error: "Missing provider/id" });

  const qbBase = process.env.QB_URL || "http://qbittorrent:8081";
  const qbUser = process.env.QB_USER || "admin";
  const qbPass = process.env.QB_PASS || "";

  // Важно: Origin/Referer должны совпадать с Host (qbBase) иначе 401 [web:555]
  const qbOrigin = new URL(qbBase).origin;

  try {
    // 1) magnet
    const magnet = await torApiMagnet(provider, id);

    // 2) login -> SID cookie
    const loginRes = await fetch(`${qbBase}/api/v2/auth/login`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "origin": qbOrigin,
        "referer": qbOrigin + "/",
      },
      body: new URLSearchParams({ username: qbUser, password: qbPass }),
      signal: AbortSignal.timeout(10000),
    });

    const loginText = await loginRes.text().catch(() => "");
    const setCookie = loginRes.headers.get("set-cookie") || "";
    const sid = (setCookie.match(/SID=[^;]+/) || [])[0];

    if (!sid) {
      return res.status(502).json({
        ok: false,
        error: "qB login failed (no SID)",
        status: loginRes.status,
        body: loginText || null,
        hint: "Check qB logs for Origin/Referer mismatch; qbOrigin must match qbBase host:port.",
      });
    }

    // 3) add torrent with cookie
    const form = new FormData();
    form.append("urls", magnet);
    form.append("savepath", "/downloads");

    const addRes = await fetch(`${qbBase}/api/v2/torrents/add`, {
      method: "POST",
      headers: {
        "cookie": sid,
        "origin": qbOrigin,
        "referer": qbOrigin + "/",
      },
      body: form,
      signal: AbortSignal.timeout(15000),
    });

    const addText = await addRes.text().catch(() => "");
    res.json({ ok: addRes.ok, status: addRes.status, body: addText || null });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
});

app.listen(port, () => console.log(`webui on ${port}`));
