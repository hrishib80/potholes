const express = require('express');
const multer = require('multer');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Session
app.use(session({
    secret: 'potholescan-secret-' + (process.env.SESSION_SECRET || 'dev-key-2024'),
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
}));

// Database
const db = new Database('pothole.db');
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT DEFAULT 'citizen',
        created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        photo TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        description TEXT DEFAULT '',
        severity TEXT DEFAULT 'unknown',
        confidence REAL DEFAULT 0,
        is_pothole INTEGER DEFAULT 1,
        estimated_size TEXT DEFAULT '',
        status TEXT DEFAULT 'pending',
        reporter_name TEXT DEFAULT 'Anonymous',
        reporter_id TEXT DEFAULT '',
        road_type TEXT DEFAULT '',
        estimated_hours REAL DEFAULT 0,
        progress_notes TEXT DEFAULT '',
        started_at TEXT DEFAULT '',
        resolved_at TEXT DEFAULT '',
        resolution_photo TEXT DEFAULT '',
        resolution_lat REAL DEFAULT 0,
        resolution_lng REAL DEFAULT 0,
        distance_m REAL DEFAULT 0,
        similarity_score REAL DEFAULT 0,
        trust_level TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
    );
`);

// Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = 'uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, uuidv4() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// Auth Middleware
function requireAuth(req, res, next) {
    if (req.session.userId) return next();
    res.status(401).json({ error: 'Unauthorized' });
}
function requireMunicipal(req, res, next) {
    if (req.session.userId && req.session.role === 'municipal') return next();
    res.status(403).json({ error: 'Forbidden: Municipal access only' });
}

// Helpers
function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeTrust(similarity, distance) {
    if (similarity >= 70 && distance <= 10) return 'high';
    if (similarity >= 40 && distance <= 20) return 'medium';
    return 'low';
}

// ─── Auth Routes ────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
    const { username, password, role } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const id = uuidv4();
        const userRole = role === 'municipal' ? 'municipal' : 'citizen';
        db.prepare('INSERT INTO users (id, username, password, role) VALUES (?, ?, ?, ?)').run(id, username, hashedPassword, userRole);
        req.session.userId = id;
        req.session.username = username;
        req.session.role = userRole;
        res.json({ message: 'Registered successfully', user: { id, username, role: userRole } });
    } catch (err) {
        if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(400).json({ error: 'Username already exists' });
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        if (!user || !(await bcrypt.compare(password, user.password)))
            return res.status(400).json({ error: 'Invalid credentials' });
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.role = user.role;
        res.json({ message: 'Login successful', user: { id: user.id, username: user.username, role: user.role } });
    } catch (err) { res.status(500).json({ error: 'Login failed' }); }
});

app.post('/api/auth/logout', (req, res) => { req.session.destroy(); res.json({ message: 'Logged out' }); });

app.get('/api/auth/me', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    res.json({ user: { id: req.session.userId, username: req.session.username, role: req.session.role } });
});

// ─── Report Routes ──────────────────────────────────────────────
app.post('/api/reports', upload.single('photo'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });
        const { latitude, longitude, description, severity, confidence, is_pothole, estimated_size, road_type } = req.body;
        const id = uuidv4();
        const reporterId = req.session.userId || '';
        const reporterName = req.session.username || 'Anonymous';
        db.prepare(`INSERT INTO reports (id, photo, latitude, longitude, description, severity, confidence, is_pothole, estimated_size, road_type, reporter_id, reporter_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(id, req.file.filename, parseFloat(latitude), parseFloat(longitude), description || '', severity || 'unknown', parseFloat(confidence) || 0, parseInt(is_pothole) || 1, estimated_size || '', road_type || '', reporterId, reporterName);
        res.json({ success: true, id });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Database error' }); }
});

app.get('/api/reports', (req, res) => {
    const reports = db.prepare('SELECT * FROM reports ORDER BY created_at DESC').all();
    res.json(reports);
});

app.get('/api/reports/my', requireAuth, (req, res) => {
    const reports = db.prepare('SELECT * FROM reports WHERE reporter_id = ? ORDER BY created_at DESC').all(req.session.userId);
    res.json(reports);
});

app.patch('/api/reports/:id/progress', requireMunicipal, (req, res) => {
    const { id } = req.params;
    const { estimated_hours, progress_notes } = req.body;
    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    const updates = [];
    const params = [];
    if (report.status === 'pending') {
        updates.push("status = 'in-progress'");
        updates.push("started_at = datetime('now')");
    }
    if (estimated_hours !== undefined) { updates.push("estimated_hours = ?"); params.push(estimated_hours); }
    if (progress_notes) { updates.push("progress_notes = ?"); params.push(progress_notes); }
    if (updates.length > 0) {
        params.push(id);
        db.prepare(`UPDATE reports SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }
    res.json({ success: true });
});

app.post('/api/reports/:id/resolve', requireMunicipal, upload.single('resolution_photo'), (req, res) => {
    const { id } = req.params;
    const { resolution_lat, resolution_lng } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No resolution photo' });
    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    const dist = haversine(report.latitude, report.longitude, parseFloat(resolution_lat), parseFloat(resolution_lng));
    if (dist > 20) { fs.unlinkSync(req.file.path); return res.status(400).json({ error: `Resolution location is ${Math.round(dist)}m away. Must be within 20m.` }); }
    db.prepare(`UPDATE reports SET resolution_photo = ?, resolution_lat = ?, resolution_lng = ?, distance_m = ? WHERE id = ?`)
        .run(req.file.filename, resolution_lat, resolution_lng, dist, id);
    res.json({ success: true, original_photo: report.photo, resolution_photo: req.file.filename, distance_m: Math.round(dist * 10) / 10 });
});

app.patch('/api/reports/:id/finalize', requireMunicipal, (req, res) => {
    const { id } = req.params;
    const { similarity_score } = req.body;
    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    const trust = computeTrust(parseFloat(similarity_score), report.distance_m);
    db.prepare(`UPDATE reports SET status = 'resolved', resolved_at = datetime('now'), similarity_score = ?, trust_level = ? WHERE id = ?`)
        .run(parseFloat(similarity_score), trust, id);
    res.json({ success: true, trust_level: trust });
});

app.delete('/api/reports/:id', requireMunicipal, (req, res) => {
    db.prepare('DELETE FROM reports WHERE id = ?').run(req.params.id);
    res.json({ success: true });
});

app.get('/api/stats', (req, res) => {
    const total = db.prepare('SELECT COUNT(*) as count FROM reports').get().count;
    const pending = db.prepare("SELECT COUNT(*) as count FROM reports WHERE status = 'pending'").get().count;
    const resolved = db.prepare("SELECT COUNT(*) as count FROM reports WHERE status = 'resolved'").get().count;
    const severityData = db.prepare('SELECT severity, COUNT(*) as count FROM reports GROUP BY severity').all();
    const bySeverity = {};
    severityData.forEach(r => bySeverity[r.severity] = r.count);
    const resolvedReports = db.prepare("SELECT started_at, resolved_at FROM reports WHERE status = 'resolved'").all();
    let totalTime = 0, count = 0;
    resolvedReports.forEach(r => {
        if (r.started_at && r.resolved_at) {
            const diff = (new Date(r.resolved_at + 'Z') - new Date(r.started_at + 'Z')) / 3600000;
            if (diff > 0) { totalTime += diff; count++; }
        }
    });
    res.json({ total, pending, resolved, bySeverity, avgResolutionTime: count ? (totalTime / count).toFixed(1) : 0 });
});

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
