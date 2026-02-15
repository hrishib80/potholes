// ═══════════════════════════════════════════════════════════════
// PotholeScan — User Report Page
// ═══════════════════════════════════════════════════════════════

let selectedFile = null;
let analysisResult = null;

document.addEventListener('DOMContentLoaded', () => {
    initUpload();
    initGeo();
    initForm();
    loadMyReports();
});

// ─── Upload Handler ─────────────────────────────────────────────
function initUpload() {
    const zone = document.getElementById('uploadZone');
    const input = document.getElementById('photoInput');

    zone.addEventListener('click', () => input.click());
    input.addEventListener('change', (e) => {
        if (e.target.files[0]) handleFile(e.target.files[0]);
    });

    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
}

function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) {
        showToast('Please select an image file', 'error');
        return;
    }
    selectedFile = file;

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = document.getElementById('uploadPreview');
        img.src = e.target.result;
        const zone = document.getElementById('uploadZone');
        zone.classList.add('has-image');

        // Wait for image to load before analyzing
        img.onload = () => runAnalysis(img);
    };
    reader.readAsDataURL(file);
}

// ─── AI Analysis ────────────────────────────────────────────────
async function runAnalysis(imgElement) {
    const spinner = document.getElementById('analyzingSpinner');
    const panel = document.getElementById('analysisPanel');

    spinner.style.display = 'flex';
    panel.classList.remove('visible');

    try {
        analysisResult = await PotholeModel.analyze(imgElement);
        displayAnalysis(analysisResult);
    } catch (e) {
        console.error('Analysis error:', e);
        showToast('AI analysis failed, you can still submit manually', 'error');
    }

    spinner.style.display = 'none';
    checkSubmitReady();
}

function displayAnalysis(res) {
    const panel = document.getElementById('analysisPanel');
    panel.classList.add('visible');

    document.getElementById('resultDetected').textContent = res.isPothole ? '✅ YES' : '❌ NO';
    document.getElementById('resultDetected').style.color = res.isPothole ? '#22c55e' : '#ef4444';

    const confPct = Math.round(res.confidence * 100);
    document.getElementById('resultConfidence').textContent = confPct + '%';
    document.getElementById('confidenceBar').style.width = confPct + '%';
    document.getElementById('confidenceBar').style.background =
        confPct >= 70 ? '#22c55e' : confPct >= 40 ? '#f59e0b' : '#ef4444';

    const sevEl = document.getElementById('resultSeverity');
    sevEl.textContent = (res.severity || 'unknown').toUpperCase();
    const sevColors = { high: '#ef4444', severe: '#ef4444', medium: '#f59e0b', low: '#22c55e', none: '#64748b' };
    sevEl.style.color = sevColors[res.severity] || '#94a3b8';

    document.getElementById('resultSize').textContent = res.estimatedSize || 'N/A';
}

// ─── GPS ────────────────────────────────────────────────────────
function initGeo() {
    document.getElementById('geoBtn').addEventListener('click', () => {
        if (!navigator.geolocation) {
            showToast('Geolocation not supported', 'error');
            return;
        }

        const btn = document.getElementById('geoBtn');
        btn.textContent = '⏳ Getting...';
        btn.disabled = true;

        navigator.geolocation.getCurrentPosition(
            pos => {
                document.getElementById('latInput').value = pos.coords.latitude.toFixed(6);
                document.getElementById('lngInput').value = pos.coords.longitude.toFixed(6);
                btn.textContent = '✅ Got GPS';
                btn.disabled = false;
                checkSubmitReady();
            },
            err => {
                showToast('GPS Error: ' + err.message, 'error');
                btn.textContent = 'Get GPS';
                btn.disabled = false;
            },
            { enableHighAccuracy: true }
        );
    });
}

// ─── Submit Logic ───────────────────────────────────────────────
function checkSubmitReady() {
    const hasFile = !!selectedFile;
    const hasLoc = !!(document.getElementById('latInput').value && document.getElementById('lngInput').value);
    document.getElementById('submitBtn').disabled = !(hasFile && hasLoc);
}

function initForm() {
    document.getElementById('reportForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = document.getElementById('submitBtn');
        btn.disabled = true;
        btn.textContent = '⏳ Submitting...';

        const formData = new FormData();
        formData.append('photo', selectedFile);
        formData.append('latitude', document.getElementById('latInput').value);
        formData.append('longitude', document.getElementById('lngInput').value);
        formData.append('description', document.getElementById('description').value);
        formData.append('road_type', document.getElementById('roadType').value);

        if (analysisResult) {
            formData.append('severity', analysisResult.severity || 'unknown');
            formData.append('confidence', analysisResult.confidence || 0);
            formData.append('is_pothole', analysisResult.isPothole ? 1 : 0);
            formData.append('estimated_size', analysisResult.estimatedSize || '');
        }

        try {
            const res = await fetch('/api/reports', { method: 'POST', body: formData });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Submission failed');
            }
            document.getElementById('successOverlay').style.display = 'flex';
        } catch (err) {
            showToast(err.message, 'error');
            btn.disabled = false;
            btn.textContent = '🚀 Submit Report';
        }
    });
}

// ─── My Reports ─────────────────────────────────────────────────
async function loadMyReports() {
    try {
        const res = await fetch('/api/reports/my');
        if (!res.ok) return; // Not logged in or no reports

        const reports = await res.json();
        if (reports.length === 0) return;

        document.getElementById('myReportsSection').style.display = 'block';
        const list = document.getElementById('myReportsList');

        list.innerHTML = reports.map(r => {
            // Build badges
            let badges = `<span class="status-badge ${r.status}">${r.status}</span>`;

            if (r.severity && r.severity !== 'unknown') {
                badges += `<span class="severity-badge ${r.severity}">${r.severity}</span>`;
            }

            if (r.status === 'resolved' && r.trust_level) {
                badges += `<span class="trust-badge ${r.trust_level}">${r.trust_level.toUpperCase()} TRUST</span>`;
            }

            // Trust warning for low trust
            let trustWarning = '';
            if (r.status === 'resolved' && r.trust_level === 'low') {
                trustWarning = `
                    <div class="trust-warning">
                        ⚠️ This resolution has low trustworthiness. The verification photos had low similarity 
                        (${Math.round(r.similarity_score || 0)}%) or the location distance was high (${r.distance_m || 0}m). 
                        The repair quality may need further inspection.
                    </div>`;
            }

            return `
            <div class="my-report-card">
                <div class="report-card-body">
                    <img src="/uploads/${r.photo}" class="report-card-thumb" 
                         onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><rect fill=%22%231a2236%22 width=%22100%22 height=%22100%22/><text x=%2250%22 y=%2250%22 text-anchor=%22middle%22 dy=%22.3em%22 font-size=%2230%22>🕳️</text></svg>'">
                    <div class="report-card-info">
                        <p><strong>${r.description || 'Report'}</strong></p>
                        <p class="report-time">📅 ${new Date(r.created_at + 'Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                        <p class="report-time">📍 ${r.latitude.toFixed(4)}, ${r.longitude.toFixed(4)}</p>
                        <div class="my-report-badges">${badges}</div>
                        ${trustWarning}
                    </div>
                </div>
            </div>
            `;
        }).join('');
    } catch (e) {
        // Silently fail if not logged in
    }
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
