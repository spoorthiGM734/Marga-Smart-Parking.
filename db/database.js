const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const file = process.env.DB_FILE || path.join(__dirname, 'marga.db');
const db = new Database(file);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

// First run: fill with demo data
if (db.prepare('SELECT COUNT(*) c FROM users').get().c === 0) {
  require('./seed')(db);
  console.log('Database seeded with demo data.');
}

module.exports = db;
