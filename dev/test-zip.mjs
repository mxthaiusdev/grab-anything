// Unit test for the store-only ZIP writer: build an archive, verify it with
// the system unzip. Run: node grab-anything/dev/test-zip.mjs

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'zip.js'), 'utf8');
eval(src); // defines globalThis.GrabZip

// ASCII names only here — macOS's bundled Info-ZIP unzip mishandles UTF-8
// names interactively; Finder/Chrome extract them fine via the UTF-8 flag.
const blob = globalThis.GrabZip.buildZip([
  { name: 'hello.txt', data: new TextEncoder().encode('hello grab anything') },
  { name: 'folder/data.bin', data: new Uint8Array([0, 1, 2, 3, 254, 255]) },
]);
writeFileSync('/tmp/ga-zip-test.zip', Buffer.from(await blob.arrayBuffer()));
execSync('unzip -o /tmp/ga-zip-test.zip -d /tmp/ga-zip-out > /dev/null && unzip -t /tmp/ga-zip-test.zip > /dev/null');
const back = readFileSync('/tmp/ga-zip-out/hello.txt', 'utf8');
if (back !== 'hello grab anything') throw new Error('roundtrip mismatch: ' + back);
console.log('zip writer: PASS (CRC verified by unzip, roundtrip ok)');
