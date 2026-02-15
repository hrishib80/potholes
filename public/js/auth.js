// ─── Auth Logic ───────────────────────────────────────────────
const Auth = {
    user: null,

    async check() {
        try {
            const res = await fetch('/api/auth/me');
            if (res.ok) {
                const data = await res.json();
                this.user = data.user;
                this.updateUI();
            } else {
                this.user = null;
                this.updateUI();
            }
        } catch (e) { console.error(e); }
    },

    async login(username, password) {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        window.location.href = data.user.role === 'municipal' ? 'dashboard.html' : 'index.html';
    },

    async register(username, password, role) {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, role })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        window.location.href = 'login.html';
    },

    async logout() {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = 'index.html';
    },

    updateUI() {
        // Shared UI updates
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) logoutBtn.onclick = this.logout;

        const authLinks = document.getElementById('authLinks');
        const userMenu = document.getElementById('userMenu');
        const dashLink = document.getElementById('dashLink');

        if (this.user) {
            if (authLinks) authLinks.style.display = 'none';
            if (userMenu) {
                userMenu.style.display = 'flex';
                document.getElementById('usernameDisplay').textContent = this.user.username;
            }
            if (dashLink && this.user.role === 'municipal') dashLink.style.display = 'block';
        } else {
            if (authLinks) authLinks.style.display = 'flex';
            if (userMenu) userMenu.style.display = 'none';
            if (dashLink) dashLink.style.display = 'none';
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    Auth.check();
});
