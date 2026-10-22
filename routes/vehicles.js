const router = require('express').Router();
const db = require('../db/database');
const { auth } = require('../middleware/auth');
const { fail } = require('../utils/http');

router.use(auth);

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM vehicles WHERE user_id=? ORDER BY id DESC').all(req.user.id));
});

router.post('/', (req, res) => {
  const reg = String(req.body.reg_no || '').toUpperCase().replace(/\s+/g, '');
  const type = ['car', 'suv', 'bike'].includes(req.body.type) ? req.body.type : 'car';
  if (!/^[A-Z0-9-]{4,15}$/.test(reg)) fail(400, 'Enter a valid registration number');
  if (db.prepare('SELECT 1 FROM vehicles WHERE user_id=? AND reg_no=?').get(req.user.id, reg)) fail(409, 'Vehicle already added');
  const id = db.prepare('INSERT INTO vehicles(user_id,reg_no,type,label) VALUES(?,?,?,?)')
    .run(req.user.id, reg, type, String(req.body.label || '').trim()).lastInsertRowid;
  res.status(201).json(db.prepare('SELECT * FROM vehicles WHERE id=?').get(id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM vehicles WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
