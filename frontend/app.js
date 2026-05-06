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
const formCard = $('#form-card');
const alreadyCard = $('#already-card');
const submitBtn = form?.querySelector('button[type="submit"]');

function getIdemKey() {
  let k = null;
  try { k = localStorage.getItem('a3f.idem'); } catch {}
  if (!k) {
    k = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
    try { localStorage.setItem('a3f.idem', k); } catch {}
  }
  return k;
}
function getStoredCode() {
  try { return localStorage.getItem('a3f.code'); } catch { return null; }
}
function setStoredCode(code) {
  try { localStorage.setItem('a3f.code', code); } catch {}
}
function clearStoredEntry() {
  try { localStorage.removeItem('a3f.code'); localStorage.removeItem('a3f.idem'); } catch {}
}
function showAlreadyEntered() {
  alreadyCard.hidden = false;
  formCard.hidden = true;
}
function showForm() {
  alreadyCard.hidden = true;
  formCard.hidden = false;
}
const sharePageBtn = $('#share-page');
const shareDialog = $('#share-dialog');

let allParticipants = [];

function imgUrl(src) {
  if (!src) return 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="%23222"/></svg>';
  return src.startsWith('http') ? src : `${CONFIG.apiBase}${src}`;
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
    statsEl.textContent = `${s.total} Teilnehmer`;
  } catch { /* ignore */ }
}

function render() {
  const q = filterInput.value.trim().toLowerCase();
  const list = q
    ? allParticipants.filter(p => p.name.toLowerCase().includes(q))
    : allParticipants;

  grid.replaceChildren();
  for (const p of list) {
    const tile = document.createElement('article');
    tile.className = 'tile';
    const sources = [p.sticker_image, p.sticker_image2].filter(Boolean);
    const photos = document.createElement('div');
    photos.className = sources.length === 2 ? 'photos two' : sources.length === 1 ? 'photos' : 'photos none';
    for (const src of sources) {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = p.name;
      img.src = imgUrl(src);
      photos.append(img);
    }
    const meta = document.createElement('div');
    meta.className = 'meta';
    const nameEl = document.createElement('div');
    nameEl.className = 'name';
    nameEl.textContent = p.name;
    meta.append(nameEl);
    if (p.email) {
      const a = document.createElement('a');
      a.className = 'contact';
      a.href = `mailto:${p.email}`;
      a.textContent = p.email;
      meta.append(a);
    }
    if (p.phone) {
      const a = document.createElement('a');
      a.className = 'contact';
      a.href = `tel:${p.phone.replace(/[^+0-9]/g, '')}`;
      a.textContent = p.phone;
      meta.append(a);
    }
    tile.append(photos, meta);
    grid.append(tile);
  }
  if (list.length === 0) listMsg.textContent = 'Noch keine Einträge.';
}

filterInput.addEventListener('input', render);
sortSelect.addEventListener('change', loadParticipants);

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (submitBtn?.disabled) return;
  if (submitBtn) { submitBtn.disabled = true; submitBtn.dataset.label = submitBtn.textContent; submitBtn.textContent = 'Sende…'; }
  formMsg.textContent = 'Sende…';
  const fd = new FormData(form);
  const idem = getIdemKey();
  try {
    const res = await fetch(`${CONFIG.apiBase}/api/submit`, {
      method: 'POST',
      body: fd,
      headers: { 'X-Idempotency-Key': idem },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    setStoredCode(data.code);
    formMsg.textContent = data.duplicate ? 'Du warst schon eingetragen ✓' : 'Eingetragen ✓';
    form.reset();
    showAlreadyEntered();
    await loadParticipants();
    loadStats();
  } catch (err) {
    formMsg.textContent = `Fehler: ${err.message}`;
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = submitBtn.dataset.label || 'Eintragen';
    }
  }
});

$('#submit-again')?.addEventListener('click', () => {
  clearStoredEntry();
  showForm();
});

// On boot: if we have a stored code, jump straight to "already entered"
if (getStoredCode()) showAlreadyEntered();

// Page share button + dialog
sharePageBtn.addEventListener('click', async () => {
  const url = pageUrl();
  const text = 'A3F — trag dich ein:';
  $('#share-dialog-url').textContent = url;
  setShareLinks('page', url, text);
  if (window.A3FQR) A3FQR.renderToCanvas($('#page-qr'), url, { margin: 2 }).catch(() => {});
  shareDialog.dataset.url = url;
  if (typeof shareDialog.showModal === 'function') shareDialog.showModal();
  else shareDialog.setAttribute('open', '');
});
function closeShareDialog() {
  if (typeof shareDialog.close === 'function') shareDialog.close();
  else shareDialog.removeAttribute('open');
}
shareDialog.addEventListener('click', (ev) => {
  const action = ev.target.dataset?.share || (ev.target.id === 'share-close-x' ? 'page-close' : null);
  if (action === 'page-copy') copyToClipboard(shareDialog.dataset.url, $('#share-dialog-url'));
  else if (action === 'page-close') closeShareDialog();
  else if (ev.target === shareDialog) closeShareDialog();   // backdrop click
});
shareDialog.addEventListener('cancel', closeShareDialog);   // Esc key

loadParticipants();
loadStats();
