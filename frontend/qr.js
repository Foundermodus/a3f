// QR rendering helper. Wraps locally-bundled kazuhikoarase/qrcode-generator (MIT).
// Exposes window.A3FQR.renderToCanvas(canvas, text).
(function (global) {
  'use strict';

  async function renderToCanvas(canvas, text, opts) {
    opts = opts || {};
    if (!global.qrcode) throw new Error('qr-lib-missing');
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
