const router = require('express').Router();
const QRCode = require('qrcode');
const db = require('../db/database');
const { auth } = require('../middleware/auth');
const { fail, wrap } = require('../utils/http');
const S = require('../services/booking');

router.use(auth);

router.post('/', (req, res) => {
  const id = S.createBooking(req.user.id, req.body || {});
  res.status(201).json({ id, booking: S.getBooking(id) });
});

router.get('/mine', (req, res) => {
  S.expireStale();
  const rows = db.prepare(S.BOOKING_SQL + ' WHERE b.user_id=? ORDER BY b.start_time DESC LIMIT 100').all(req.user.id);
  res.json(rows.map(S.withEstimate));
});

router.get('/:id', wrap(async (req, res) => {
  const b = S.getBooking(req.params.id);
  if (!b) fail(404, 'Booking not found');
  if (!(b.user_id === req.user.id || b.owner_id === req.user.id || req.user.role === 'admin')) fail(403, 'Not allowed');
  const qr = await QRCode.toDataURL(b.ref, { margin: 1, width: 260, color: { dark: '#1b1f2b', light: '#ffffff' } });
  res.json({ ...S.withEstimate(b), qr });
}));

const mine = (req) => {
  const b = S.getBooking(req.params.id);
  if (!b) fail(404, 'Booking not found');
  if (b.user_id !== req.user.id) fail(403, 'This is not your booking');
  return b;
};

router.post('/:id/cancel', (req, res) => { S.cancelBooking(req.params.id, req.user); res.json({ ok: true }); });

router.post('/:id/checkin', (req, res) => {
  const b = mine(req);
  const { lat, lng, actual_slot_id } = req.body || {};
  const r = S.checkIn(b.id, { by: 'driver', lat, lng, actualSlotId: actual_slot_id });
  res.json({ ok: true, mismatch: r.mismatch });
});

router.post('/:id/checkout', (req, res) => {
  const b = mine(req);
  res.json(S.checkOut(b.id));
});

module.exports = router;
