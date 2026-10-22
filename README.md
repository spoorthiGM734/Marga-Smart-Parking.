# MARGA – Find · Book · Move

Smart parking platform: Node.js + Express + SQLite, plain HTML/CSS/JS frontend.

## Run
1. Install Node.js 18+ (https://nodejs.org)
2. Open this folder in VS Code, then in the terminal:
   npm install
   npm start
3. Open http://localhost:3000

The database (db/marga.db) is created and filled with demo data on first run.
To reset everything: stop the server, delete db/marga.db (and any .db-shm / .db-wal files), start again.

## Demo logins
- Driver:   driver@marga.app   / Driver@123
- Operator: operator@marga.app / Operator@123
- Admin:    admin@marga.app    / Admin@123
- On the landing page, search for “Connaught Place” and review the ranked results with reasons.
## Folders
- server.js            entry point
- db/                  schema.sql, database.js, seed.js
- routes/              auth, vehicles, facilities, bookings, operator, admin APIs
- services/booking.js  booking, double-booking prevention, check-in/out, billing
- utils/               layout generator, pricing
- public/              all frontend pages, css, js and logo

Before deploying: change JWT_SECRET in .env.
