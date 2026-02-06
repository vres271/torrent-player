const http = require("http");
const { URL } = require("url");

const PORT = 8090;

function bad(res, code, msg) {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ ok: false, error: msg }));
}

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost");
    if (u.pathname !== "/torrent") return bad(res, 404, "Not found");

    const target = u.searchParams.get("url");
    if (!target) return bad(res, 400, "Missing url");

    // минимальная защита: разрешаем только rutracker dl.php
    const t = new URL(target);
    if (t.hostname !== "rutracker.org" || t.pathname !== "/forum/dl.php") {
      return bad(res, 400, "Only rutracker dl.php supported");
    }

    const r = await fetch(target, {
      redirect: "manual",
      headers: {
        // иногда помогает выглядеть как браузер
        "user-agent": "Mozilla/5.0",
        "accept": "application/x-bittorrent,*/*",
      },
    });

    if (!r.ok && (r.status < 300 || r.status >= 400)) {
      return bad(res, 502, `Upstream status ${r.status}`);
    }

    // Имя файла (если есть)
    const cd = r.headers.get("content-disposition");
    const ct = r.headers.get("content-type") || "application/x-bittorrent";
    res.writeHead(200, {
      "content-type": ct,
      "content-disposition": cd || 'attachment; filename="download.torrent"',
    });

    // Стримим тело наружу
    if (!r.body) return bad(res, 502, "No body");
    const reader = r.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (e) {
    bad(res, 500, String(e?.message || e));
  }
}).listen(PORT, () => console.log("dl-proxy on", PORT));
