const bcrypt = require('bcryptjs');
const { generateLayout } = require('../utils/layout');

module.exports = function seed(db) {
  const hash = (p) => bcrypt.hashSync(p, 10);
  const addUser = db.prepare('INSERT INTO users(name,email,phone,password_hash,role) VALUES(?,?,?,?,?)');
  addUser.run('Marga Admin', 'admin@marga.app', '9000000000', hash('Admin@123'), 'admin');
  const op = addUser.run('Demo Operator', 'operator@marga.app', '9000000001', hash('Operator@123'), 'operator').lastInsertRowid;
  const dr = addUser.run('Demo Driver', 'driver@marga.app', '9000000002', hash('Driver@123'), 'driver').lastInsertRowid;

  const addVeh = db.prepare('INSERT INTO vehicles(user_id,reg_no,type,label) VALUES(?,?,?,?)');
  addVeh.run(dr, 'DL01AB1234', 'car', 'My Swift');
  addVeh.run(dr, 'DL05XY9876', 'bike', 'Scooter');

  const addFac = db.prepare(`INSERT INTO facilities
    (owner_id,name,address,lat,lng,kind,description,open_time,close_time,width_m,length_m,layout_status,verification_status,authority_note)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const addTariff = db.prepare('INSERT INTO tariffs(facility_id,hourly_rate,min_charge,grace_minutes,daily_cap) VALUES(?,?,?,?,?)');
  const addSlot = db.prepare('INSERT INTO slots(facility_id,label,x,y,w,h,vehicle_type) VALUES(?,?,?,?,?,?,?)');

  const demo = [
    { name: 'Janpath Plaza Parking', address: 'Janpath, New Delhi', lat: 28.6254, lng: 77.2189, kind: 'garage',
      desc: 'Covered parking close to Janpath market.', w: 30, l: 20, rate: 40, cap: 300, max: 14, start: 1 },
    { name: 'Connaught Court Garage', address: 'Connaught Place, New Delhi', lat: 28.6322, lng: 77.2195, kind: 'garage',
      desc: 'Central garage for shoppers and office-goers.', w: 25, l: 20, rate: 60, cap: 400, max: 10, start: 1 },
    { name: 'Karol Bagh Open Ground', address: 'Karol Bagh, New Delhi', lat: 28.6514, lng: 77.1907, kind: 'open_ground',
      desc: 'Open ground - five spaces allocated to Marga.', w: 15, l: 12, rate: 20, cap: 150, max: 5, start: 31 },
    { name: 'Saket Mall Lot', address: 'Saket, New Delhi', lat: 28.5285, lng: 77.2190, kind: 'mall',
      desc: 'Mall visitor parking.', w: 30, l: 20, rate: 50, cap: 350, max: 12, start: 1 },
  ];

  for (const d of demo) {
    const id = addFac.run(op, d.name, d.address, d.lat, d.lng, d.kind, d.desc, '06:00', '23:00',
      d.w, d.l, 'published', 'approved', 'Seed data - verified').lastInsertRowid;
    addTariff.run(id, d.rate, 20, 10, d.cap);
    const slots = generateLayout({ width: d.w, length: d.l, vehicle: 'car', maxSlots: d.max, startNumber: d.start });
    for (const s of slots) addSlot.run(id, s.label, s.x, s.y, s.w, s.h, s.vehicle_type);
  }

  // One facility waiting for admin verification
  const p = addFac.run(op, 'Lajpat Nagar Community Ground', 'Lajpat Nagar, New Delhi', 28.5677, 77.2433, 'open_ground',
    'Open ground awaiting verification.', '08:00', '22:00', null, null, 'none', 'pending',
    'Owned by the resident welfare association; permission letter available.').lastInsertRowid;
  addTariff.run(p, 25, 20, 10, 200);
};
