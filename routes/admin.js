const router = require('express').Router();
const db = require('../db/database');
const { auth, role } = require('../middleware/auth');
const { fail } = require('../utils/http');

router.use(auth, role('admin'));

router.get('/facilities', (req, res) => {
  const st = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null;
  const sql = `SELECT f.*, u.name owner_name, u.email owner_email, t.hourly_rate,
      (SELECT COUNT(*) FROM slots s WHERE s.facility_id=f.id AND s.is_active=1) slot_count
    FROM facilities f JOIN users u ON u.id=f.owner_id LEFT JOIN tariffs t ON t.facility_id=f.id
    ${st ? 'WHERE f.verification_status=?' : ''} ORDER BY f.id DESC`;
  res.json(st ? db.prepare(sql).all(st) : db.prepare(sql).all());
});

router.post('/facilities/:id/review', (req, res) => {
  const { status, note } = req.body || {};
  if (!['approved', 'rejected'].includes(status)) fail(400, 'Status must be approved or rejected');
  const r = db.prepare('UPDATE facilities SET verification_status=?, review_note=? WHERE id=?').run(status, String(note || '').trim(), req.params.id);
  if (!r.changes) fail(404, 'Facility not found');
  res.json({ ok: true });
});

router.get('/stats', (req, res) => {
  const c = (sql) => db.prepare(sql).get().c;
  res.json({
    drivers: c("SELECT COUNT(*) c FROM users WHERE role='driver'"),
    operators: c("SELECT COUNT(*) c FROM users WHERE role='operator'"),
    facilities: c('SELECT COUNT(*) c FROM facilities'),
    pending: c("SELECT COUNT(*) c FROM facilities WHERE verification_status='pending'"),
    bookings: c('SELECT COUNT(*) c FROM bookings'),
    revenue: c('SELECT COALESCE(SUM(fee),0) c FROM sessions'),
  });
});

module.exports = router;
