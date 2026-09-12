/* ============================================================
 * server.js
 * Serveur principal : sert le site, gère les comptes parents,
 * les enfants/trackers associés, et reçoit les positions GPS
 * envoyées par le firmware PIC (POST /api/position).
 * ============================================================ */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const { readDB, writeDB } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

/* Clé de signature des sessions -- en production, mets ceci dans
 * une variable d'environnement plutôt qu'en dur dans le code. */
const JWT_SECRET = process.env.JWT_SECRET || 'change-moi-avant-la-mise-en-ligne';

app.use(express.json());
app.use(cookieParser());
app.use(express.static('public'));

/* ---------- Middleware d'authentification (comptes parents) ---------- */

function requireAuth(req, res, next) {
  const token = req.cookies.session;
  if (!token) {
    return res.status(401).json({ error: 'Non connecté.' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session invalide ou expirée.' });
  }
}

/* ---------- Comptes parents ---------- */

app.post('/api/auth/register', (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: 'Email et mot de passe (6 caractères min.) requis.' });
  }

  const db = readDB();
  if (db.users.find(u => u.email === email)) {
    return res.status(409).json({ error: 'Un compte existe déjà avec cet email.' });
  }

  const user = {
    id: crypto.randomUUID(),
    email,
    name: name || '',
    passwordHash: bcrypt.hashSync(password, 10),
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  writeDB(db);

  res.status(201).json({ message: 'Compte créé avec succès.' });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const db = readDB();
  const user = db.users.find(u => u.email === email);

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Email ou mot de passe incorrect.' });
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('session', token, {
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  });
  res.json({ message: 'Connexion réussie.', name: user.name || user.email });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('session');
  res.json({ message: 'Déconnecté.' });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const db = readDB();
  const user = db.users.find(u => u.id === req.userId);
  res.json({ email: user.email, name: user.name || '' });
});

/* ---------- Enfants / trackers ---------- */

/* Liste les enfants (et trackers associés) du parent connecté */
app.get('/api/children', requireAuth, (req, res) => {
  const db = readDB();
  const mine = db.children.filter(c => c.parentId === req.userId);
  res.json(mine);
});

/* Ajoute un enfant + son identifiant de tracker (deviceId, celui
 * réglé dans le firmware sous DEVICE_ID) */
app.post('/api/children', requireAuth, (req, res) => {
  const { name, deviceId } = req.body;

  if (!name || !deviceId) {
    return res.status(400).json({ error: 'Nom de l\'enfant et identifiant du tracker requis.' });
  }

  const db = readDB();

  if (db.children.find(c => c.deviceId === deviceId)) {
    return res.status(409).json({ error: 'Ce tracker est déjà associé à un compte.' });
  }

  const child = {
    id: crypto.randomUUID(),
    parentId: req.userId,
    name,
    deviceId,
    createdAt: new Date().toISOString()
  };
  db.children.push(child);
  writeDB(db);

  res.status(201).json(child);
});

app.delete('/api/children/:id', requireAuth, (req, res) => {
  const db = readDB();
  const child = db.children.find(c => c.id === req.params.id && c.parentId === req.userId);

  if (!child) {
    return res.status(404).json({ error: 'Enfant introuvable.' });
  }

  db.children = db.children.filter(c => c.id !== req.params.id);
  writeDB(db);
  res.json({ message: 'Supprimé.' });
});

/* ---------- Réception des positions (appelée par le PIC/SIM808) ----------
 * PAS d'authentification par compte parent ici -- c'est le firmware
 * embarqué qui appelle cette route directement via HTTP POST.
 * Le "deviceId" sert d'identifiant du tracker.
 * ---------------------------------------------------------------- */

app.post('/api/position', (req, res) => {
  const { deviceId, lat, lon, fixValid, gsmActive, battery } = req.body;

  if (!deviceId || lat === undefined || lon === undefined) {
    return res.status(400).json({ error: 'deviceId, lat et lon sont requis.' });
  }

  const db = readDB();

  const entry = {
    id: crypto.randomUUID(),
    deviceId,
    lat: parseFloat(lat),
    lon: parseFloat(lon),
    fixValid: fixValid === true || fixValid === 'true',
    gsmActive: gsmActive === undefined ? true : (gsmActive === true || gsmActive === 'true'),
    battery: battery !== undefined ? parseInt(battery, 10) : null,
    receivedAt: new Date().toISOString()
  };
  db.positions.push(entry);
  writeDB(db);

  res.json({ message: 'Position enregistrée.' });
});

/* Dernière position connue d'un tracker (le parent doit posséder cet enfant) */
app.get('/api/children/:id/latest', requireAuth, (req, res) => {
  const db = readDB();
  const child = db.children.find(c => c.id === req.params.id && c.parentId === req.userId);

  if (!child) {
    return res.status(404).json({ error: 'Enfant introuvable.' });
  }

  const positions = db.positions
    .filter(p => p.deviceId === child.deviceId)
    .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));

  res.json(positions[0] || null);
});

/* Historique complet des positions d'un tracker */
app.get('/api/children/:id/positions', requireAuth, (req, res) => {
  const db = readDB();
  const child = db.children.find(c => c.id === req.params.id && c.parentId === req.userId);

  if (!child) {
    return res.status(404).json({ error: 'Enfant introuvable.' });
  }

  const positions = db.positions
    .filter(p => p.deviceId === child.deviceId)
    .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));

  res.json(positions);
});

app.listen(PORT, () => {
  console.log(`Serveur tracker demarre sur http://localhost:${PORT}`);
});
