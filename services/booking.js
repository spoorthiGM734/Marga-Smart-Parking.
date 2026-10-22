const crypto = require('crypto');
const db = require('../db/database');
const { calcFee } = require('../utils/pricing');
const { fail } = require('../utils/http');

const GRACE = Number(process.env.NO_SHOW_GRACE_MIN) || 30;

const compatible = (v, s) => (v === 'bike' ? s === 'bike' : v === 'car' ? s === 'car' || s === 'suv' : s === 'suv');

// Reservations not checked in within GRACE minutes of start become no-shows (slot is released)
function expireStale() {
  const cutoff = new Date(Date.now() - GRACE * 60000).toISOString();
  db.prepare("UPDATE bookings SET status='no_show' WHERE status='confirmed' AND start_time < ?").run(cutoff);
}

/* Slot states for a time window. RESERVED (booking) and OCCUPIED (physical) are kept separate. */
function slotStates(facilityId, start, end) {
  expireStale();
  const slots = db.prepare('SELECT * FROM slots WHERE facility_id=? ORDER BY id').all(facilityId);
  const booked = new Set(db.prepare(`
    SELECT slot_id FROM bookings
    WHERE facility_id=? AND status IN ('confirmed','checked_in') AND start_time < ? AND end_time > ?`)
    .all(facilityId, end, start).map((r) => r.slot_id));

  const occRows = db.prepare(`
    SELECT se.actual_slot_id sid, se.occupancy_verified v, b.end_time
    FROM sessions se JOIN bookings b ON b.id=se.booking_id
    WHERE se.check_out_at IS NULL AND b.facility_id=?`).all(facilityId);
  const nowIso = new Date().toISOString();
  const overstay = new Date(Date.now() + 30 * 60000).toISOString();
  const occ = new Map();
  for (const o of occRows) {
    const until = o.end_time > nowIso ? o.end_time : overstay;
    if (start < until) occ.set(o.sid, o.v);
  }
  return slots.map((s) => ({
    id: s.id, label: s.label, x: s.x, y: s.y, w: s.w, h: s.h, vehicle_type: s.vehicle_type, is_active: s.is_active,
    state: !s.is_active ? 'blocked' : occ.has(s.id) ? 'occupied' : booked.has(s.id) ? 'reserved' : 'available',
    occupancy_verified: occ.has(s.id) ? occ.get(s.id) : null,
  }));
}

/* ---------- Create booking: one IMMEDIATE transaction => no double booking ---------- */
const makeRef = () => 'MRG-' + crypto.randomBytes(4).toString('hex').toUpperCase();

const _create = db.transaction((userId, b) => {
  const s = new Date(b.start), e = new Date(b.end);
  if (isNaN(s) || isNaN(e)) fail(400, 'Invalid start or end time');
  if (e <= s) fail(400, 'End time must be after start time');
  if (s.getTime() < Date.now() - 5 * 60000) fail(400, 'Start time is in the past');
  if (e - s > 72 * 3600000) fail(400, 'Maximum booking length is 72 hours');

  const reg = String(b.reg_no || '').toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9-]{4,15}$/.test(reg)) fail(400, 'Enter a valid vehicle registration number');
  const vtype = ['car', 'suv', 'bike'].includes(b.vehicle_type) ? b.vehicle_type : 'car';

  const slot = db.prepare(`SELECT s.*, f.verification_status vs, f.layout_status ls
    FROM slots s JOIN facilities f ON f.id=s.facility_id WHERE s.id=?`).get(b.slot_id);
  if (!slot || !slot.is_active) fail(404, 'This slot is not available');
  if (slot.vs !== 'approved' || slot.ls !== 'published') fail(400, 'This facility is not open for bookings');
  if (!compatible(vtype, slot.vehicle_type)) fail(400, `${slot.label} is for ${slot.vehicle_type} vehicles`);

  const sIso = s.toISOString(), eIso = e.toISOString();
  const clash = db.prepare(`SELECT 1 FROM bookings WHERE slot_id=? AND status IN ('confirmed','checked_in')
    AND start_time < ? AND end_time > ?`).get(slot.id, eIso, sIso);
  if (clash) fail(409, `${slot.label} was just reserved for an overlapping time. Please pick another slot.`);

  const dup = db.prepare(`SELECT 1 FROM bookings WHERE user_id=? AND reg_no=? AND status IN ('confirmed','checked_in')
    AND start_time < ? AND end_time > ?`).get(userId, reg, eIso, sIso);
  if (dup) fail(409, 'This vehicle already has a booking for that time');

  let vehicleId = null;
  if (b.vehicle_id) {
    const v = db.prepare('SELECT id FROM vehicles WHERE id=? AND user_id=?').get(b.vehicle_id, userId);
    vehicleId = v ? v.id : null;
  }
  return db.prepare(`INSERT INTO bookings(ref,user_id,facility_id,slot_id,vehicle_id,reg_no,vehicle_type,start_time,end_time)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(makeRef(), userId, slot.facility_id, slot.id, vehicleId, reg, vtype, sIso, eIso).lastInsertRowid;
});
const createBooking = (userId, b) => { expireStale(); return _create.immediate(userId, b); };

/* ---------- Full booking row (joins) ---------- */
const BOOKING_SQL = `
SELECT b.*, f.name facility_name, f.address facility_address, f.lat, f.lng, f.owner_id,
  sl.label slot_label, u.name user_name, u.phone user_phone,
  se.id session_id, se.check_in_at, se.check_out_at, se.duration_min, se.fee, se.occupancy_verified,
  se.confirmed_by, se.mismatch, se.resolution_note, se.actual_slot_id, asl.label actual_slot_label,
  t.hourly_rate, t.min_charge, t.grace_minutes, t.daily_cap
FROM bookings b
JOIN facilities f ON f.id=b.facility_id
JOIN slots sl ON sl.id=b.slot_id
JOIN users u ON u.id=b.user_id
JOIN tariffs t ON t.facility_id=f.id
LEFT JOIN sessions se ON se.booking_id=b.id
LEFT JOIN slots asl ON asl.id=se.actual_slot_id`;

const getBooking = (id) => db.prepare(BOOKING_SQL + ' WHERE b.id=?').get(id);
const withEstimate = (b) => {
  if (b.status === 'checked_in' && b.check_in_at) {
    const mins = Math.max(1, Math.ceil((Date.now() - new Date(b.check_in_at)) / 60000));
    b.fee_estimate = calcFee(mins, b);
  }
  return b;
};

/* ---------- Check-in (driver = unverified, operator = verified) ---------- */
const _checkIn = db.transaction((id, { by, lat, lng, actualSlotId }) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
  if (!b) fail(404, 'Booking not found');
  if (b.status !== 'confirmed') fail(400, `This booking is ${b.status.replace('_', ' ')} and cannot be checked in`);
  const now = Date.now();
  if (now < new Date(b.start_time).getTime() - 15 * 60000) fail(400, 'Too early - check-in opens 15 minutes before start');
  if (now > new Date(b.end_time).getTime()) fail(400, 'This booking has already ended');

  let actual = b.slot_id;
  if (actualSlotId && Number(actualSlotId) !== b.slot_id) {
    const a = db.prepare('SELECT id FROM slots WHERE id=? AND facility_id=?').get(actualSlotId, b.facility_id);
    if (!a) fail(400, 'That slot does not belong to this facility');
    actual = a.id;
  }
  const mismatch = actual !== b.slot_id ? 1 : 0;
  db.prepare(`INSERT INTO sessions(booking_id,actual_slot_id,check_in_at,confirmed_by,occupancy_verified,checkin_lat,checkin_lng,mismatch)
    VALUES(?,?,?,?,?,?,?,?)`).run(id, actual, new Date().toISOString(), by, by === 'operator' ? 1 : 0, lat ?? null, lng ?? null, mismatch);
  db.prepare("UPDATE bookings SET status='checked_in' WHERE id=?").run(id);
  return { mismatch };
});
const checkIn = (id, opts) => { expireStale(); return _checkIn.immediate(id, opts); };

/* ---------- Check-out + billing ---------- */
const _checkOut = db.transaction((id) => {
  const b = db.prepare('SELECT * FROM bookings WHERE id=?').get(id);
  if (!b) fail(404, 'Booking not found');
  if (b.status !== 'checked_in') fail(400, 'This booking is not checked in');
  const se = db.prepare('SELECT * FROM sessions WHERE booking_id=?').get(id);
  const t = db.prepare('SELECT * FROM tariffs WHERE facility_id=?').get(b.facility_id);
  const out = new Date();
  const mins = Math.max(1, Math.ceil((out - new Date(se.check_in_at)) / 60000));
  const fee = calcFee(mins, t);
  db.prepare('UPDATE sessions SET check_out_at=?, duration_min=?, fee=? WHERE id=?').run(out.toISOString(), mins, fee, se.id);
  db.prepare("UPDATE bookings SET status='completed' WHERE id=?").run(id);
});
const checkOut = (id) => { _checkOut.immediate(id); return getBooking(id); };

/* ---------- Cancel ---------- */
function cancelBooking(id, user) {
  const b = getBooking(id);
  if (!b) fail(404, 'Booking not found');
  if (!(b.user_id === user.id || b.owner_id === user.id || user.role === 'admin')) fail(403, 'Not allowed');
  if (b.status !== 'confirmed') fail(400, 'Only confirmed bookings can be cancelled');
  db.prepare("UPDATE bookings SET status='cancelled' WHERE id=?").run(id);
}

module.exports = { expireStale, slotStates, compatible, createBooking, checkIn, checkOut, cancelBooking, getBooking, withEstimate, BOOKING_SQL };
