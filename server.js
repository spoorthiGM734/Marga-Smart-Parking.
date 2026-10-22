require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { expireStale } = require('./services/booking'); // also opens + initialises the database

const app = express();
app.use(cors());
app.use(express.json({ limit: '200kb' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/facilities', require('./routes/facilities'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/operator', require('./routes/operator'));
app.use('/api/admin', require('./routes/admin'));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  if (!err.status) console.error(err);
  // UNIQUE index violation = someone else won the race for the same slot
  if (String(err.code || '').startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'That slot was just taken. Please choose another.' });
  res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong on the server' });
});

setInterval(expireStale, 60 * 1000); // release no-show reservations every minute

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MARGA running -> http://localhost:${PORT}`));
