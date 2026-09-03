let childMaps = {};
let childMarkers = {};
let childReceivedAt = {}; // pour le compteur "il y a X secondes" en direct
let cityCache = {};

async function checkAuth() {
  const res = await fetch('/api/auth/me');
  if (!res.ok) {
    window.location.href = '/login.html';
    return false;
  }
  return true;
}

function createChildMap(mapId) {
  /* Vue par défaut centrée sur Ouagadougou -- se recentre dès
   * qu'une vraie position de tracker est reçue */
  const map = L.map(mapId).setView([12.3714, -1.5197], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19
  }).addTo(map);
  return map;
}

function formatElapsed(dateStr) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000));
  if (seconds < 60) return `il y a ${seconds} seconde${seconds > 1 ? 's' : ''}`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `il y a ${hours} h`;
}

/* Géocodage inversé (Nominatim/OpenStreetMap) pour afficher un nom
 * de ville plutôt que des coordonnées brutes */
async function cityName(lat, lon) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (cityCache[key]) return cityCache[key];
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
    const data = await res.json();
    const a = data.address || {};
    const name = a.city || a.town || a.village || a.county || 'Position inconnue';
    cityCache[key] = name;
    return name;
  } catch {
    return 'Position inconnue';
  }
}

function renderStatus(card, latest) {
  const statusEl = card.querySelector('.status-area');

  const hasProblem = !latest || !latest.fixValid;

  if (hasProblem) {
    const lastSeen = latest ? formatElapsed(latest.receivedAt) : null;
    statusEl.innerHTML = `
      <div class="alert-box">
        <div class="dot"></div>
        <div class="text">
          <strong>🔴 Alerte</strong>
          <span>Signal GPS perdu.${lastSeen ? ` Dernière position connue : ${lastSeen}.` : ' Aucune position reçue pour le moment.'}</span>
        </div>
      </div>
    `;
    return;
  }

  const gsmOk = latest.gsmActive !== false;
  const battery = latest.battery;

  statusEl.innerHTML = `
    <div class="status-list">
      <div class="status-row"><span class="status-dot ok"></span>GPS actif</div>
      <div class="status-row"><span class="status-dot ${gsmOk ? 'ok' : 'bad'}"></span>Réseau GSM ${gsmOk ? 'actif' : 'inactif'}</div>
      <div class="status-row"><span class="status-dot ${battery !== null && battery < 20 ? 'bad' : 'ok'}"></span>Batterie ${battery !== null ? battery + ' %' : 'inconnue'}</div>
    </div>
  `;
}

async function loadChildren() {
  const res = await fetch('/api/children');
  const children = await res.json();

  const list = document.getElementById('childrenList');
  const empty = document.getElementById('emptyState');

  if (children.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  for (const child of children) {
    const mapId = `child-map-${child.id}`;

    /* Crée la carte du dashboard pour ce nouvel enfant si elle
     * n'existe pas encore (on ne recrée jamais une carte Leaflet
     * déjà initialisée sur le même conteneur) */
    let card = document.getElementById(`child-card-${child.id}`);
    if (!card) {
      card = document.createElement('div');
      card.className = 'child-card';
      card.id = `child-card-${child.id}`;
      card.innerHTML = `
        <div class="name">${child.name}</div>
        <div class="position-line">📍 Position actuelle : <strong class="city-name">chargement…</strong></div>
        <div class="received-line"></div>
        <div id="${mapId}" class="child-map"></div>
        <div class="status-area"></div>
      `;
      list.appendChild(card);
      childMaps[child.id] = createChildMap(mapId);
    }

    const latestRes = await fetch(`/api/children/${child.id}/latest`);
    const latest = latestRes.ok ? await latestRes.json() : null;

    renderStatus(card, latest);

    if (latest && latest.fixValid) {
      childReceivedAt[child.id] = latest.receivedAt;
      card.querySelector('.received-line').textContent = formatElapsed(latest.receivedAt);

      cityName(latest.lat, latest.lon).then(name => {
        const el = card.querySelector('.city-name');
        if (el) el.textContent = name;
      });

      const map = childMaps[child.id];
      if (childMarkers[child.id]) {
        childMarkers[child.id].setLatLng([latest.lat, latest.lon]);
      } else {
        /* Première position reçue : on recentre la carte dessus */
        map.setView([latest.lat, latest.lon], 16);
        childMarkers[child.id] = L.marker([latest.lat, latest.lon]).addTo(map);
      }
    } else {
      card.querySelector('.city-name').textContent = '—';
      card.querySelector('.received-line').textContent = '';
    }
  }
}

document.getElementById('addChildForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorMsg = document.getElementById('addErrorMsg');
  errorMsg.classList.remove('show');

  const name = document.getElementById('childName').value;
  const deviceId = document.getElementById('deviceId').value;

  const res = await fetch('/api/children', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, deviceId })
  });
  const data = await res.json();

  if (!res.ok) {
    errorMsg.textContent = data.error || 'Erreur lors de l\'ajout.';
    errorMsg.classList.add('show');
    return;
  }

  document.getElementById('addChildForm').reset();
  loadChildren();
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  window.location.href = '/login.html';
});

(async function start() {
  const ok = await checkAuth();
  if (!ok) return;

  await loadChildren();

  /* Rafraîchit les positions toutes les 15 secondes pour un
   * suivi quasi temps réel sans recharger la page */
  setInterval(loadChildren, 15000);

  /* Met à jour le compteur "il y a X secondes" chaque seconde,
   * sans attendre le prochain rafraîchissement des positions */
  setInterval(() => {
    for (const childId in childReceivedAt) {
      const el = document.querySelector(`#child-card-${childId} .received-line`);
      if (el) el.textContent = formatElapsed(childReceivedAt[childId]);
    }
  }, 1000);
})();
