// QR rendering helper. Uses kazuhikoarase/qrcode-generator (MIT) loaded from jsDelivr.
// Exposes window.A3FQR.renderToCanvas(canvas, text).
(function (global) {
  'use strict';

  let loadPromise = null;
  function loadLib() {
    if (global.qrcode) return Promise.resolve();
    if (loadPromise) return loadPromise;
    loadPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
      s.integrity = 'sha256-0sN73x6sJxTxsspiQ0V0YlIWXNjJZ5oUYmzv0YbCwkA=';
      s.crossOrigin = 'anonymous';
      s.onload = resolve;
      s.onerror = () => reject(new Error('qr-lib-load-failed'));
      document.head.appendChild(s);
    });
    return loadPromise;
  }

  async function renderToCanvas(canvas, text, opts) {
    opts = opts || {};
    await loadLib();
    // typeNumber 0 = auto; ECC level 'L' = low, gives most capacity
    const qr = global.qrcode(0, 'L');
    qr.addData(text);
    qr.make();
    const cells = qr.getModuleCount();
    const margin = opts.margin ?? 2;
    const total = cells + margin * 2;
    const px = canvas.width;
    const cell = Math.floor(px / total);
    const offset = Math.floor((px - cell * total) / 2);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = opts.bg || '#ffffff';
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = opts.fg || '#000000';
    for (let r = 0; r < cells; r++) {
      for (let c = 0; c < cells; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect(offset + (c + margin) * cell, offset + (r + margin) * cell, cell, cell);
        }
      }
    }
  }

  global.A3FQR = { renderToCanvas };
})(window);
