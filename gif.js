// gif.js — minimal animated GIF89a encoder, no dependencies.
// Web-safe 216-color palette with Floyd–Steinberg dithering + GIF-spec LZW.
// Good enough for UI animations, gradients and short clips.
(() => {
  // 6 levels per channel (web-safe cube) -> 216 colors, padded to 256.
  const LEVELS = [0, 51, 102, 153, 204, 255];
  const nearest6 = (v) => {
    let lo = 0;
    for (let i = 1; i < 6; i++) if (Math.abs(LEVELS[i] - v) < Math.abs(LEVELS[lo] - v)) lo = i;
    return lo;
  };
  const PALETTE = (() => {
    const p = new Uint8Array(256 * 3);
    let n = 0;
    for (let r = 0; r < 6; r++) for (let g = 0; g < 6; g++) for (let b = 0; b < 6; b++) {
      p[n++] = LEVELS[r]; p[n++] = LEVELS[g]; p[n++] = LEVELS[b];
    }
    return p; // indices 216..255 stay black (unused)
  })();
  const indexOf6 = (r, g, b) => nearest6(r) * 36 + nearest6(g) * 6 + nearest6(b);

  // RGBA Uint8ClampedArray -> palette indices, with FS dithering (in place copy)
  function quantize(rgba, w, h) {
    const buf = Float32Array.from(rgba); // work in float to carry error
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const r = Math.max(0, Math.min(255, buf[i]));
        const g = Math.max(0, Math.min(255, buf[i + 1]));
        const b = Math.max(0, Math.min(255, buf[i + 2]));
        const idx = indexOf6(r, g, b);
        out[y * w + x] = idx;
        const er = r - PALETTE[idx * 3], eg = g - PALETTE[idx * 3 + 1], eb = b - PALETTE[idx * 3 + 2];
        const spread = (dx, dy, f) => {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= w || ny >= h) return;
          const j = (ny * w + nx) * 4;
          buf[j] += er * f; buf[j + 1] += eg * f; buf[j + 2] += eb * f;
        };
        spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
      }
    }
    return out;
  }

  // GIF-spec LZW: minCodeSize 8, clear=256, eoi=257.
  function lzw(indices) {
    const minCode = 8, clear = 1 << minCode, eoi = clear + 1;
    const out = [];
    let cur = 0, curBits = 0;
    const put = (code, size) => {
      cur |= code << curBits; curBits += size;
      while (curBits >= 8) { out.push(cur & 0xff); cur >>= 8; curBits -= 8; }
    };
    let dict = new Map(), next = eoi + 1, codeSize = minCode + 1;
    const reset = () => { dict = new Map(); next = eoi + 1; codeSize = minCode + 1; };
    put(clear, codeSize);
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const combo = prefix * 256 + k;
      if (dict.has(combo)) { prefix = dict.get(combo); }
      else {
        put(prefix, codeSize);
        dict.set(combo, next++);
        if (next > (1 << codeSize) && codeSize < 12) codeSize++;
        if (next >= 4096) { put(clear, codeSize); reset(); }
        prefix = k;
      }
    }
    put(prefix, codeSize);
    put(eoi, codeSize);
    if (curBits > 0) out.push(cur & 0xff);
    return out;
  }

  // frames: [{ rgba, delayMs }]  (all same w×h)  -> Blob
  function encode(frames, w, h) {
    const bytes = [];
    const push = (...v) => bytes.push(...v);
    const u16 = (v) => { push(v & 0xff, (v >> 8) & 0xff); };
    const str = (s) => { for (let i = 0; i < s.length; i++) push(s.charCodeAt(i)); };

    str('GIF89a');
    u16(w); u16(h);
    push(0xf7, 0, 0); // global table flag, 256 entries, bg, aspect
    for (let i = 0; i < 256 * 3; i++) push(PALETTE[i]);
    // loop forever
    push(0x21, 0xff, 0x0b); str('NETSCAPE2.0'); push(0x03, 0x01, 0, 0, 0x00);

    for (const f of frames) {
      const delay = Math.max(2, Math.round((f.delayMs || 100) / 10)); // 1/100s
      push(0x21, 0xf9, 0x04, 0x00); u16(delay); push(0x00, 0x00); // graphic control
      push(0x2c); u16(0); u16(0); u16(w); u16(h); push(0x00); // image descriptor
      push(8); // LZW min code size
      const data = lzw(quantize(f.rgba, w, h));
      for (let o = 0; o < data.length; o += 255) {
        const chunk = data.slice(o, o + 255);
        push(chunk.length, ...chunk);
      }
      push(0x00); // block terminator
    }
    push(0x3b); // trailer
    return new Blob([new Uint8Array(bytes)], { type: 'image/gif' });
  }

  (typeof globalThis !== 'undefined' ? globalThis : self).GrabGif = { encode };
})();
