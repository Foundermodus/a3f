const CONFIG = {
  apiBase: window.A3F_API_BASE || 'https://albumyoo.example.com',
};

const $ = (s) => document.querySelector(s);
const grid = $('#grid');
const filterInput = $('#filter');
const sortSelect = $('#sort');
const statsEl = $('#stats');
const form = $('#submit-form');
const formMsg = $('#form-msg');
const listMsg = $('#list-msg');

let allParticipants = [];

async function loadParticipants() {
  listMsg.textContent = 'Lade…';
  try {
    const sort = sortSelect.value;
    const url = new URL(`${CONFIG.apiBase}/api/participants`);
    if (sort) url.searchParams.set('sort', sort);
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    allParticipants = data.participants || [];
    render();
    listMsg.textContent = '';
  } catch (err) {
    listMsg.textContent = `Konnte Teilnehmer nicht laden (${err.message}).`;
  }
}

async function loadStats() {
  try {
    const res = await fetch(`${CONFIG.apiBase}/api/stats`);
    if (!res.ok) return;
    const s = await res.json();
    statsEl.textContent = `${s.total} Teilnehmer · ${s.by_sticker.length} Sticker-Varianten`;
  } catch { /* ignore */ }
}

function render() {
  const q = filterInput.value.trim().toLowerCase();
  const list = q
    ? allParticipants.filter(p => p.sticker_label.toLowerCase().includes(q) || p.name.toLowerCase().includes(q))
    : allParticipants;

  grid.replaceChildren();
  for (const p of list) {
    const tile = document.createElement('article');
    tile.className = 'tile';
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = p.sticker_label;
    img.src = p.sticker_image
      ? (p.sticker_image.startsWith('http') ? p.sticker_image : `${CONFIG.apiBase}${p.sticker_image}`)
      : 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="%23222"/></svg>';
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `<div class="label"></div><div class="name"></div><div class="email"></div>`;
    meta.querySelector('.label').textContent = p.sticker_label;
    meta.querySelector('.name').textContent = p.name;
    meta.querySelector('.email').textContent = p.email;
    tile.append(img, meta);
    grid.append(tile);
  }
  if (list.length === 0) listMsg.textContent = 'Noch keine Einträge.';
}

filterInput.addEventListener('input', render);
sortSelect.addEventListener('change', loadParticipants);

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  formMsg.textContent = 'Sende…';
  const fd = new FormData(form);
  try {
    const res = await fetch(`${CONFIG.apiBase}/api/submit`, { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    formMsg.textContent = 'Eingetragen ✓';
    form.reset();
    loadParticipants();
    loadStats();
  } catch (err) {
    formMsg.textContent = `Fehler: ${err.message}`;
  }
});

loadParticipants();
loadStats();
