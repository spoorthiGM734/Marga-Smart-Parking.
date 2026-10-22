PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'driver' CHECK (role IN ('driver','operator','admin')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vehicles (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reg_no  TEXT NOT NULL,
  type    TEXT NOT NULL DEFAULT 'car' CHECK (type IN ('car','suv','bike')),
  label   TEXT,
  UNIQUE (user_id, reg_no)
);

CREATE TABLE IF NOT EXISTS facilities (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id            INTEGER NOT NULL REFERENCES users(id),
  name                TEXT NOT NULL,
  address             TEXT NOT NULL,
  lat                 REAL NOT NULL,
  lng                 REAL NOT NULL,
  kind                TEXT NOT NULL DEFAULT 'garage' CHECK (kind IN ('garage','mall','open_ground','street','other')),
  description         TEXT,
  open_time           TEXT NOT NULL DEFAULT '06:00',
  close_time          TEXT NOT NULL DEFAULT '23:00',
  vehicle_types       TEXT NOT NULL DEFAULT 'car,suv,bike',
  width_m             REAL,
  length_m            REAL,
  layout_status       TEXT NOT NULL DEFAULT 'none' CHECK (layout_status IN ('none','draft','published')),
  verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending','approved','rejected')),
  authority_note      TEXT,
  review_note         TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tariffs (
  facility_id   INTEGER PRIMARY KEY REFERENCES facilities(id) ON DELETE CASCADE,
  hourly_rate   REAL NOT NULL DEFAULT 30,
  min_charge    REAL NOT NULL DEFAULT 0,
  grace_minutes INTEGER NOT NULL DEFAULT 0,
  daily_cap     REAL
);

-- Virtual parking spaces. x,y,w,h are in metres inside the site rectangle.
CREATE TABLE IF NOT EXISTS slots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  facility_id  INTEGER NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,
  x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL,
  vehicle_type TEXT NOT NULL DEFAULT 'car' CHECK (vehicle_type IN ('car','suv','bike')),
  is_active    INTEGER NOT NULL DEFAULT 1,
  UNIQUE (facility_id, label)
);

-- RESERVATION state lives here
CREATE TABLE IF NOT EXISTS bookings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ref          TEXT NOT NULL UNIQUE,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  facility_id  INTEGER NOT NULL REFERENCES facilities(id),
  slot_id      INTEGER NOT NULL REFERENCES slots(id),
  vehicle_id   INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  reg_no       TEXT NOT NULL,
  vehicle_type TEXT NOT NULL DEFAULT 'car',
  start_time   TEXT NOT NULL,
  end_time     TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'confirmed'
               CHECK (status IN ('confirmed','checked_in','completed','cancelled','no_show')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_bookings_slot ON bookings(slot_id, status, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_fac  ON bookings(facility_id);
-- Extra safety net: exact duplicate active reservations are rejected by the DB itself
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_exact
  ON bookings(slot_id, start_time, end_time) WHERE status IN ('confirmed','checked_in');

-- PHYSICAL OCCUPANCY state lives here (separate from reservations)
CREATE TABLE IF NOT EXISTS sessions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id         INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
  actual_slot_id     INTEGER REFERENCES slots(id),
  check_in_at        TEXT NOT NULL,
  check_out_at       TEXT,
  duration_min       INTEGER,
  fee                REAL,
  confirmed_by       TEXT NOT NULL CHECK (confirmed_by IN ('driver','operator')),
  occupancy_verified INTEGER NOT NULL DEFAULT 0,
  checkin_lat        REAL,
  checkin_lng        REAL,
  mismatch           INTEGER NOT NULL DEFAULT 0,
  resolution_note    TEXT
);
