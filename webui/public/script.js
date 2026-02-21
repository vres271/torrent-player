const testOut = document.getElementById('testOut');
const testStatus = document.getElementById('testStatus');

const searchOut = document.getElementById('searchOut');
const searchStatus = document.getElementById('searchStatus');
const searchMeta = document.getElementById('searchMeta');
const tableWrap = document.getElementById('tableWrap');
const q = document.getElementById('q');
const onlyVideo = document.getElementById('onlyVideo');

const qbLink = document.getElementById('qbLink');
qbLink.href = `${location.protocol}//${location.hostname}:8081/`;

// Downloads elements
const downloadsTbody = document.getElementById('downloadsTbody');
const refreshBtn = document.getElementById('refreshDownloads');
const toggleAutoRefresh = document.getElementById('toggleAutoRefresh');
const lastUpdateSpan = document.getElementById('downloadsLastUpdate');

let lastRaw = null;
let autoRefreshInterval = null;
let autoRefreshEnabled = true;
let isRefreshing = false;

// Format bytes to human readable
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0 || !bytes) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Format speed
function formatSpeed(bytesPerSec) {
    if (!bytesPerSec || bytesPerSec === 0) return '0 B/s';
    return formatBytes(bytesPerSec) + '/s';
}

// Format ETA
function formatETA(eta) {
    if (eta === 8640000) return '∞';
    if (eta < 0) return '0s';
    if (eta < 60) return eta + 's';
    if (eta < 3600) return Math.floor(eta / 60) + 'm ' + (eta % 60) + 's';
    if (eta < 86400) return Math.floor(eta / 3600) + 'h ' + Math.floor((eta % 3600) / 60) + 'm';
    return Math.floor(eta / 86400) + 'd ' + Math.floor((eta % 86400) / 3600) + 'h';
}

// Get status class
function getStatusClass(state) {
    const stateLower = (state || '').toLowerCase();
    if (stateLower.includes('download')) return 'status-downloading';
    if (stateLower.includes('seed')) return 'status-seeding';
    if (stateLower.includes('pause')) return 'status-paused';
    if (stateLower.includes('error') || stateLower.includes('fault')) return 'status-error';
    return 'status-waiting';
}

// Format status for display
function formatStatus(state) {
    if (!state) return 'Unknown';
    return state.split('_').map(word =>
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    ).join(' ');
}

// Load downloads from qBittorrent
async function loadDownloads() {
    if (isRefreshing) return;

    isRefreshing = true;
    refreshBtn.classList.add('refreshing');
    refreshBtn.textContent = '🔄 Refreshing...';

    try {
        const response = await fetch('/api/qb/downloads');
        const data = await response.json();

        if (data.ok && Array.isArray(data.torrents)) {
            renderDownloads(data.torrents);
            lastUpdateSpan.textContent = `Last update: ${new Date().toLocaleTimeString()}`;
        } else {
            downloadsTbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: #b00;">Error loading downloads: ${data.error || 'Unknown error'}</td></tr>`;
        }
    } catch (e) {
        downloadsTbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: #b00;">Error: ${e.message}</td></tr>`;
    } finally {
        isRefreshing = false;
        refreshBtn.classList.remove('refreshing');
        refreshBtn.textContent = '🔄 Refresh';
    }
}

// Render downloads table
function renderDownloads(torrents) {
    if (!torrents.length) {
        downloadsTbody.innerHTML = '<tr><td colspan="10" style="text-align: center;">No active downloads</td></tr>';
        return;
    }

    const rows = torrents.map(t => {
        const progress = t.progress * 100;
        const downloaded = t.completed || t.downloaded || (t.total_size * t.progress);
        const size = t.total_size || t.size || 0;
        const dlspeed = t.dlspeed || 0;
        const upspeed = t.upspeed || 0;
        const num_leechs = t.num_leechs || 0;
        const num_seeds = t.num_seeds || 0;
        const eta = t.eta || 0;
        const state = t.state || 'unknown';
        const name = t.name || 'Unknown';
        const hash = t.hash || '';

        return `
                <tr>
                    <td class="name" title="${esc(name)}">${esc(name.substring(0, 60))}${name.length > 60 ? '...' : ''}</td>
                    <td>${formatBytes(size)}</td>
                    <td style="min-width: 150px;">
                        <div class="progress-bar-container">
                            <div class="progress-bar" style="width: ${progress}%;"></div>
                            <span class="progress-text">${progress.toFixed(1)}%</span>
                        </div>
                    </td>
                    <td>${formatBytes(downloaded)}</td>
                    <td>
                        <span class="speed-down">⬇️ ${formatSpeed(dlspeed)}</span><br>
                        <span class="speed-up">⬆️ ${formatSpeed(upspeed)}</span>
                    </td>
                    <td>${num_leechs}</td>
                    <td>${num_seeds}</td>
                    <td><span class="status-badge ${getStatusClass(state)}">${formatStatus(state)}</span></td>
                    <td>${formatETA(eta)}</td>
                    <td class="downloads-actions">
                        <button onclick="pauseTorrent('${hash}')" title="Pause">⏸️</button>
                        <button onclick="resumeTorrent('${hash}')" title="Resume">▶️</button>
                        <button onclick="deleteTorrent('${hash}')" title="Delete">🗑️</button>
                    </td>
                </tr>
                `;
    }).join('');

    downloadsTbody.innerHTML = rows;
}

// Torrent actions
window.pauseTorrent = async (hash) => {
    try {
        const response = await fetch('/api/qb/stop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hash })
        });
        const result = await response.json();
        if (result.ok) {
            loadDownloads();
        } else {
            alert('Error pausing torrent: ' + (result.body || result.error));
        }
    } catch (e) {
        alert('Error pausing torrent: ' + e.message);
    }
};

window.resumeTorrent = async (hash) => {
    try {
        const response = await fetch('/api/qb/start', {  // было /api/qb/resume
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hash })
        });
        const result = await response.json();
        if (result.ok) {
            loadDownloads();
        } else {
            alert('Error resuming torrent: ' + (result.body || result.error));
        }
    } catch (e) {
        alert('Error resuming torrent: ' + e.message);
    }
};

window.deleteTorrent = async (hash) => {
    if (!confirm('Delete this torrent?')) return;
    try {
        await fetch('/api/qb/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hash })
        });
        loadDownloads();
    } catch (e) {
        alert('Error deleting torrent: ' + e.message);
    }
};

// Auto-refresh toggle
toggleAutoRefresh.onclick = () => {
    autoRefreshEnabled = !autoRefreshEnabled;
    toggleAutoRefresh.textContent = autoRefreshEnabled ? '⏸️ Pause auto-refresh' : '▶️ Start auto-refresh';

    if (autoRefreshEnabled) {
        loadDownloads();
    }
};

// Manual refresh
refreshBtn.onclick = loadDownloads;

async function prettyJson(url) {
    const r = await fetch(url);
    const t = await r.text();
    try { return JSON.stringify(JSON.parse(t), null, 2); }
    catch { return t; }
}

function parseSizeToBytes(sizeStr) {
    if (!sizeStr) return 0;
    const s = String(sizeStr).replace(/\u00A0/g, ' ').replace(',', '.').trim();
    const m = s.match(/([\d.]+)\s*([KMGTP]?B)/i);
    if (!m) return 0;
    const num = Number(m[1]);
    const unit = m[2].toUpperCase();
    const mult = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4, PB: 1024 ** 5 };
    return Math.round((Number.isFinite(num) ? num : 0) * (mult[unit] || 1));
}

function isProbablyVideo(item) {
    const cat = String(item.Category || '').toLowerCase();
    const name = String(item.Name || '').toLowerCase();
    const text = cat + ' ' + name;

    const nonVideo = [
        'саундтрек', 'soundtrack',
        'mp3', 'flac', 'aac', 'music',
        'аудиокнига', 'audiobook',
        'pdf', 'djvu', 'xbox',
        'software', 'linux', 'macos',
        'RePack', 'amd64', 'Portable', 'DLCs',
    ];

    if (nonVideo.some(w => text.includes(w))) return false;

    const videoHints = [
        'hdrip', 'bdrip', 'bluray', 'web-dl', 'webrip', 'dvdrip',
        'hdtv', 'uhd', '4k', '1080', '720',
        'x264', 'x265', 'hevc', 'avc',
        'remux', 'imaxi', 'imax', 'dts', 'ac3'
    ];

    if (videoHints.some(w => text.includes(w))) return true;
    return true;
}

async function onMagnetClick(ev, provider, id) {
    ev.preventDefault();
    ev.stopPropagation();

    if (!provider || !id) {
        alert("No provider/id for magnet");
        return;
    }

    const url = `/api/magnet?provider=${encodeURIComponent(provider)}&id=${encodeURIComponent(id)}`;

    try {
        const r = await fetch(url);

        let raw;
        const ct = (r.headers.get("content-type") || "").toLowerCase();
        if (ct.includes("application/json")) raw = await r.json();
        else {
            const text = await r.text();
            try { raw = JSON.parse(text); } catch { raw = { ok: false, error: text }; }
        }

        if (!r.ok) throw new Error(raw?.error || `HTTP ${r.status}`);
        if (!raw?.ok) throw new Error(raw?.error || "magnet error");

        const magnet = raw.magnet;
        if (!magnet) throw new Error("No magnet in response");

        window.location.href = magnet;
    } catch (e) {
        alert(String(e?.message || e));
    }
}

async function addToQb(ev, provider, id) {
    ev.preventDefault();
    const qbUrl = `/api/qb/add?provider=${encodeURIComponent(provider)}&id=${encodeURIComponent(id)}`;
    const r = await fetch(qbUrl);
    const res = await r.json();
    if (r.ok) {
        alert("✅ Added to qB");
        loadDownloads(); // Refresh downloads list after adding
    } else {
        alert(`❌ qB: ${res.body}`);
    }
}

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}

function renderTable(items) {
    if (!items.length) {
        tableWrap.innerHTML = "<div>Ничего не найдено.</div>";
        return;
    }

    const rows = items.map((x, i) => {
        const localTorrent = x.Torrent ? `/api/torrent?url=${encodeURIComponent(x.Torrent)}` : '';

        return `
            <tr>
                <td>${i + 1}</td>
                <td>${esc(x.provider)}</td>
                <td class="name">${esc(x.Name)}</td>
                <td>${esc(x.Size || '')}</td>
                <td>${esc(x.Seeds ?? '')}</td>
                <td>${esc(x.Peers ?? '')}</td>
                <td>${esc(x.Date ?? '')}</td>
                <td>${x.Url ? `<a href="${esc(x.Url)}" target="_blank" rel="noreferrer">topic</a>` : ''}</td>
                <td>
                    <div class="tlinks">
                        ${x.Torrent ? `<a href="${esc(x.Torrent)}" target="_blank" rel="noreferrer" title="Torrent file">F</a>` : ''}
                        ${x.Id ? ` <a href="#" title="Get magnet" onclick="onMagnetClick(event,'${esc(x.provider)}','${esc(x.Id)}')">M</a>` : ''}
                        ${x.Id ? ` <a href="#" title="Add to qB" onclick="addToQb(event,'${esc(x.provider)}','${esc(x.Id)}')">Q</a>` : ''}
                    </div>
                </td>
            </tr>
            `;
    }).join('');

    tableWrap.innerHTML = `
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Provider</th>
                <th>Name</th>
                <th>Size</th>
                <th>Seeds</th>
                <th>Peers</th>
                <th>Date</th>
                <th>Url</th>
                <th>Torrent</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        `;
}

function flattenTorApiResponse(raw) {
    const data = (raw && raw.data && raw.data.RuTracker !== undefined) ? raw.data
        : (raw && raw.data && raw.data.data) ? raw.data.data
            : null;

    if (!data || typeof data !== 'object') return [];

    const out = [];
    for (const [provider, val] of Object.entries(data)) {
        if (Array.isArray(val)) {
            for (const item of val) out.push({ provider, ...item });
        } else {
            // игнорируем ошибки провайдеров
        }
    }
    return out;
}

document.getElementById('btnTest').onclick = async () => {
    testStatus.textContent = 'Testing...';
    testOut.textContent = '';
    try {
        testOut.textContent = await prettyJson('/api/test');
        testStatus.textContent = 'OK';
        testStatus.className = 'ok';
    } catch (e) {
        testStatus.textContent = 'ERROR';
        testStatus.className = 'bad';
        testOut.textContent = String(e?.message || e);
    }
};

document.getElementById('btnRaw').onclick = async () => {
    searchOut.style.display = 'block';
    tableWrap.innerHTML = '';
    searchMeta.textContent = '';
    searchOut.textContent = lastRaw ? JSON.stringify(lastRaw, null, 2) : 'No data yet';
};

document.getElementById('btnSearch').onclick = async () => {
    const query = q.value.trim();
    if (!query) {
        searchStatus.textContent = 'Enter query';
        searchStatus.className = 'bad';
        return;
    }

    searchStatus.textContent = 'Searching...';
    searchStatus.className = '';
    searchMeta.textContent = '';
    searchOut.style.display = 'none';
    searchOut.textContent = '';
    tableWrap.innerHTML = '';

    try {
        const url = '/api/search?q=' + encodeURIComponent(query) + '&provider=all';
        const r = await fetch(url);
        const raw = await r.json();
        lastRaw = raw;

        if (!raw.ok) {
            searchStatus.textContent = 'ERROR';
            searchStatus.className = 'bad';
            searchOut.style.display = 'block';
            searchOut.textContent = JSON.stringify(raw, null, 2);
            return;
        }

        let items = flattenTorApiResponse(raw);

        if (onlyVideo.checked) {
            items = items.filter(isProbablyVideo);
        }

        items.forEach(x => x.__bytes = parseSizeToBytes(x.Size));
        items.sort((a, b) => (b.__bytes - a.__bytes));

        searchMeta.textContent = `Found: ${items.length} items. Sorted by Size (desc).`;
        renderTable(items);

        searchStatus.textContent = 'OK';
        searchStatus.className = 'ok';
    } catch (e) {
        searchStatus.textContent = 'ERROR';
        searchStatus.className = 'bad';
        searchOut.style.display = 'block';
        searchOut.textContent = String(e?.message || e);
    }
};

// Load downloads on page load
loadDownloads();

// Auto-refresh every 5 seconds
setInterval(() => {
    if (autoRefreshEnabled) {
        loadDownloads();
    }
}, 5000);