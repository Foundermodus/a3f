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
const profileCard = $('#profile-card');
const profileTile = $('#profile-tile');
const profileMsg = $('#profile-msg');
const profileQR = $('#profile-qr');
const sharePageBtn = $('#share-page');
const shareDialog = $('#share-dialog');

let allParticipants = [];
let myCode = null;

function imgUrl(p) {
  if (!p.sticker_image) return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="%23222"/></svg>';
  return p.sticker_image.startsWith('http') ? p.sticker_image : `${CONFIG.apiBase}${p.sticker_image}`;
}

function renderTile(p, target) {
  target.replaceChildren();
  const tile = document.createElement('article');
  tile.className = 'tile';
  const img = document.createElement('img');
  img.loading = 'lazy';
  img.alt = p.sticker_label;
  img.src = imgUrl(p);
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.innerHTML = `<div class="label"></div><div class="name"></div><div class="email"></div>`;
  meta.querySelector('.label').textContent = p.sticker_label;
  meta.querySelector('.name').textContent = p.name;
  meta.querySelector('.email').textContent = p.email;
  tile.append(img, meta);
  target.append(tile);
}

function profileUrl(code) {
  const u = new URL(window.location.href);
  u.searchParams.set('u', code);
  u.hash = '';
  return u.toString();
}

function pageUrl() {
  const u = new URL(window.location.href);
  u.search = '';
  u.hash = '';
  return u.toString();
}

function setShareLinks(prefix, url, text) {
  const enc = encodeURIComponent;
  const wa = $(`#${prefix}-wa`);
  const tg = $(`#${prefix}-tg`);
  const mail = $(`#${prefix}-mail`);
  if (wa) wa.href = `https://wa.me/?text=${enc(text + ' ' + url)}`;
  if (tg) tg.href = `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`;
  if (mail) mail.href = `mailto:?subject=${enc('A3F Sticker Directory')}&body=${enc(text + '\n\n' + url)}`;
}

async function copyToClipboard(text, ackEl) {
  try {
    await navigator.clipboard.writeText(text);
    if (ackEl) {
      const old = ackEl.textContent;
      ackEl.textContent = 'Link kopiert ✓';
      setTimeout(() => { ackEl.textContent = old; }, 2000);
    }
  } catch {
    prompt('Kopieren mit Cmd/Ctrl+C:', text);
  }
}

async function nativeShare(url, text) {
  if (navigator.share) {
    try { await navigator.share({ title: 'A3F Sticker Directory', text, url }); return true; }
    catch { /* user cancelled */ }
  }
  return false;
}

async function showProfile(code) {
  try {
    const res = await fetch(`${CONFIG.apiBase}/api/participants?code=${encodeURIComponent(code)}`);
    if (res.ok) {
      const data = await res.json();
      const me = (data.participants || []).find(p => p.code === code) || (data.participants || [])[0];
      if (me) return mountProfile(me);
    }
    // fallback: filter from full list once loaded
    profileCard.hidden = false;
    profileMsg.textContent = 'Suche dein Profil…';
    setTimeout(() => {
      const me = allParticipants.find(p => p.code === code);
      if (me) mountProfile(me);
      else profileMsg.textContent = 'Profil nicht gefunden.';
    }, 500);
  } catch (err) {
    profileMsg.textContent = `Fehler: ${err.message}`;
  }
}

function mountProfile(p) {
  profileCard.hidden = false;
  renderTile(p, profileTile);
  const url = profileUrl(p.code || myCode);
  const shareText = `${p.name} bei A3F — Sticker: ${p.sticker_label}.`;
  setShareLinks('share', url, shareText);
  profileMsg.textContent = '';
  if (window.A3FQR) {
    A3FQR.renderToCanvas(profileQR, url, { margin: 2 }).catch(() => { profileQR.hidden = true; });
  }
  profileCard.dataset.url = url;
  profileCard.dataset.text = shareText;
}

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
    const wrap = document.createElement('div');
    renderTile(p, wrap);
    grid.append(wrap.firstChild);
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
    formMsg.textContent = 'Eingetragen ✓ — dein Profil-Link ist unten.';
    form.reset();
    myCode = data.code;
    // Persist + redirect to profile view
    try { localStorage.setItem('a3f.code', data.code); } catch {}
    const u = new URL(window.location.href);
    u.searchParams.set('u', data.code);
    history.replaceState(null, '', u.toString());
    await loadParticipants();
    loadStats();
    showProfile(data.code);
  } catch (err) {
    formMsg.textContent = `Fehler: ${err.message}`;
  }
});

// Profile share buttons
profileCard.addEventListener('click', async (ev) => {
  const action = ev.target.closest('[data-share]')?.dataset.share;
  if (!action) return;
  const url = profileCard.dataset.url;
  const text = profileCard.dataset.text;
  if (action === 'native') await nativeShare(url, text);
  else if (action === 'copy') copyToClipboard(url, profileMsg);
});

// Page share button + dialog
sharePageBtn.hidden = false;
sharePageBtn.addEventListener('click', async () => {
  const url = pageUrl();
  const text = 'Schau dir die A3F Teilnehmer an:';
  if (await nativeShare(url, text)) return;
  $('#share-dialog-url').textContent = url;
  setShareLinks('page', url, text);
  if (window.A3FQR) A3FQR.renderToCanvas($('#page-qr'), url, { margin: 2 }).catch(() => {});
  shareDialog.dataset.url = url;
  if (typeof shareDialog.showModal === 'function') shareDialog.showModal();
  else shareDialog.setAttribute('open', '');
});
shareDialog.addEventListener('click', (ev) => {
  if (ev.target.dataset?.share === 'page-copy') {
    copyToClipboard(shareDialog.dataset.url, $('#share-dialog-url'));
  }
});

// Boot
const params = new URLSearchParams(window.location.search);
const incomingCode = params.get('u');
const stored = (() => { try { return localStorage.getItem('a3f.code'); } catch { return null; } })();
myCode = incomingCode || stored;
if (myCode) showProfile(myCode);

loadParticipants();
loadStats();
