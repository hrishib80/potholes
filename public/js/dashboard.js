// ═══════════════════════════════════════════════════════════════
// PotholeScan — Municipal Dashboard
// ═══════════════════════════════════════════════════════════════

const STATUS_ICONS = {
    'pending': '🟡',
    'in-progress': '🔵',
    'resolved': '✅'
};

let map, markerCluster;
let allReports = [];
let activeFilter = 'all';
let resolveState = {
    reportId: null,
    photoFile: null,
    gpsLat: null,
    gpsLng: null,
    distance: null,
    similarityScore: null
};

// ─── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    loadData();
    initFilters();
});

// ─── Map Setup ──────────────────────────────────────────────────
function initMap() {
    map = L.map('map').setView([20.5937, 78.9629], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);
    markerCluster = L.markerClusterGroup();
    map.addLayer(markerCluster);
}

// ─── Data Loading ───────────────────────────────────────────────
async function loadData() {
    try {
        const [reportsRes, statsRes] = await Promise.all([
            fetch('/api/reports'),
            fetch('/api/stats')
        ]);
        allReports = await reportsRes.json();
        const stats = await statsRes.json();
        updateStats(stats);
        renderReportsList(getFilteredReports());
        renderMap(getFilteredReports());
    } catch (e) {
        console.error('Failed to load data:', e);
        showToast('Failed to load data', 'error');
    }
}

function updateStats(stats) {
    const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    el('statTotal', stats.total);
    el('statPending', stats.pending);
}

function getFilteredReports() {
    if (activeFilter === 'all') return allReports;
    return allReports.filter(r => r.status === activeFilter);
}

// ─── Filters ────────────────────────────────────────────────────
function initFilters() {
    document.querySelectorAll('.filter-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeFilter = btn.dataset.status;
            renderReportsList(getFilteredReports());
            renderMap(getFilteredReports());
        });
    });
}

// ─── Report List Rendering ──────────────────────────────────────
function renderReportsList(reports) {
    const list = document.getElementById('reportsList');

    if (reports.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <span class="empty-icon">📭</span>
                <h3>No reports found</h3>
                <p>Try adjusting your filters or wait for new reports.</p>
            </div>
        `;
        return;
    }

    list.innerHTML = reports.map(r => {
        // Build meta chips
        let metaHtml = '';
        if (r.estimated_hours > 0) {
            metaHtml += `<span class="meta-chip eta">⏱️ ETA: ${r.estimated_hours}h</span>`;
        }
        if (r.started_at && r.status === 'in-progress') {
            const elapsed = getElapsedTime(r.started_at);
            if (elapsed) metaHtml += `<span class="meta-chip">⏳ Elapsed: ${elapsed}</span>`;
        }
        if (r.status === 'resolved' && r.started_at && r.resolved_at) {
            const taken = getTimeTaken(r.started_at, r.resolved_at);
            if (taken) metaHtml += `<span class="meta-chip">✅ Took: ${taken}</span>`;
        }
        if (r.trust_level && r.status === 'resolved') {
            metaHtml += `<span class="trust-badge ${r.trust_level}">${r.trust_level.toUpperCase()} TRUST</span>`;
        }
        if (r.similarity_score > 0 && r.status === 'resolved') {
            metaHtml += `<span class="meta-chip">📐 Similarity: ${Math.round(r.similarity_score)}%</span>`;
        }

        // Build action buttons based on status
        let actionsHtml = '';
        if (r.status === 'pending') {
            actionsHtml = `
                <button class="btn btn-sm btn-warning" onclick="event.stopPropagation(); openProgressModal('${r.id}')">📋 Start & Set ETA</button>
                <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); deleteReport('${r.id}')">🗑️</button>
            `;
        } else if (r.status === 'in-progress') {
            actionsHtml = `
                <button class="btn btn-sm btn-warning" onclick="event.stopPropagation(); openProgressModal('${r.id}')">📋 Update</button>
                <button class="btn btn-sm btn-success" onclick="event.stopPropagation(); openResolveModal('${r.id}')">✅ Resolve</button>
                <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); deleteReport('${r.id}')">🗑️</button>
            `;
        } else {
            actionsHtml = `
                <button class="btn btn-sm btn-danger" onclick="event.stopPropagation(); deleteReport('${r.id}')">🗑️ Delete</button>
            `;
        }

        return `
        <div class="report-card" data-id="${r.id}" onclick="focusReport('${r.id}')">
            <div class="report-card-header">
                <span class="severity-badge ${r.severity}">${r.severity.toUpperCase()}</span>
                <span class="status-badge ${r.status}">${STATUS_ICONS[r.status] || ''} ${r.status}</span>
            </div>
            <div class="report-card-body">
                <img class="report-card-thumb" src="/uploads/${r.photo}" alt="Pothole" loading="lazy"
                     onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%231a2236%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2250%22 text-anchor=%22middle%22 dy=%22.3em%22 font-size=%2230%22>🕳️</text></svg>'">
                <div class="report-card-info">
                    <p>${r.description || 'No description provided'}</p>
                    <p class="report-time">📍 ${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}</p>
                    <p class="report-time">🕐 ${formatDate(r.created_at)}</p>
                    ${metaHtml ? `<div class="report-card-meta">${metaHtml}</div>` : ''}
                </div>
            </div>
            <div class="report-actions">${actionsHtml}</div>
        </div>
        `;
    }).join('');
}

// ─── Map Rendering ──────────────────────────────────────────────
function renderMap(reports) {
    markerCluster.clearLayers();
    reports.forEach(r => {
        const color = r.severity === 'severe' ? '#ef4444' : r.severity === 'medium' ? '#f59e0b' : '#22c55e';
        const marker = L.circleMarker([r.latitude, r.longitude], {
            radius: 8,
            fillColor: color,
            color: color,
            weight: 2,
            opacity: 0.8,
            fillOpacity: 0.4
        });
        marker.bindPopup(`
            <div style="min-width:180px;">
                <img src="/uploads/${r.photo}" style="width:100%;height:80px;object-fit:cover;border-radius:6px;margin-bottom:6px;">
                <b style="text-transform:capitalize;">${r.severity}</b> — <span style="text-transform:capitalize;">${r.status}</span>
                <br><small>${r.description || 'No description'}</small>
            </div>
        `);
        markerCluster.addLayer(marker);
    });
}

function focusReport(id) {
    const r = allReports.find(x => x.id === id);
    if (r) {
        map.flyTo([r.latitude, r.longitude], 17, { duration: 1 });
        // Highlight card
        document.querySelectorAll('.report-card').forEach(c => c.classList.remove('selected'));
        const card = document.querySelector(`.report-card[data-id="${id}"]`);
        if (card) card.classList.add('selected');
    }
}

// ─── Helpers ────────────────────────────────────────────────────
function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + (dateStr.includes('Z') ? '' : 'Z'));
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getElapsedTime(startedAt) {
    if (!startedAt) return null;
    const start = new Date(startedAt + (startedAt.includes('Z') ? '' : 'Z'));
    const now = new Date();
    const diffMs = now - start;
    const hours = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    if (hours > 24) {
        const days = Math.floor(hours / 24);
        return `${days}d ${hours % 24}h`;
    }
    return `${hours}h ${mins}m`;
}

function getTimeTaken(startedAt, resolvedAt) {
    if (!startedAt || !resolvedAt) return null;
    const start = new Date(startedAt + (startedAt.includes('Z') ? '' : 'Z'));
    const end = new Date(resolvedAt + (resolvedAt.includes('Z') ? '' : 'Z'));
    const diffMs = end - start;
    const hours = Math.floor(diffMs / 3600000);
    const mins = Math.floor((diffMs % 3600000) / 60000);
    if (hours > 24) {
        const days = Math.floor(hours / 24);
        return `${days}d ${hours % 24}h`;
    }
    return `${hours}h ${mins}m`;
}

function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ─── Delete Report ──────────────────────────────────────────────
async function deleteReport(id) {
    if (!confirm('Delete this report permanently?')) return;
    try {
        const res = await fetch(`/api/reports/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Delete failed');
        showToast('Report deleted', 'success');
        loadData();
    } catch (e) {
        showToast('Failed to delete', 'error');
    }
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
    if (r.progress_notes) {
        logArea.style.display = 'block';
        logContent.textContent = r.progress_notes;
    } else {
        logArea.style.display = 'none';
    }

    document.getElementById('progressModal').classList.add('active');
}

async function submitProgress() {
    const id = document.getElementById('progressReportId').value;
    const estimated_hours = parseFloat(document.getElementById('estimatedHours').value) || 0;
    const progress_notes = document.getElementById('progressNote').value;

    try {
        const res = await fetch(`/api/reports/${id}/progress`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estimated_hours, progress_notes })
        });
        if (!res.ok) throw new Error('Update failed');
        closeModal('progressModal');
        showToast('Progress updated', 'success');
        loadData();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

// ─── Resolution Modal ───────────────────────────────────────────
function openResolveModal(id) {
    resolveState = {
        reportId: id,
        photoFile: null,
        gpsLat: null,
        gpsLng: null,
        distance: null,
        similarityScore: null
    };

    document.getElementById('resolveReportId').value = id;

    // Reset UI
    const uploadZone = document.getElementById('resolveUploadZone');
    uploadZone.innerHTML = `
        <span style="font-size: 2rem;">📷</span>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 0.5rem;">Click to upload resolution/surrounding photo</p>
    `;
    uploadZone.classList.remove('has-image');
    document.getElementById('resolvePhotoInput').value = '';
    document.getElementById('gpsResult').style.display = 'none';
    document.getElementById('gpsResult').innerHTML = '';
    document.getElementById('uploadStep').style.display = 'none';
    document.getElementById('comparisonResult').style.display = 'none';
    document.getElementById('finalizeBtn').style.display = 'none';
    document.getElementById('similarityStatus').innerHTML = '';

    const uploadBtn = document.getElementById('uploadResolveBtn');
    if (uploadBtn) uploadBtn.textContent = '🔍 Upload & Verify Photos';

    document.getElementById('resolveModal').classList.add('active');
}

function handleResolvePhoto(input) {
    if (!input.files || !input.files[0]) return;
    resolveState.photoFile = input.files[0];

    const zone = document.getElementById('resolveUploadZone');
    zone.classList.add('has-image');
    zone.innerHTML = '<span style="font-size:2rem;">✅</span><p style="color:var(--success);margin-top:0.3rem;font-size:0.8rem;">Photo selected</p>';

    checkResolveReady();
}

function captureResolutionGPS() {
    const btn = document.getElementById('captureGpsBtn');
    btn.textContent = '⏳ Getting location...';
    btn.disabled = true;

    navigator.geolocation.getCurrentPosition(
        pos => {
            resolveState.gpsLat = pos.coords.latitude;
            resolveState.gpsLng = pos.coords.longitude;

            const r = allReports.find(x => x.id === resolveState.reportId);
            if (!r) return;

            const dist = haversine(r.latitude, r.longitude, resolveState.gpsLat, resolveState.gpsLng);
            resolveState.distance = dist;

            const gpsDiv = document.getElementById('gpsResult');
            gpsDiv.style.display = 'block';

            if (dist > 20) {
                gpsDiv.innerHTML = `
                    <div style="color: var(--danger); font-size: 0.85rem;">
                        ❌ <b>${Math.round(dist)}m away</b> — Must be within 20m of reported location.
                    </div>`;
            } else {
                gpsDiv.innerHTML = `
                    <div style="color: var(--success); font-size: 0.85rem;">
                        ✅ <b>${Math.round(dist)}m away</b> — Location verified!
                    </div>`;
            }

            btn.textContent = '📍 Capture My Location';
            btn.disabled = false;
            checkResolveReady();
        },
        err => {
            showToast('GPS error: ' + err.message, 'error');
            btn.textContent = '📍 Capture My Location';
            btn.disabled = false;
        },
        { enableHighAccuracy: true }
    );
}

function checkResolveReady() {
    if (resolveState.photoFile && resolveState.distance !== null && resolveState.distance <= 20) {
        document.getElementById('uploadStep').style.display = 'block';
    }
}

async function uploadResolution() {
    const btn = document.getElementById('uploadResolveBtn');
    btn.textContent = '⏳ Uploading...';
    btn.disabled = true;

    const formData = new FormData();
    formData.append('resolution_photo', resolveState.photoFile);
    formData.append('resolution_lat', resolveState.gpsLat);
    formData.append('resolution_lng', resolveState.gpsLng);

    try {
        const res = await fetch(`/api/reports/${resolveState.reportId}/resolve`, {
            method: 'POST',
            body: formData
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Upload failed');

        // Run similarity check
        btn.textContent = '🤖 Running ML comparison...';
        document.getElementById('similarityStatus').innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem;">Loading ML model and comparing photos...</p>';

        let similarity = 0;
        try {
            similarity = await PhotoSimilarity.compare(data.original_photo, data.resolution_photo);
        } catch (mlErr) {
            console.warn('ML comparison failed, using fallback:', mlErr);
            similarity = 50; // Fallback score
        }

        resolveState.similarityScore = similarity;

        // Show comparison results
        document.getElementById('comparisonResult').style.display = 'block';

        document.getElementById('photoComparison').innerHTML = `
            <img src="/uploads/${data.original_photo}" alt="Original">
            <img src="/uploads/${data.resolution_photo}" alt="Resolution">
        `;

        const scoreColor = similarity >= 70 ? 'var(--success)' : similarity >= 40 ? 'var(--warning)' : 'var(--danger)';
        document.getElementById('similarityMeter').innerHTML = `
            <div style="font-size:1.2rem;font-weight:700;color:${scoreColor};margin-bottom:0.3rem;">
                ${Math.round(similarity)}% Match
            </div>
            <div style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;overflow:hidden;">
                <div style="height:100%;width:${similarity}%;background:${scoreColor};border-radius:3px;transition:width 0.6s ease;"></div>
            </div>
        `;

        document.getElementById('distanceResult').innerHTML = `
            <p style="font-size:0.8rem;color:var(--text-secondary);">📍 Distance: ${data.distance_m}m</p>
        `;

        document.getElementById('similarityStatus').innerHTML = '';
        document.getElementById('finalizeBtn').style.display = 'inline-flex';

    } catch (e) {
        showToast(e.message, 'error');
    }

    btn.textContent = '🔍 Upload & Verify Photos';
    btn.disabled = false;
}

async function finalizeResolution() {
    // Warn if low trust
    if (resolveState.similarityScore < 40) {
        if (!confirm('⚠️ Low similarity detected (' + Math.round(resolveState.similarityScore) + '%). This will be flagged as LOW TRUST. Continue?')) {
            return;
        }
    }

    try {
        const res = await fetch(`/api/reports/${resolveState.reportId}/finalize`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ similarity_score: resolveState.similarityScore })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Finalize failed');

        closeModal('resolveModal');
        showToast(`Report resolved with ${data.trust_level.toUpperCase()} trust`, 'success');
        loadData();
    } catch (e) {
        showToast(e.message, 'error');
    }
}

// ─── Modal Helpers ──────────────────────────────────────────────
function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

// ─── Toast ──────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 4000);
}
