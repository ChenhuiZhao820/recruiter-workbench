import test from "node:test";
import assert from "node:assert/strict";
import { crc32 } from "node:zlib";
import { zipTextFiles } from "../lib/zip.mjs";

// Reads the archive back through its central directory, as an unzip tool does.
function readZip(zip) {
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const files = [];
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const offset = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    assert.equal(zip.readUInt32LE(offset), 0x04034b50);
    const start = offset + 30 + zip.readUInt16LE(offset + 26);
    const data = zip.subarray(start, start + size);
    assert.equal(zip.readUInt32LE(at + 16), crc32(data), `${name} checksum`);
    files.push({ name, text: data.toString("utf8") });
    at += 46 + nameLength;
  }
  return files;
}

test("several tables zip into stored files that read back exactly, names and all", () => {
  const files = [
    { name: "capture-people-2026-10-22.csv", text: "﻿fullName\nSaoirse Pemberton-Ade\nZoë Ångström\n" },
    { name: "capture-roles-2026-10-22.csv", text: "﻿title\n\"Lead, Platform\"\n" },
    { name: "capture-notes-2026-10-22.csv", text: "" },
  ];
  assert.deepEqual(readZip(zipTextFiles(files, new Date(2026, 9, 22, 14, 30, 8))), files);
});

test("the archive is dated when it was made, in the DOS form ZIP tools read", () => {
  const zip = zipTextFiles([{ name: "a.csv", text: "x" }], new Date(2026, 9, 22, 14, 30, 8));
  assert.equal(zip.readUInt16LE(10), (14 << 11) | (30 << 5) | 4);
  assert.equal(zip.readUInt16LE(12), ((2026 - 1980) << 9) | (10 << 5) | 22);
});
