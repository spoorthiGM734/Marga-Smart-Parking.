const router = require('express').Router();
const db = require('../db/database');
const { fail } = require('../utils/http');
const { calcFee } = require('../utils/pricing');
const { slotStates, compatible, expireStale } = require('../services/booking');

const haversine = (a, b, c, d) => {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (c - a) * rad, dLng = (d - b) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};

/* Destination-centred search with explainable ranking */
router.get('/search', (req, res) => {
  expireStale();
  const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
  if (!isFinite(lat) || !isFinite(lng)) fail(400, 'Destination coordinates are required');
  const radius = Math.min(Math.max(parseFloat(req.query.radius) || 1, 0.2), 10);
  const start = req.query.start ? new Date(req.query.start) : new Date();
  const end = req.query.end ? new Date(req.query.end) : new Date(start.getTime() + 2 * 3600e3);
  if (isNaN(start) || isNaN(end) || end <= start) fail(400, 'Invalid time window');
  const vehicle = ['car', 'suv', 'bike'].includes(req.query.vehicle) ? req.query.vehicle : 'car';
  const pref = ['cheapest', 'closest', 'balanced'].includes(req.query.pref) ? req.query.pref : 'balanced';

  const rows = db.prepare(`
    SELECT f.id,f.name,f.address,f.lat,f.lng,f.kind,f.open_time,f.close_time,f.vehicle_types,
           t.hourly_rate,t.min_charge,t.grace_minutes,t.daily_cap
    FROM facilities f JOIN tariffs t ON t.facility_id=f.id
    WHERE f.verification_status='approved' AND f.layout_status='published'`).all();

  const mins = Math.ceil((end - start) / 60000);
  let list = rows.map((f) => ({ ...f, distance_km: haversine(lat, lng, f.lat, f.lng) }))
    .filter((f) => f.distance_km <= radius)
    .map((f) => {
      const states = slotStates(f.id, start.toISOString(), end.toISOString());
      const fit = states.filter((s) => s.state !== 'blocked' && compatible(vehicle, s.vehicle_type));
      return {
        ...f,
        total: fit.length,
        available: fit.filter((s) => s.state === 'available').length,
        walk_min: Math.max(1, Math.round((f.distance_km * 1.3 / 5) * 60)),
        est_cost: calcFee(mins, f),
      };
    });

  if (!list.length) return res.json({ results: [], radius });

  const rates = list.map((f) => f.hourly_rate), dists = list.map((f) => f.distance_km);
  const minR = Math.min(...rates), maxR = Math.max(...rates), minD = Math.min(...dists);
  const W = { cheapest: [0.6, 0.2, 0.2], closest: [0.2, 0.6, 0.2], balanced: [0.35, 0.35, 0.3] }[pref];

  list.forEach((f) => {
    const p = maxR === minR ? 1 : 1 - (f.hourly_rate - minR) / (maxR - minR);
    const d = 1 - f.distance_km / radius;
    const a = f.total ? Math.min(1, f.available / Math.min(f.total, 5)) : 0;
    f.score = +((W[0] * p + W[1] * d + W[2] * a) * (f.available ? 1 : 0.1)).toFixed(3);
    f.reasons = [];
    if (f.available) {
      if (list.length > 1 && f.hourly_rate === minR) f.reasons.push(`Lowest hourly rate in range (Rs ${f.hourly_rate}/hr)`);
      else f.reasons.push(`Rs ${f.hourly_rate}/hr`);
    }
    if (list.length > 1 && f.distance_km === minD) f.reasons.push('Closest to your destination');
    f.reasons.push(`About ${f.walk_min} min walk (${Math.round(f.distance_km * 1000)} m straight-line)`);
    f.reasons.push(`${f.available} of ${f.total} compatible spaces free for your time`);
    if (f.available > 0 && f.available <= 2) f.reasons.push('Filling up - only a few spaces left');
    if (!f.available) f.reasons.push('Fully reserved for this time - see the alternatives');
  });

  list.sort((a, b) => (!!b.available - !!a.available) || b.score - a.score);
  res.json({
    results: list, radius,
    note: 'Walking distance is a straight-line estimate. Availability is the operator-reported inventory managed by Marga.',
  });
});

function publicFacility(id) {
  const f = db.prepare(`SELECT f.*, t.hourly_rate,t.min_charge,t.grace_minutes,t.daily_cap
    FROM facilities f JOIN tariffs t ON t.facility_id=f.id WHERE f.id=?`).get(id);
  if (!f || f.verification_status !== 'approved' || f.layout_status !== 'published') fail(404, 'Facility not found');
  delete f.authority_note; delete f.review_note;
  return f;
}

router.get('/:id', (req, res) => res.json(publicFacility(req.params.id)));

router.get('/:id/slots', (req, res) => {
  const f = publicFacility(req.params.id);
  const start = req.query.start ? new Date(req.query.start) : new Date();
  const end = req.query.end ? new Date(req.query.end) : new Date(start.getTime() + 2 * 3600e3);
  if (isNaN(start) || isNaN(end) || end <= start) fail(400, 'Invalid time window');
  res.json({
    facility: { id: f.id, width_m: f.width_m, length_m: f.length_m },
    slots: slotStates(f.id, start.toISOString(), end.toISOString()),
  });
});

module.exports = router;
