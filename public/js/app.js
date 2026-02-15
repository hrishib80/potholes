let selectedFile = null;
let analysisResult = null;

document.addEventListener('DOMContentLoaded', () => {
    initUpload();
    initGeo();
    initForm();
    loadMyReports();
});

function initUpload() {
    const zone = document.getElementById('uploadZone');
    const input = document.getElementById('photoInput');

    zone.onclick = () => input.click();
    input.onchange = (e) => handleFile(e.target.files[0]);

    zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('dragover'); };
    zone.ondragleave = () => zone.classList.remove('dragover');
    zone.ondrop = (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        handleFile(e.dataTransfer.files[0]);
    };
}

function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    selectedFile = file;

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = document.getElementById('uploadPreview');
        img.src = e.target.result;
        document.getElementById('uploadZone').classList.add('has-image');
        runAnalysis(img);
    };
    reader.readAsDataURL(file);
}

async function runAnalysis(imgElement) {
    const spinner = document.getElementById('analyzingSpinner');
    const panel = document.getElementById('analysisPanel');

    spinner.style.display = 'flex';
    panel.classList.remove('visible');

    // Wait for image load
    await new Promise(r => setTimeout(r, 500)); // simulate delay
    if (!imgElement.complete) await new Promise(r => imgElement.onload = r);

    try {
        // Use the ML model
        analysisResult = await PotholeModel.analyze(imgElement);
        displayAnalysis(analysisResult);
    } catch (e) {
        console.error(e);
        showToast('Analysis failed, but you can still submit', 'error');
    }
    spinner.style.display = 'none';
}

function displayAnalysis(res) {
    const panel = document.getElementById('analysisPanel');
    panel.classList.add('visible');

    document.getElementById('resultDetected').textContent = res.isPothole ? 'YES' : 'NO';
    document.getElementById('resultConfidence').textContent = Math.round(res.confidence * 100) + '%';
    document.getElementById('confidenceBar').style.width = (res.confidence * 100) + '%';
    document.getElementById('resultSeverity').textContent = res.severity.toUpperCase();
    document.getElementById('resultSize').textContent = res.estimatedSize;

    checkSubmit();
}

function initGeo() {
    document.getElementById('geoBtn').onclick = () => {
        if (!navigator.geolocation) return showToast('Geolocation not supported', 'error');
        navigator.geolocation.getCurrentPosition(pos => {
            document.getElementById('latInput').value = pos.coords.latitude.toFixed(6);
            document.getElementById('lngInput').value = pos.coords.longitude.toFixed(6);
            checkSubmit();
        }, err => showToast(err.message, 'error'));
    };
}

function checkSubmit() {
    const hasFile = !!selectedFile;
    const hasLoc = !!document.getElementById('latInput').value;
    document.getElementById('submitBtn').disabled = !(hasFile && hasLoc);
}

function initForm() {
    document.getElementById('reportForm').onsubmit = async (e) => {
        e.preventDefault();
        const btn = document.getElementById('submitBtn');
        btn.disabled = true;
        btn.textContent = 'Submitting...';

        const formData = new FormData();
        formData.append('photo', selectedFile);
        formData.append('latitude', document.getElementById('latInput').value);
        formData.append('longitude', document.getElementById('lngInput').value);
        formData.append('description', document.getElementById('description').value);
        formData.append('road_type', document.getElementById('roadType').value);

        if (analysisResult) {
            formData.append('severity', analysisResult.severity);
            formData.append('confidence', analysisResult.confidence);
            formData.append('is_pothole', analysisResult.isPothole ? 1 : 0);
            formData.append('estimated_size', analysisResult.estimatedSize);
        }

        try {
            const res = await fetch('/api/reports', { method: 'POST', body: formData });
            if (!res.ok) throw new Error('Failed');
            document.getElementById('successOverlay').style.display = 'flex';
        } catch (e) {
            showToast('Submission failed', 'error');
            btn.disabled = false;
        }
    };
}

async function loadMyReports() {
    try {
        const res = await fetch('/api/reports/my');
        if (!res.ok) return;
        const reports = await res.json();
        if (reports.length > 0) {
            document.getElementById('myReportsSection').style.display = 'block';
            const list = document.getElementById('myReportsList');
            list.innerHTML = reports.map(r => `
                <div class="report-card">
                    <div class="report-card-body">
                        <img src="/uploads/${r.photo}" class="report-card-thumb">
                        <div class="report-card-info">
                            <p><strong>${r.description || 'Report'}</strong></p>
                            <p>${new Date(r.created_at).toLocaleDateString()}</p>
                            <div class="report-card-meta">
                                <span class="status-badge ${r.status}">${r.status}</span>
                                ${r.trust_level ? `<span class="trust-badge trust-${r.trust_level}">${r.trust_level} Trust</span>` : ''}
                            </div>
                            ${r.trust_level === 'low' ? '<p style="color:var(--severity-severe); font-size:0.75rem">⚠️ Low Trust: Resolution details mismatched</p>' : ''}
                        </div>
                    </div>
                </div>
            `).join('');
        }
    } catch (e) { }
}

function showToast(msg, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    document.getElementById('toastContainer').appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}
