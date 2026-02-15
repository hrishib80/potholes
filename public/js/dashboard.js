// ═══════════════════════════════════════════════════════════════
// PotholeScan — Municipal Dashboard JS
// Matched to dashboard.html element IDs and class names
// ═══════════════════════════════════════════════════════════════

const STATUS_ICONS = { 'pending': '🟡', 'in-progress': '🔵', 'resolved': '✅' };

let map, markerCluster;
let allReports = [];
let filterSeverity = 'all';
let filterStatus = 'all';
let resolveState = { reportId: null, photoFile: null, gpsLat: null, gpsLng: null, distance: null, similarityScore: null };

// ─── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    loadData();
    initFilters();
});

function initMap() {
    map = L.map('dashboardMap').setView([20.5937, 78.9629], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
    }).addTo(map);
    markerCluster = L.markerClusterGroup();
    map.addLayer(markerCluster);
}

// ─── Data ───────────────────────────────────────────────────────
async function loadData() {
    try {
        const [reportsRes, statsRes] = await Promise.all([fetch('/api/reports'), fetch('/api/stats')]);
        allReports = await reportsRes.json();
        const stats = await statsRes.json();
        updateStats(stats);
        applyFilters();
    } catch (e) { console.error(e); showToast('Failed to load data', 'error'); }
}

function updateStats(stats) {
    const el = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
    el('statTotal', stats.total);
    el('statPending', stats.pending);
    el('statResolved', stats.resolved);
    // Recent = last 7 days
    const week = Date.now() - 7 * 24 * 3600_000;
    el('statRecent', allReports.filter(r => new Date(r.created_at + 'Z') > week).length);
    // Severity chart
    updateChart(stats.bySeverity || {});
}

function updateChart(sev) {
    const max = Math.max(1, ...Object.values(sev));
    const bars = { small: sev.low || sev.small || 0, medium: sev.medium || 0, severe: sev.severe || sev.high || 0, unknown: sev.unknown || sev.none || 0 };
    document.querySelectorAll('.chart-bar').forEach(bar => {
        const key = bar.classList.contains('small') ? 'small' : bar.classList.contains('medium') ? 'medium' : bar.classList.contains('severe') ? 'severe' : 'unknown';
        const val = bars[key] || 0;
        bar.style.height = Math.max(4, (val / max) * 100) + '%';
        const valEl = bar.querySelector('.chart-bar-value');
        if (valEl) valEl.textContent = val;
    });
}

// ─── Filters ────────────────────────────────────────────────────
function initFilters() {
    // Severity filters (data-severity)
    document.querySelectorAll('#severityFilters .filter-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#severityFilters .filter-chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filterSeverity = btn.dataset.severity;
            applyFilters();
        });
    });
    // Status filters (data-status)
    document.querySelectorAll('#statusFilters .filter-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#statusFilters .filter-chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            filterStatus = btn.dataset.status;
            applyFilters();
        });
    });
}

function getFilteredReports() {
    return allReports.filter(r => {
        if (filterSeverity !== 'all' && r.severity !== filterSeverity) return false;
        if (filterStatus !== 'all' && r.status !== filterStatus) return false;
        return true;
    });
}

function applyFilters() {
    const filtered = getFilteredReports();
    renderReportsList(filtered);
    renderMap(filtered);
}

// ─── Report List ────────────────────────────────────────────────
function renderReportsList(reports) {
    const list = document.getElementById('reportsList');
    if (reports.length === 0) {
        list.innerHTML = `<div class="empty-state"><span class="empty-icon">📭</span><h3>No reports found</h3><p>Try adjusting your filters.</p></div>`;
        return;
    }
    list.innerHTML = reports.map(r => {
        let metaHtml = '';
        if (r.estimated_hours > 0) metaHtml += `<span class="meta-chip eta">⏱️ ETA: ${r.estimated_hours}h</span>`;
        if (r.started_at && r.status === 'in-progress') { const el = getElapsedTime(r.started_at); if (el) metaHtml += `<span class="meta-chip">⏳ ${el}</span>`; }
        if (r.status === 'resolved' && r.started_at && r.resolved_at) { const tk = getTimeTaken(r.started_at, r.resolved_at); if (tk) metaHtml += `<span class="meta-chip">✅ Took: ${tk}</span>`; }
        if (r.trust_level && r.status === 'resolved') metaHtml += `<span class="trust-badge ${r.trust_level}">${r.trust_level.toUpperCase()} TRUST</span>`;
        if (r.similarity_score > 0 && r.status === 'resolved') metaHtml += `<span class="meta-chip">📐 ${Math.round(r.similarity_score)}%</span>`;

        let actionsHtml = '';
        if (r.status === 'pending') {
            actionsHtml = `<button class="btn btn-sm btn-warning" onclick="event.stopPropagation(); openProgressModal('${r.id}')">📋 Start & Set ETA</button><button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); deleteReport('${r.id}')">🗑️</button>`;
        } else if (r.status === 'in-progress') {
            actionsHtml = `<button class="btn btn-sm btn-warning" onclick="event.stopPropagation(); openProgressModal('${r.id}')">📋 Update</button><button class="btn btn-sm btn-success" onclick="event.stopPropagation(); openResolveModal('${r.id}')">✅ Resolve</button><button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); deleteReport('${r.id}')">🗑️</button>`;
        } else {
            actionsHtml = `<button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); deleteReport('${r.id}')">🗑️</button>`;
        }

        return `
        <div class="report-card" data-id="${r.id}" onclick="focusReport('${r.id}')">
            <div class="report-card-header">
                <span class="severity-badge ${r.severity}">${(r.severity || 'unknown').toUpperCase()}</span>
                <span class="status-badge ${r.status}">${STATUS_ICONS[r.status] || ''} ${r.status}</span>
            </div>
            <div class="report-card-body">
                <img class="report-card-thumb" src="/uploads/${r.photo}" alt="Pothole" loading="lazy"
                     onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%231a2236%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2250%22 text-anchor=%22middle%22 dy=%22.3em%22 font-size=%2230%22>🕳️</text></svg>'">
                <div class="report-card-info">
                    <p><strong>${r.description || 'No description'}</strong></p>
                    <p class="report-time">📍 ${Number(r.latitude).toFixed(4)}, ${Number(r.longitude).toFixed(4)}</p>
                    <p class="report-time">🕐 ${formatDate(r.created_at)}</p>
                    ${metaHtml ? `<div class="report-card-meta">${metaHtml}</div>` : ''}
                </div>
            </div>
            <div class="report-actions">${actionsHtml}</div>
        </div>`;
    }).join('');
}

// ─── Map ────────────────────────────────────────────────────────
function renderMap(reports) {
    markerCluster.clearLayers();
    reports.forEach(r => {
        const color = r.severity === 'severe' || r.severity === 'high' ? '#ef4444' : r.severity === 'medium' ? '#f59e0b' : '#22c55e';
        const marker = L.circleMarker([r.latitude, r.longitude], { radius: 8, fillColor: color, color: color, weight: 2, opacity: 0.8, fillOpacity: 0.4 });
        marker.bindPopup(`<div style="min-width:180px;"><img src="/uploads/${r.photo}" style="width:100%;height:80px;object-fit:cover;border-radius:6px;margin-bottom:6px;"><b>${(r.severity || '').toUpperCase()}</b> — ${r.status}<br><small>${r.description || ''}</small></div>`);
        markerCluster.addLayer(marker);
    });
}

function focusReport(id) {
    const r = allReports.find(x => x.id === id);
    if (!r) return;
    map.flyTo([r.latitude, r.longitude], 17, { duration: 1 });
    document.querySelectorAll('.report-card').forEach(c => c.classList.remove('selected'));
    const card = document.querySelector(`.report-card[data-id="${id}"]`);
    if (card) card.classList.add('selected');
}

// ─── Helpers ────────────────────────────────────────────────────
function formatDate(s) { if (!s) return ''; return new Date(s + (s.includes('Z') ? '' : 'Z')).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function getElapsedTime(s) { if (!s) return null; const ms = Date.now() - new Date(s + (s.includes('Z') ? '' : 'Z')).getTime(); const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000); return h > 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m}m`; }
function getTimeTaken(s, e) { if (!s || !e) return null; const ms = new Date(e + (e.includes('Z') ? '' : 'Z')) - new Date(s + (s.includes('Z') ? '' : 'Z')); const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000); return h > 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m}m`; }
function haversine(lat1, lon1, lat2, lon2) { const R = 6371000, toRad = x => x * Math.PI / 180; const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1); const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2; return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); }

// ─── Delete ─────────────────────────────────────────────────────
async function deleteReport(id) {
    if (!confirm('Delete this report permanently?')) return;
    try { const r = await fetch(`/api/reports/${id}`, { method: 'DELETE' }); if (!r.ok) throw new Error(); showToast('Report deleted', 'success'); loadData(); }
    catch (e) { showToast('Failed to delete', 'error'); }
}

// ─── Progress Modal ─────────────────────────────────────────────
function openProgressModal(id) {
    const r = allReports.find(x => x.id === id);
    if (!r) return;
    document.getElementById('progressReportId').value = id;
    document.getElementById('progressCurrentStatus').textContent = r.status.toUpperCase();
    document.getElementById('estimatedHours').value = r.estimated_hours || '';
    document.getElementById('progressNote').value = '';
    const logArea = document.getElementById('progressLogArea');
    const logContent = document.getElementById('progressLogContent');
    if (r.progress_notes) { logArea.style.display = 'block'; logContent.textContent = r.progress_notes; }
    else { logArea.style.display = 'none'; }
    document.getElementById('progressModal').classList.add('active');
}

async function submitProgress() {
    const id = document.getElementById('progressReportId').value;
    const estimated_hours = parseFloat(document.getElementById('estimatedHours').value) || 0;
    const progress_notes = document.getElementById('progressNote').value;
    try {
        const r = await fetch(`/api/reports/${id}/progress`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estimated_hours, progress_notes }) });
        if (!r.ok) throw new Error(); closeModal('progressModal'); showToast('Progress updated', 'success'); loadData();
    } catch (e) { showToast('Update failed', 'error'); }
}

// ─── Resolution Modal ───────────────────────────────────────────
function openResolveModal(id) {
    resolveState = { reportId: id, photoFile: null, gpsLat: null, gpsLng: null, distance: null, similarityScore: null };
    document.getElementById('resolveReportId').value = id;
    const zone = document.getElementById('resolveUploadZone');
    zone.innerHTML = '<span style="font-size:2rem">📷</span><p style="font-size:0.85rem;color:var(--text-secondary);margin-top:0.5rem">Click to upload resolution photo</p>';
    zone.classList.remove('has-image');
    document.getElementById('resolvePhotoInput').value = '';
    document.getElementById('gpsResult').style.display = 'none';
    document.getElementById('uploadStep').style.display = 'none';
    document.getElementById('comparisonResult').style.display = 'none';
    document.getElementById('finalizeBtn').style.display = 'none';
    document.getElementById('similarityStatus').innerHTML = '';
    const ub = document.getElementById('uploadResolveBtn'); if (ub) ub.textContent = '🔍 Upload & Verify Photos';
    document.getElementById('resolveModal').classList.add('active');
}

function handleResolvePhoto(input) {
    if (!input.files || !input.files[0]) return;
    resolveState.photoFile = input.files[0];
    const zone = document.getElementById('resolveUploadZone');
    zone.classList.add('has-image');
    zone.innerHTML = '<span style="font-size:2rem">✅</span><p style="color:var(--success);margin-top:0.3rem;font-size:0.8rem">Photo selected</p>';
    checkResolveReady();
}

function captureResolutionGPS() {
    const btn = document.getElementById('captureGpsBtn');
    btn.textContent = '⏳ Getting location...'; btn.disabled = true;
    navigator.geolocation.getCurrentPosition(pos => {
        resolveState.gpsLat = pos.coords.latitude;
        resolveState.gpsLng = pos.coords.longitude;
        const r = allReports.find(x => x.id === resolveState.reportId);
        if (!r) return;
        const dist = haversine(r.latitude, r.longitude, resolveState.gpsLat, resolveState.gpsLng);
        resolveState.distance = dist;
        const div = document.getElementById('gpsResult');
        div.style.display = 'block';
        div.innerHTML = dist > 20
            ? `<div style="color:var(--danger);font-size:0.85rem">❌ <b>${Math.round(dist)}m away</b> — Must be within 20m</div>`
            : `<div style="color:var(--success);font-size:0.85rem">✅ <b>${Math.round(dist)}m away</b> — Location verified!</div>`;
        btn.textContent = '📍 Capture My Location'; btn.disabled = false;
        checkResolveReady();
    }, err => { showToast('GPS error: ' + err.message, 'error'); btn.textContent = '📍 Capture My Location'; btn.disabled = false; }, { enableHighAccuracy: true });
}

function checkResolveReady() {
    if (resolveState.photoFile && resolveState.distance !== null && resolveState.distance <= 20)
        document.getElementById('uploadStep').style.display = 'block';
}

async function uploadResolution() {
    const btn = document.getElementById('uploadResolveBtn');
    btn.textContent = '⏳ Uploading...'; btn.disabled = true;
    const fd = new FormData();
    fd.append('resolution_photo', resolveState.photoFile);
    fd.append('resolution_lat', resolveState.gpsLat);
    fd.append('resolution_lng', resolveState.gpsLng);
    try {
        const r = await fetch(`/api/reports/${resolveState.reportId}/resolve`, { method: 'POST', body: fd });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Upload failed');
        btn.textContent = '🤖 Running ML comparison...';
        document.getElementById('similarityStatus').innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem">Loading ML model...</p>';
        let similarity = 50;
        try { similarity = await PhotoSimilarity.compare(data.original_photo, data.resolution_photo); } catch (e) { console.warn('ML fallback', e); }
        resolveState.similarityScore = similarity;
        document.getElementById('comparisonResult').style.display = 'block';
        document.getElementById('photoComparison').innerHTML = `<img src="/uploads/${data.original_photo}" alt="Original"><img src="/uploads/${data.resolution_photo}" alt="Resolution">`;
        const clr = similarity >= 70 ? 'var(--success)' : similarity >= 40 ? 'var(--warning)' : 'var(--danger)';
        document.getElementById('similarityMeter').innerHTML = `<div style="font-size:1.2rem;font-weight:700;color:${clr};margin-bottom:0.3rem">${Math.round(similarity)}% Match</div><div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden"><div style="height:100%;width:${similarity}%;background:${clr};border-radius:3px;transition:width 0.6s ease"></div></div>`;
        const dr = document.getElementById('distanceResult');
        if (dr) dr.innerHTML = `<p style="font-size:0.8rem;color:var(--text-secondary)">📍 Distance: ${data.distance_m}m</p>`;
        document.getElementById('similarityStatus').innerHTML = '';
        document.getElementById('finalizeBtn').style.display = 'inline-flex';
    } catch (e) { showToast(e.message, 'error'); }
    btn.textContent = '🔍 Upload & Verify Photos'; btn.disabled = false;
}

async function finalizeResolution() {
    if (resolveState.similarityScore < 40 && !confirm('⚠️ Low similarity (' + Math.round(resolveState.similarityScore) + '%). Flag as LOW TRUST?')) return;
    try {
        const r = await fetch(`/api/reports/${resolveState.reportId}/finalize`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ similarity_score: resolveState.similarityScore }) });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Failed');
        closeModal('resolveModal'); showToast(`Resolved with ${data.trust_level.toUpperCase()} trust`, 'success'); loadData();
    } catch (e) { showToast(e.message, 'error'); }
}

// ─── Utility ────────────────────────────────────────────────────
function closeModal(id) { document.getElementById(id).classList.remove('active'); }
function showToast(msg, type = 'info') {
    const c = document.getElementById('toastContainer'), t = document.createElement('div');
    t.className = `toast ${type}`; t.textContent = msg; c.appendChild(t);
    setTimeout(() => { if (t.parentNode) t.remove() }, 4000);
}
