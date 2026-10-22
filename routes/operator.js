const router = require('express').Router();
const db = require('../db/database');
const { auth, role } = require('../middleware/auth');
const { fail } = require('../utils/http');
const { generateLayout } = require('../utils/layout');
const S = require('../services/booking');

router.use(auth, role('operator', 'admin'));

const ownFacility = (req) => {
  const f = db.prepare('SELECT * FROM facilities WHERE id=?').get(req.params.id);
  if (!f) fail(404, 'Facility not found');
  if (req.user.role !== 'admin' && f.owner_id !== req.user.id) fail(403, 'This is not your facility');
  return f;
};
const ownBooking = (req) => {
  const b = S.getBooking(req.params.id);
  if (!b) fail(404, 'Booking not found');
  if (req.user.role !== 'admin' && b.owner_id !== req.user.id) fail(403, 'Not your facility');
  return b;
};

function clean(b) {
  const n = (v, d) => { const x = parseFloat(v); return isFinite(x) ? x : d; };
  const o = {
    name: String(b.name || '').trim(), address: String(b.address || '').trim(),
    lat: n(b.lat), lng: n(b.lng),
    kind: ['garage', 'mall', 'open_ground', 'street', 'other'].includes(b.kind) ? b.kind : 'garage',
    description: String(b.description || '').trim(),
    open_time: /^\d\d:\d\d$/.test(b.open_time) ? b.open_time : '06:00',
    close_time: /^\d\d:\d\d$/.test(b.close_time) ? b.close_time : '23:00',
    vehicle_types: String(b.vehicle_types || 'car').split(',').filter((v) => ['car', 'suv', 'bike'].includes(v)).join(',') || 'car',
    authority_note: String(b.authority_note || '').trim(),
    hourly_rate: n(b.hourly_rate, 30), min_charge: n(b.min_charge, 0),
    grace_minutes: Math.round(n(b.grace_minutes, 0)),
    daily_cap: b.daily_cap === '' || b.daily_cap == null ? null : n(b.daily_cap, null),
  };
  if (o.name.length < 3) fail(400, 'Facility name is required');
  if (o.address.length < 5) fail(400, 'Address is required');
  if (o.lat == null || o.lng == null || Math.abs(o.lat) > 90 || Math.abs(o.lng) > 180) fail(400, 'Pick the location on the map');
  if (o.authority_note.length < 10) fail(400, 'Describe your ownership / authority to operate this site (min 10 characters)');
  if (o.hourly_rate < 0 || o.min_charge < 0 || o.grace_minutes < 0) fail(400, 'Tariff values cannot be negative');
  return o;
}

/* ---- Facilities ---- */
router.get('/facilities', (req, res) => {
  const where = req.user.role === 'admin' ? '' : 'WHERE f.owner_id=' + Number(req.user.id);
  res.json(db.prepare(`SELECT f.*, t.hourly_rate,t.min_charge,t.grace_minutes,t.daily_cap
    FROM facilities f LEFT JOIN tariffs t ON t.facility_id=f.id ${where} ORDER BY f.id DESC`).all());
});

router.post('/facilities', (req, res) => {
  const o = clean(req.body || {});
  const id = db.transaction(() => {
    const fid = db.prepare(`INSERT INTO facilities(owner_id,name,address,lat,lng,kind,description,open_time,close_time,vehicle_types,authority_note)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(req.user.id, o.name, o.address, o.lat, o.lng, o.kind, o.description,
      o.open_time, o.close_time, o.vehicle_types, o.authority_note).lastInsertRowid;
    db.prepare('INSERT INTO tariffs(facility_id,hourly_rate,min_charge,grace_minutes,daily_cap) VALUES(?,?,?,?,?)')
      .run(fid, o.hourly_rate, o.min_charge, o.grace_minutes, o.daily_cap);
    return fid;
  })();
  res.status(201).json({ id });
});

router.put('/facilities/:id', (req, res) => {
  const f = ownFacility(req);
  const o = clean(req.body || {});
  db.transaction(() => {
    db.prepare(`UPDATE facilities SET name=?,address=?,lat=?,lng=?,kind=?,description=?,open_time=?,close_time=?,vehicle_types=?,authority_note=? WHERE id=?`)
      .run(o.name, o.address, o.lat, o.lng, o.kind, o.description, o.open_time, o.close_time, o.vehicle_types, o.authority_note, f.id);
    db.prepare('UPDATE tariffs SET hourly_rate=?,min_charge=?,grace_minutes=?,daily_cap=? WHERE facility_id=?')
      .run(o.hourly_rate, o.min_charge, o.grace_minutes, o.daily_cap, f.id);
  })();
  res.json({ ok: true });
});

router.get('/facilities/:id/stats', (req, res) => {
  const f = ownFacility(req);
  S.expireStale();
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const d1 = new Date(d0.getTime() + 86400000);
  const one = (sql, ...p) => db.prepare(sql).get(...p).c;
  res.json({
    active_slots: one('SELECT COUNT(*) c FROM slots WHERE facility_id=? AND is_active=1', f.id),
    bookings_today: one(`SELECT COUNT(*) c FROM bookings WHERE facility_id=? AND start_time>=? AND start_time<? AND status!='cancelled'`, f.id, d0.toISOString(), d1.toISOString()),
    parked_now: one(`SELECT COUNT(*) c FROM sessions se JOIN bookings b ON b.id=se.booking_id WHERE b.facility_id=? AND se.check_out_at IS NULL`, f.id),
    upcoming: one(`SELECT COUNT(*) c FROM bookings WHERE facility_id=? AND status='confirmed' AND end_time>?`, f.id, new Date().toISOString()),
    mismatches: one(`SELECT COUNT(*) c FROM sessions se JOIN bookings b ON b.id=se.booking_id WHERE b.facility_id=? AND se.mismatch=1 AND se.resolution_note IS NULL`, f.id),
    revenue_today: db.prepare(`SELECT COALESCE(SUM(se.fee),0) c FROM sessions se JOIN bookings b ON b.id=se.booking_id WHERE b.facility_id=? AND se.check_out_at>=?`).get(f.id, d0.toISOString()).c,
  });
});

/* ---- Layout generator and editor ---- */
router.get('/facilities/:id/slots', (req, res) => {
  const f = ownFacility(req);
  const now = new Date();
  res.json({
    facility: { id: f.id, width_m: f.width_m, length_m: f.length_m, layout_status: f.layout_status },
    slots: S.slotStates(f.id, now.toISOString(), new Date(now.getTime() + 3600e3).toISOString()),
  });
});

router.post('/facilities/:id/layout/generate', (req, res) => {
  const f = ownFacility(req);
  if (db.prepare('SELECT 1 FROM bookings WHERE facility_id=? LIMIT 1').get(f.id))
    fail(409, 'This facility already has bookings, so the layout cannot be regenerated. Edit individual slots instead.');
  const b = req.body || {};
  const obstacles = (Array.isArray(b.obstacles) ? b.obstacles : []).map((o) => ({ x: +o.x, y: +o.y, w: +o.w, h: +o.h }))
    .filter((o) => [o.x, o.y, o.w, o.h].every(isFinite));
  let slots;
  try {
    slots = generateLayout({ width: b.width, length: b.length, vehicle: b.vehicle, aisle: b.aisle,
      obstacles, maxSlots: Math.max(0, parseInt(b.maxSlots) || 0), startNumber: parseInt(b.startNumber) || 1 });
  } catch (e) { fail(400, e.message); }
  db.transaction(() => {
    db.prepare('DELETE FROM slots WHERE facility_id=?').run(f.id);
    const ins = db.prepare('INSERT INTO slots(facility_id,label,x,y,w,h,vehicle_type) VALUES(?,?,?,?,?,?,?)');
    slots.forEach((s) => ins.run(f.id, s.label, s.x, s.y, s.w, s.h, s.vehicle_type));
    db.prepare("UPDATE facilities SET width_m=?, length_m=?, layout_status='draft' WHERE id=?").run(+b.width, +b.length, f.id);
  })();
  res.json({ count: slots.length });
});

router.patch('/slots/:id', (req, res) => {
  const s = db.prepare('SELECT s.*, f.owner_id, f.width_m, f.length_m FROM slots s JOIN facilities f ON f.id=s.facility_id WHERE s.id=?').get(req.params.id);
  if (!s) fail(404, 'Slot not found');
  if (req.user.role !== 'admin' && s.owner_id !== req.user.id) fail(403, 'Not your facility');
  if (db.prepare(`SELECT 1 FROM bookings WHERE slot_id=? AND status IN ('confirmed','checked_in')`).get(s.id))
    fail(409, 'This slot has active bookings and cannot be changed right now');
  const x = req.body.x != null ? +req.body.x : s.x, y = req.body.y != null ? +req.body.y : s.y;
  if (!isFinite(x) || !isFinite(y) || x < 0 || y < 0 || x + s.w > s.width_m + 1e-6 || y + s.h > s.length_m + 1e-6) fail(400, 'Slot must stay inside the site');
  const active = req.body.is_active != null ? (req.body.is_active ? 1 : 0) : s.is_active;
  db.prepare('UPDATE slots SET x=?, y=?, is_active=? WHERE id=?').run(+x.toFixed(2), +y.toFixed(2), active, s.id);
  res.json({ ok: true });
});

router.post('/facilities/:id/layout/publish', (req, res) => {
  const f = ownFacility(req);
  if (!db.prepare('SELECT 1 FROM slots WHERE facility_id=? AND is_active=1').get(f.id)) fail(400, 'Generate a layout with at least one active slot first');
  db.prepare("UPDATE facilities SET layout_status='published' WHERE id=?").run(f.id);
  res.json({ ok: true, note: f.verification_status === 'approved' ? 'Published. Drivers can now book.' : 'Layout saved. It becomes bookable once an admin approves the facility.' });
});

/* ---- Bookings, check-in/out (operator-verified) ---- */
router.get('/facilities/:id/bookings', (req, res) => {
  const f = ownFacility(req);
  S.expireStale();
  res.json(db.prepare(S.BOOKING_SQL + ' WHERE b.facility_id=? ORDER BY b.start_time DESC LIMIT 200').all(f.id).map(S.withEstimate));
});

router.post('/bookings/:id/checkin', (req, res) => {
  const b = ownBooking(req);
  const r = S.checkIn(b.id, { by: 'operator', actualSlotId: (req.body || {}).actual_slot_id });
  res.json({ ok: true, mismatch: r.mismatch });
});
router.post('/bookings/:id/checkout', (req, res) => res.json(S.checkOut(ownBooking(req).id)));
router.post('/bookings/:id/cancel', (req, res) => { S.cancelBooking(ownBooking(req).id, req.user); res.json({ ok: true }); });
router.post('/bookings/:id/resolve', (req, res) => {
  const b = ownBooking(req);
  const note = String((req.body || {}).note || '').trim();
  if (!b.session_id || !note) fail(400, 'A resolution note is required');
  db.prepare('UPDATE sessions SET resolution_note=? WHERE id=?').run(note, b.session_id);
  res.json({ ok: true });
});
// Operator confirms on site that the driver's vehicle is really in the slot -> occupancy becomes "verified"
router.post('/bookings/:id/verify', (req, res) => {
  const b = ownBooking(req);
  if (b.status !== 'checked_in' || !b.session_id) fail(400, 'Only checked-in bookings can be verified');
  db.prepare("UPDATE sessions SET occupancy_verified=1, confirmed_by='operator' WHERE id=?").run(b.session_id);
  res.json({ ok: true });
});

module.exports = router;
