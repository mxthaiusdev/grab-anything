// Minimal store-only ZIP writer (no compression — media is already
// compressed). No dependencies; used by the popup gallery.
(() => {
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  const crc32 = (bytes) => {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  const le16 = (v) => [v & 255, (v >> 8) & 255];
  const le32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];

  // entries: [{ name: 'folder/file.png', data: Uint8Array }] -> Blob
  function buildZip(entries) {
    const encoder = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;

    for (const { name, data } of entries) {
      const nameBytes = encoder.encode(name);
      const crc = crc32(data);
      const header = new Uint8Array([
        0x50, 0x4b, 0x03, 0x04,
        ...le16(20), ...le16(0x0800), ...le16(0), ...le16(0), ...le16(0),
        ...le32(crc), ...le32(data.length), ...le32(data.length),
        ...le16(nameBytes.length), ...le16(0),
      ]);
      chunks.push(header, nameBytes, data);
      central.push({ nameBytes, crc, size: data.length, offset });
      offset += header.length + nameBytes.length + data.length;
    }

    const cdStart = offset;
    let cdSize = 0;
    for (const e of central) {
      const rec = new Uint8Array([
        0x50, 0x4b, 0x01, 0x02,
        ...le16(20), ...le16(20), ...le16(0x0800), ...le16(0), ...le16(0), ...le16(0),
        ...le32(e.crc), ...le32(e.size), ...le32(e.size),
        ...le16(e.nameBytes.length), ...le16(0), ...le16(0),
        ...le16(0), ...le16(0), ...le32(0), ...le32(e.offset),
      ]);
      chunks.push(rec, e.nameBytes);
      cdSize += rec.length + e.nameBytes.length;
    }

    chunks.push(new Uint8Array([
      0x50, 0x4b, 0x05, 0x06,
      ...le16(0), ...le16(0), ...le16(central.length), ...le16(central.length),
      ...le32(cdSize), ...le32(cdStart), ...le16(0),
    ]));
    return new Blob(chunks, { type: 'application/zip' });
  }

  (typeof globalThis !== 'undefined' ? globalThis : self).GrabZip = { buildZip, crc32 };
})();
