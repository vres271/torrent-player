const express = require("express");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const path = require('path');

const app = express();
const port = Number(process.env.PORT || 8080);

const normalUrl = process.env.NORMAL_URL;
const vpnUrl = process.env.VPN_URL;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========== Конфигурация ==========
const config = {
  qb: {
    base: process.env.QB_URL || "http://qbittorrent:8081",
    user: process.env.QB_USER || "admin",
    pass: process.env.QB_PASS || ""
  },
  torapi: {
    base: process.env.TORAPI_BASE
  }
};

// ========== Утилиты для qBittorrent ==========
async function withQbAuth(callback) {
  const qbBase = config.qb.base;
  const qbOrigin = new URL(qbBase).origin;
  
  const login = await qbLoginGetSid(qbBase, qbOrigin, config.qb.user, config.qb.pass);
  if (!login.ok) {
    throw { type: 'auth', error: "qB login failed (no SID)", status: login.status, body: login.body };
  }
  
  return await callback({ qbBase, qbOrigin, sid: login.sid });
}

async function qbFetch(path, options = {}) {
  return withQbAuth(async ({ qbBase, qbOrigin, sid }) => {
    const defaultHeaders = {
      "cookie": sid,
      "origin": qbOrigin,
      "referer": qbOrigin + "/",
      "accept": "*/*",
      "accept-language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
      "dnt": "1",
      "sec-ch-ua": '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin"
    };

    const fetchOptions = {
      method: options.method || 'GET',
      headers: { ...defaultHeaders, ...(options.headers || {}) },
      signal: AbortSignal.timeout(options.timeout || 10000),
      ...(options.body && { body: options.body })
    };

    const response = await fetch(`${qbBase}${path}`, fetchOptions);
    const text = await response.text().catch(() => "");
    
    return {
      ok: response.status === 200,
      status: response.status,
      body: text,
      headers: response.headers,
      response
    };
  });
}

async function qbPostForm(path, params) {
  const searchParams = new URLSearchParams(params);
  
  return qbFetch(path, {
    method: 'POST',
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    body: searchParams.toString()
  });
}

async function qbGetJson(pathWithQuery) {
  const result = await qbFetch(pathWithQuery);
  let json = null;
  try { json = JSON.parse(result.body); } catch {}
  return { ...result, json };
}

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
  const base = config.torapi.base;
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

function hashFromMagnet(magnet) {
  const m = String(magnet || "").match(/xt=urn:btih:([A-Za-z0-9]+)/i);
  return m ? m[1].toLowerCase() : null;
}

async function qbLoginGetSid(qbBase, qbOrigin, qbUser, qbPass) {
  const r = await fetch(`${qbBase}/api/v2/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "origin": qbOrigin,
      "referer": qbOrigin + "/",
    },
    body: new URLSearchParams({ username: qbUser, password: qbPass }),
    signal: AbortSignal.timeout(10000),
  });

  const text = await r.text().catch(() => "");
  const setCookie = r.headers.get("set-cookie") || "";
  const sid = (setCookie.match(/SID=[^;]+/) || [])[0];
  return { ok: Boolean(sid), sid, status: r.status, body: text || null };
}

// ========== Эндпоинты ==========

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

  const base = config.torapi.base;
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

// Новый эндпоинт для получения списка загрузок
app.get("/api/qb/downloads", async (req, res) => {
  try {
    const info = await qbGetJson("/api/v2/torrents/info");
    if (!info.ok) {
      return res.status(502).json({ ok: false, error: "Failed to get torrents info" });
    }
    res.json({ ok: true, torrents: info.json || [] });
  } catch (e) {
    if (e.type === 'auth') {
      res.status(502).json({ ok: false, error: e.error, status: e.status, body: e.body });
    } else {
      res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  }
});

// СТАРТ (возобновление) торрента - правильный эндпоинт /start
app.post("/api/qb/start", async (req, res) => {
  const { hash } = req.body;
  if (!hash) return res.status(400).json({ ok: false, error: "Missing hash" });

  try {
    const result = await qbPostForm("/api/v2/torrents/start", { hashes: hash });
    res.json(result);
  } catch (e) {
    handleQbError(res, e);
  }
});

// СТОП (пауза) торрента - правильный эндпоинт /stop
app.post("/api/qb/stop", async (req, res) => {
  const { hash } = req.body;
  if (!hash) return res.status(400).json({ ok: false, error: "Missing hash" });

  try {
    const result = await qbPostForm("/api/v2/torrents/stop", { hashes: hash });
    res.json(result);
  } catch (e) {
    handleQbError(res, e);
  }
});

// Удаление торрента
app.post("/api/qb/delete", async (req, res) => {
  const { hash, deleteFiles = true } = req.body;
  if (!hash) return res.status(400).json({ ok: false, error: "Missing hash" });

  try {
    const result = await qbPostForm("/api/v2/torrents/delete", { 
      hashes: hash, 
      deleteFiles: deleteFiles ? 'true' : 'false' 
    });
    res.json(result);
  } catch (e) {
    handleQbError(res, e);
  }
});

// Получение глобальной статистики qBittorrent
app.get("/api/qb/global", async (req, res) => {
  try {
    const info = await qbGetJson("/api/v2/transfer/info");
    if (!info.ok) {
      return res.status(502).json({ ok: false, error: "Failed to get transfer info" });
    }
    res.json({ ok: true, global: info.json || {} });
  } catch (e) {
    handleQbError(res, e);
  }
});

app.get("/api/qb/add", async (req, res) => {
  const provider = String(req.query.provider || "").trim();
  const id = String(req.query.id || "").trim();
  if (!provider || !id) return res.status(400).json({ ok: false, error: "Missing provider/id" });

  try {
    // 1) Magnet
    const magnet = await torApiMagnet(provider, id);
    const hash = hashFromMagnet(magnet);
    if (!hash) return res.status(502).json({ ok: false, error: "Cannot extract hash from magnet (btih)" });

    // 2) Добавление торрента (используем withQbAuth напрямую для FormData)
    const addResult = await withQbAuth(async ({ qbBase, qbOrigin, sid }) => {
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
      return { ok: addRes.ok, status: addRes.status, body: addText };
    });

    if (!addResult.ok) {
      return res.status(502).json({ ok: false, error: "qB add failed", status: addResult.status, body: addResult.body });
    }

    // 3) Чтение флагов
    const info = await qbGetJson(`/api/v2/torrents/info?hashes=${encodeURIComponent(hash)}`);

    if (!info.ok || !Array.isArray(info.json) || info.json.length === 0) {
      return res.json({
        ok: true,
        hash,
        added: addResult,
        warn: "Added, but cannot read torrent info yet (try again in a second).",
        infoStatus: info.status,
      });
    }

    const t = info.json[0];
    const needSeqOn = (t.seq_dl !== true);
    const needFirstLastOn = (t.f_l_piece_prio !== true);

    const actions = [];
    if (needSeqOn) {
      actions.push(["toggleSequentialDownload", await qbPostForm(
        "/api/v2/torrents/toggleSequentialDownload",
        { hashes: hash }
      )]);
    }

    if (needFirstLastOn) {
      actions.push(["toggleFirstLastPiecePrio", await qbPostForm(
        "/api/v2/torrents/toggleFirstLastPiecePrio",
        { hashes: hash }
      )]);
    }

    res.json({
      ok: true,
      hash,
      added: addResult,
      before: { seq_dl: t.seq_dl, f_l_piece_prio: t.f_l_piece_prio },
      actions: Object.fromEntries(actions),
    });
  } catch (e) {
    handleQbError(res, e);
  }
});

// Получить список файлов торрента
app.get("/api/qb/files", async (req, res) => {
  const { hash } = req.query;
  if (!hash) return res.status(400).json({ ok: false, error: "Missing hash" });

  try {
    const result = await qbGetJson(`/api/v2/torrents/files?hash=${encodeURIComponent(hash)}`);
    if (!result.ok) {
      return res.status(502).json({ ok: false, error: "Failed to get files" });
    }
    res.json({ ok: true, files: result.json || [] });
  } catch (e) {
    handleQbError(res, e);
  }
});

// Установить приоритеты файлов (один или несколько файлов с одинаковым приоритетом)
app.post("/api/qb/setfileprio", async (req, res) => {
  const { hash, fileIds, priority } = req.body; // fileIds - массив чисел
  if (!hash || !Array.isArray(fileIds) || fileIds.length === 0 || priority === undefined) {
    return res.status(400).json({ ok: false, error: "Missing hash, fileIds, or priority" });
  }

  try {
    // qBittorrent API принимает ID через вертикальную черту
    const params = {
      hash: hash,
      id: fileIds.join('|'),
      priority: priority
    };
    const result = await qbPostForm("/api/v2/torrents/filePrio", params);
    res.json(result);
  } catch (e) {
    handleQbError(res, e);
  }
});

// ========== Обработчик ошибок ==========
function handleQbError(res, e) {
  if (e.type === 'auth') {
    res.status(502).json({ ok: false, error: e.error, status: e.status, body: e.body });
  } else {
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}

app.listen(port, () => console.log(`webui on ${port}`));