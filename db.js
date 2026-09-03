/* ============================================================
 * db.js
 * Couche de données minimaliste : un simple fichier JSON.
 * Pas de base de données externe à installer -- suffisant pour
 * un prototype/démonstration. À remplacer par une vraie base
 * (PostgreSQL, MongoDB...) si le projet grandit.
 * ============================================================ */

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data', 'db.json');

function readDB() {
  if (!fs.existsSync(DB_PATH)) {
    const empty = { users: [], children: [], positions: [] };
    fs.writeFileSync(DB_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  return JSON.parse(raw);
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

module.exports = { readDB, writeDB };
