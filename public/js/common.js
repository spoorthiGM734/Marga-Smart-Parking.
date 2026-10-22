/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmt = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const toLocalInput = (d) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

const store = {
  get token() { return localStorage.getItem('marga_token'); },
  get user() { try { return JSON.parse(localStorage.getItem('marga_user')); } catch (e) { return null; } },
  save(t, u) { localStorage.setItem('marga_token', t); localStorage.setItem('marga_user', JSON.stringify(u)); },
  clear() { localStorage.removeItem('marga_token'); localStorage.removeItem('marga_user'); },
};
const HOME = { driver: '/dashboard.html', operator: '/operator.html', admin: '/admin.html' };

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (store.token) headers.Authorization = 'Bearer ' + store.token;
  const r = await fetch('/api' + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && store.token) { store.clear(); }
    throw new Error(d.error || 'Request failed');
  }
  return d;
}

function toast(msg, type = 'ok') {
  let box = $('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + (type === 'err' ? 'err' : '');
  t.textContent = msg; box.appendChild(t);
  setTimeout(() => t.remove(), 4200);
}

function modal(html, wide) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="modal-box${wide ? ' wide' : ''}"><button class="x" aria-label="Close">×</button>${html}</div>`;
  m.addEventListener('mousedown', (e) => { if (e.target === m || e.target.classList.contains('x')) m.remove(); });
  document.body.appendChild(m);
  m.close = () => m.remove();
  return m;
}

const PIN = `<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path fill="#b7ff3c" d="M12 1.5a8 8 0 0 0-8 8c0 5.6 6.2 11.6 7.1 12.4a1.3 1.3 0 0 0 1.8 0C13.8 21.1 20 15.1 20 9.5a8 8 0 0 0-8-8z"/><circle cx="12" cy="9.5" r="5" fill="#1b1f2b"/><text x="12" y="12.2" text-anchor="middle" font-size="7.5" font-weight="800" fill="#b7ff3c" font-family="Arial">P</text></svg>`;

function renderNav() {
  const u = store.user;
  $('nav').className = 'nav';
  $('nav').innerHTML = `<div class="wrap nav-in">
    <a href="/" class="brand">${PIN}<span>MARGA</span></a>
    <div class="nav-links">
      <a href="/search.html">Find parking</a>
      ${u ? `<a href="${HOME[u.role]}">Dashboard</a><a href="#" id="logout">Logout (${esc(u.name.split(' ')[0])})</a>`
          : `<a href="/auth.html">Log in</a><a class="btn sm" href="/auth.html?tab=register">Sign up</a>`}
    </div></div>`;
  const lo = $('logout');
  if (lo) lo.onclick = (e) => { e.preventDefault(); store.clear(); location.href = '/'; };
}

function requireRole(...roles) {
  const u = store.user;
  if (!u || !store.token) { location.href = '/auth.html?next=' + encodeURIComponent(location.pathname + location.search); return false; }
  if (roles.length && !roles.includes(u.role)) { location.href = HOME[u.role] || '/'; return false; }
  return true;
}

const BADGE = { confirmed: 'b-info', checked_in: 'b-ok', completed: 'b-mute', cancelled: 'b-err', no_show: 'b-warn',
  approved: 'b-ok', pending: 'b-warn', rejected: 'b-err', published: 'b-ok', draft: 'b-warn', none: 'b-mute' };
const badge = (s) => `<span class="badge ${BADGE[s] || 'b-mute'}">${esc(String(s).replace('_', ' '))}</span>`;

/* same pricing rules as the server (used only for the estimate shown before booking) */
function calcFee(mins, t) {
  if (mins <= (t.grace_minutes || 0)) return 0;
  const full = Math.floor(mins / 1440), rem = mins - full * 1440;
  const part = (m) => (m <= 0 ? 0 : Math.max(t.min_charge || 0, Math.ceil(m / 60) * t.hourly_rate));
  let r = part(rem); if (t.daily_cap) r = Math.min(r, t.daily_cap);
  return full * (t.daily_cap || 24 * t.hourly_rate) + r;
}

/* ---------- SVG parking layout (used by facility page + operator editor) ---------- */
function renderLayout(el, fac, slots, o = {}) {
  const W = fac.width_m, L = fac.length_m;
  let h = `<svg viewBox="-1 -1 ${W + 2} ${L + 4}" class="layout-svg" xmlns="http://www.w3.org/2000/svg"><rect class="site" x="0" y="0" width="${W}" height="${L}" rx=".4"/>`;
  slots.forEach((s) => {
    h += `<g class="slot ${s.state}${o.selected === s.id ? ' sel' : ''}" data-id="${s.id}">
      <rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx=".2"/>
      <text x="${s.x + s.w / 2}" y="${s.y + s.h / 2}" style="font-size:${Math.min(1.4, s.w * 0.5)}px">${esc(s.label.replace('Slot ', ''))}</text></g>`;
  });
  h += `<text class="ent" x="${W / 2}" y="${L + 2.2}">▲ ENTRANCE / EXIT</text></svg>`;
  el.innerHTML = h;
  const svg = el.querySelector('svg');
  const toSvg = (e) => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };

  el.querySelectorAll('.slot').forEach((g) => {
    const s = slots.find((x) => x.id === +g.dataset.id);
    if (o.onMove) { // operator editor: click to select, drag to move
      let st = null;
      g.addEventListener('pointerdown', (e) => { g.setPointerCapture(e.pointerId); st = { p: toSvg(e), x: s.x, y: s.y, moved: false, nx: s.x, ny: s.y }; });
      g.addEventListener('pointermove', (e) => {
        if (!st) return;
        const p = toSvg(e), dx = p.x - st.p.x, dy = p.y - st.p.y;
        if (Math.hypot(dx, dy) > 0.3) st.moved = true;
        if (!st.moved) return;
        st.nx = Math.min(Math.max(0, st.x + dx), W - s.w); st.ny = Math.min(Math.max(0, st.y + dy), L - s.h);
        g.setAttribute('transform', `translate(${st.nx - st.x},${st.ny - st.y})`);
      });
      g.addEventListener('pointerup', () => {
        if (!st) return;
        const r = st; st = null;
        if (r.moved) o.onMove(s.id, Math.round(r.nx * 10) / 10, Math.round(r.ny * 10) / 10);
        else if (o.onClick) o.onClick(s);
      });
    } else {
      g.addEventListener('click', () => o.onClick && o.onClick(s));
    }
  });
}

/* ---------- shared dialogs ---------- */
async function checkinDialog(b, url, byDriver, done) {
  const { slots } = await api(`/facilities/${b.facility_id}/slots?start=${encodeURIComponent(b.start_time)}&end=${encodeURIComponent(b.end_time)}`);
  const m = modal(`<h3>Check in · ${esc(b.reg_no)}</h3>
    <p class="muted mt">Booked slot: <b style="color:#fff">${esc(b.slot_label)}</b>. If the vehicle is actually in a different space, choose it so the operator can resolve it.</p>
    <label>Actual slot</label>
    <select id="ciSlot">${slots.filter((s) => s.state !== 'blocked').map((s) => `<option value="${s.id}" ${s.id === b.slot_id ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select>
    <p class="note">${byDriver ? 'If you allow it, your phone location is saved as supporting information only. It does not prove which space you are in, so this check-in is marked unverified until an operator confirms it.' : 'Confirmed by the operator - recorded as operator-verified.'}</p>
    <button class="btn block" id="ciGo">Confirm check-in</button>`);
  m.querySelector('#ciGo').onclick = async () => {
    const btn = m.querySelector('#ciGo'); btn.disabled = true;
    const pos = byDriver && navigator.geolocation
      ? await new Promise((r) => navigator.geolocation.getCurrentPosition((p) => r(p.coords), () => r(null), { timeout: 4000 })) : null;
    try {
      const r = await api(url, { method: 'POST', body: { actual_slot_id: +m.querySelector('#ciSlot').value, lat: pos && pos.latitude, lng: pos && pos.longitude } });
      m.close(); toast(r.mismatch ? 'Checked in - different slot recorded, operator will review' : 'Checked in'); done();
    } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
  };
}

function receiptModal(b) {
  modal(`<h3>Parking receipt</h3>
    <div class="kv mt"><span>Reference</span><b>${esc(b.ref)}</b><span>Facility</span><b>${esc(b.facility_name)}</b>
    <span>Booked slot</span><b>${esc(b.slot_label)}</b>${b.mismatch ? `<span>Actual slot</span><b>${esc(b.actual_slot_label)}</b>` : ''}
    <span>Vehicle</span><b>${esc(b.reg_no)}</b><span>Check-in</span><b>${fmt(b.check_in_at)}</b><span>Check-out</span><b>${fmt(b.check_out_at)}</b>
    <span>Duration</span><b>${Math.floor(b.duration_min / 60)}h ${b.duration_min % 60}m</b>
    <span>Tariff</span><b>${inr(b.hourly_rate)}/hr${b.daily_cap ? ', cap ' + inr(b.daily_cap) + '/day' : ''}</b></div>
    <h2 style="color:var(--lime)">Total: ${inr(b.fee)}</h2>
    <p class="note">Calculated from check-in / check-out events recorded in Marga (${b.occupancy_verified ? 'confirmed by operator' : 'confirmed by driver - unverified'}). Marga does not independently verify physical entry or exit.</p>`);
}
