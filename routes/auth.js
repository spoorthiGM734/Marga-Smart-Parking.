const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { sign, auth } = require('../middleware/auth');
const { fail } = require('../utils/http');

router.post('/register', (req, res) => {
  const { name, email, password, phone, role } = req.body || {};
  if (!name || name.trim().length < 2) fail(400, 'Please enter your name');
  if (!/^\S+@\S+\.\S+$/.test(email || '')) fail(400, 'Enter a valid email address');
  if (!password || password.length < 6) fail(400, 'Password must be at least 6 characters');
  const em = email.toLowerCase().trim();
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(em)) fail(409, 'This email is already registered');
  const r = role === 'operator' ? 'operator' : 'driver'; // admin can never be self-registered
  const id = db.prepare('INSERT INTO users(name,email,phone,password_hash,role) VALUES(?,?,?,?,?)')
    .run(name.trim(), em, (phone || '').trim(), bcrypt.hashSync(password, 10), r).lastInsertRowid;
  const user = { id, name: name.trim(), email: em, role: r };
  res.status(201).json({ token: sign(user), user });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').toLowerCase().trim());
  if (!u || !bcrypt.compareSync(password || '', u.password_hash)) fail(401, 'Incorrect email or password');
  const user = { id: u.id, name: u.name, email: u.email, role: u.role };
  res.json({ token: sign(user), user });
});

router.get('/me', auth, (req, res) => {
  const u = db.prepare('SELECT id,name,email,phone,role FROM users WHERE id=?').get(req.user.id);
  if (!u) fail(401, 'Account not found');
  res.json(u);
});

module.exports = router;
