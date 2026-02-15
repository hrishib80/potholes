// ─── Constants & State ──────────────────────────────────────────
let map, markerCluster;
let allReports = [];
let activeFilters = { status: 'all' };
let resolveState = {
    reportId: null, photoFile: null, gpsLat: null, gpsLng: null, distance: null, similarityScore: null
};

// ─── Init ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    loadData();
    initFilters();
});

function initMap() {
    map = L.map('map').setView([20.5937, 78.9629], 5); // India center
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
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
        render();
    } catch (e) { showToast('Failed to load data', 'error'); }
}

function updateStats(stats) {
    document.getElementById('statTotal').textContent = stats.total;
    document.getElementById('statPending').textContent = stats.pending;
}

// ─── Rendering ──────────────────────────────────────────────────
function render() {
    const list = document.getElementById('reportsList');
    markerCluster.clearLayers();

    const filtered = allReports.filter(r =>
        activeFilters.status === 'all' || r.status === activeFilters.status
    );

    list.innerHTML = filtered.map(r => `
        <div class="report-card" onclick="flyTo(${r.latitude}, ${r.longitude})">
            <div class="report-card-header">
                <span class="status-badge ${r.status}">${r.status}</span>
                <span class="severity-badge severity-${r.severity}">${r.severity}</span>
            </div>
            <div class="report-card-body">
                <img src="/uploads/${r.photo}" class="report-card-thumb">
                <div class="report-card-info">
                    <p><strong>${r.description || 'No Description'}</strong></p>
                    <p>📍 ${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}</p>
                    <p>📅 ${new Date(r.created_at).toLocaleDateString()}</p>
                    ${r.estimated_hours ? `<p>⏱️ ETA: ${r.estimated_hours}h</p>` : ''}
                </div>
            </div>
            <div class="report-actions">
                ${getActionButtons(r)}
            </div>
        </div>
    `).join('');

    filtered.forEach(r => {
        L.marker([r.latitude, r.longitude])
            .bindPopup(`<b>${r.severity.toUpperCase()}</b><br>${r.description}<br><img src="/uploads/${r.photo}" width="100">`)
            .addTo(markerCluster);
    });
}

function getActionButtons(r) {
    if (r.status === 'pending') {
        return `<button class="btn btn-sm btn-warning" onclick="openProgressModal('${r.id}')">📋 Start & Set ETA</button>`;
    }
    if (r.status === 'in-progress') {
        return `
            <button class="btn btn-sm btn-warning" onclick="openProgressModal('${r.id}')">📋 Update</button>
            <button class="btn btn-sm btn-success" onclick="openResolveModal('${r.id}')">✅ Resolve</button>
        `;
    }
    return ''; // Resolved has no actions
}

function flyTo(lat, lng) {
    map.flyTo([lat, lng], 17);
}

function initFilters() {
    const btns = document.querySelectorAll('.filter-chip');
    btns.forEach(btn => {
        btn.onclick = () => {
            btns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeFilters.status = btn.dataset.status;
            render();
        };
    });
}

// ─── Progress ───────────────────────────────────────────────────
function openProgressModal(id) {
    const r = allReports.find(x => x.id === id);
    document.getElementById('progressReportId').value = id;
    document.getElementById('progressCurrentStatus').textContent = r.status;
    document.getElementById('estimatedHours').value = r.estimated_hours || '';
    document.getElementById('progressNote').value = '';

    // Logs
    const log = document.getElementById('progressLogContent');
    if (r.progress_notes) {
        document.getElementById('progressLogArea').style.display = 'block';
        log.textContent = r.progress_notes;
    } else {
        document.getElementById('progressLogArea').style.display = 'none';
    }

    document.getElementById('progressModal').classList.add('active');
}

async function submitProgress() {
    const id = document.getElementById('progressReportId').value;
    const hrs = document.getElementById('estimatedHours').value;
    const note = document.getElementById('progressNote').value;

    await fetch(`/api/reports/${id}/progress`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estimated_hours: hrs, progress_notes: note })
    });

    closeModal('progressModal');
    showToast('Progress Updated', 'success');
    loadData();
}

// ─── Resolution ─────────────────────────────────────────────────
function openResolveModal(id) {
    resolveState = { reportId: id, photoFile: null, gpsLat: null, gpsLng: null, distance: null, similarityScore: null };
    document.getElementById('resolveReportId').value = id;
    document.getElementById('resolveUploadZone').classList.remove('has-image');
    document.getElementById('gpsResult').style.display = 'none';
    document.getElementById('uploadStep').style.display = 'none';
    document.getElementById('comparisonResult').style.display = 'none';
    document.getElementById('finalizeBtn').style.display = 'none';

    document.getElementById('resolveModal').classList.add('active');
}

function handleResolvePhoto(input) {
    if (input.files[0]) {
        resolveState.photoFile = input.files[0];
        document.getElementById('resolveUploadZone').classList.add('has-image');
        checkResolveReady();
    }
}

function captureResolutionGPS() {
    navigator.geolocation.getCurrentPosition(pos => {
        resolveState.gpsLat = pos.coords.latitude;
        resolveState.gpsLng = pos.coords.longitude;

        // Client side check (approx)
        const r = allReports.find(x => x.id === resolveState.reportId);
        const dist = haversine(r.latitude, r.longitude, resolveState.gpsLat, resolveState.gpsLng);
        resolveState.distance = dist;

        const div = document.getElementById('gpsResult');
        div.style.display = 'block';
        if (dist > 20) {
            div.innerHTML = `<span style="color:#ef4444">❌ Distance: ${Math.round(dist)}m. Must be < 20m!</span>`;
        } else {
            div.innerHTML = `<span style="color:#22c55e">✅ Distance: ${Math.round(dist)}m. Valid.</span>`;
        }
        checkResolveReady();
    });
}

function checkResolveReady() {
    if (resolveState.photoFile && resolveState.distance !== null && resolveState.distance <= 20) {
        document.getElementById('uploadStep').style.display = 'block';
    }
}

async function uploadResolution() {
    const formData = new FormData();
    formData.append('resolution_photo', resolveState.photoFile);
    formData.append('resolution_lat', resolveState.gpsLat);
    formData.append('resolution_lng', resolveState.gpsLng);

    const btn = document.getElementById('uploadResolveBtn');
    btn.textContent = 'Uploading...';

    try {
        const res = await fetch(`/api/reports/${resolveState.reportId}/resolve`, { method: 'POST', body: formData });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error);

        // Run Similarity
        btn.textContent = 'Analyzing...';
        const similarity = await PhotoSimilarity.compare(data.original_photo, data.resolution_photo);
        resolveState.similarityScore = similarity;

        // Show Results
        document.getElementById('comparisonResult').style.display = 'block';
        document.getElementById('similarityMeter').innerHTML = `Match Score: <b>${Math.round(similarity)}%</b>`;
        document.getElementById('photoComparison').innerHTML = `
            <img src="/uploads/${data.original_photo}" width="100">
            <img src="/uploads/${data.resolution_photo}" width="100">
        `;
        document.getElementById('finalizeBtn').style.display = 'inline-block';

    } catch (e) { showToast(e.message, 'error'); }

    btn.textContent = '🔍 Upload & Verify Photos';
}

async function finalizeResolution() {
    if (resolveState.similarityScore < 40) {
        if (!confirm('Low similarity. Proceed with Low Trust?')) return;
    }

    await fetch(`/api/reports/${resolveState.reportId}/finalize`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ similarity_score: resolveState.similarityScore })
    });

    closeModal('resolveModal');
    showToast('Resolved!', 'success');
    loadData();
}

// ─── Logic Helpers ──────────────────────────────────────────────
function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

function showToast(msg, type) {
    const div = document.createElement('div');
    div.className = `toast ${type}`;
    div.textContent = msg;
    document.getElementById('toastContainer').appendChild(div);
    setTimeout(() => div.remove(), 4000);
}
