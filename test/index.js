// Test entry for `node --test test/`.
//
// On modern Node (>=21) the test runner treats its positional argument as a
// glob, and a glob that matches a *directory* has that directory executed as
// if it were a file (`node test/` → MODULE_NOT_FOUND). This file makes the
// directory runnable: `node --test test/` executes `test/index.js`, which
// discovers and imports every `*.test.js` sibling, so the mandated command
// runs the whole suite on any supported Node version.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const testFiles = fs
  .readdirSync(here)
  .filter((name) => name.endsWith('.test.js'))
  .sort();

for (const file of testFiles) {
  await import(pathToFileURL(path.join(here, file)).href);
}
