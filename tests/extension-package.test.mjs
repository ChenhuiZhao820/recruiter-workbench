import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { extensionFiles, extensionZip } from "../lib/extension-package.mjs";

const names = ["manifest.json", "popup.css", "popup.html", "popup.js", "workbench.js"];
const source = Object.fromEntries(await Promise.all(names.filter((name) => name !== "workbench.js").map(async (name) => [name, await readFile(new URL(`../extension/${name}`, import.meta.url), "utf8")])));

function unpack(buffer) {
  const end = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(end), 0x06054b50);
  assert.equal(buffer.readUInt16LE(end + 8), names.length);
  assert.equal(buffer.readUInt16LE(end + 10), names.length);
  const directoryOffset = buffer.readUInt32LE(end + 16);
  assert.equal(directoryOffset + buffer.readUInt32LE(end + 12), end);
  const files = {};
  let cursor = directoryOffset;
  for (let index = 0; index < names.length; index++) {
    assert.equal(buffer.readUInt32LE(cursor), 0x02014b50);
    assert.equal(buffer.readUInt16LE(cursor + 10), 0);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const local = buffer.readUInt32LE(cursor + 42);
    assert.equal(buffer.readUInt32LE(local), 0x04034b50);
    assert.equal(buffer.readUInt16LE(local + 6), 0x800);
    assert.equal(buffer.readUInt16LE(local + 8), 0);
    assert.equal(buffer.readUInt16LE(local + 12), 33);
    assert.equal(buffer.readUInt32LE(local + 14), buffer.readUInt32LE(cursor + 16));
    const size = buffer.readUInt32LE(local + 18);
    assert.equal(size, buffer.readUInt32LE(local + 22));
    assert.equal(size, buffer.readUInt32LE(cursor + 20));
    assert.equal(name, buffer.subarray(local + 30, local + 30 + nameLength).toString("utf8"));
    const start = local + 30 + nameLength;
    assert.ok(start + size <= directoryOffset);
    files[name] = { text: buffer.subarray(start, start + size).toString("utf8"), crc: buffer.readUInt32LE(local + 14) };
    cursor += 46 + nameLength;
  }
  assert.equal(cursor, end);
  return files;
}

test("ZIP has standard headers, correct CRC-32 test vector and a fixed safe file list", () => {
  const files = Object.fromEntries(names.map((name) => [name, "123456789"]));
  const zip = extensionZip({ ...files, "../../.env": "DO-NOT-PACK", "user-key.txt": "DO-NOT-PACK" });
  const decoded = unpack(zip);
  assert.deepEqual(Object.keys(decoded), names.map((name) => `capture-extension/${name}`));
  for (const entry of Object.values(decoded)) assert.deepEqual(entry, { text: "123456789", crc: 0xcbf43926 });
  assert.equal(zip.includes(Buffer.from("DO-NOT-PACK")), false);
  assert.deepEqual(zip, extensionZip(files));
});

test("download bundle shares exact hosted origin restrictions and preserves source", () => {
  const before = JSON.stringify(source);
  const files = extensionFiles({ ...source, ".env": "DO-NOT-PACK" }, "https://capture.example.test");
  const decoded = unpack(extensionZip(files));
  for (const name of names) assert.equal(decoded[`capture-extension/${name}`].text, files[name]);
  const manifest = JSON.parse(files["manifest.json"]);
  assert.deepEqual(manifest.permissions, ["activeTab", "scripting", "storage"]);
  assert.deepEqual(manifest.host_permissions, ["http://localhost/*", "http://127.0.0.1/*", "https://capture.example.test/*"]);
  assert.equal(manifest.background, undefined);
  assert.equal(manifest.content_scripts, undefined);
  assert.match(manifest.content_security_policy.extension_pages, /https:\/\/capture\.example\.test;/);
  assert.equal(JSON.stringify(source), before);
  assert.equal(Object.values(files).join("").includes("DO-NOT-PACK"), false);
});

test("loopback bundles are opt-in and prefill the actual local port without remote hosts", () => {
  assert.throws(() => extensionFiles(source, "http://localhost:3100"), /HTTPS/);
  const files = extensionFiles(source, "http://localhost:3100", { allowLoopback: true });
  assert.deepEqual(JSON.parse(files["manifest.json"]).host_permissions, ["http://localhost/*", "http://127.0.0.1/*"]);
  assert.match(files["workbench.js"], /CAPTURE_WORKBENCH_DEFAULT = "http:\/\/localhost:3100"/);
  assert.match(files["workbench.js"], /CAPTURE_WORKBENCH_ORIGINS = \[\]/);
  for (const origin of ["http://remote.test", "http://localhost:3100/path", "http://localhost:3100?token=secret", "https://linkedin.com", "https://user:secret@capture.example.test", "https://*.example.test"]) {
    assert.throws(() => extensionFiles(source, origin, { allowLoopback: true }));
  }
});

test("packaging rejects unexpected permissions, missing files and oversized content", () => {
  for (const field of ["background", "content_scripts", "optional_permissions", "optional_host_permissions"]) {
    assert.throws(() => extensionFiles({ ...source, "manifest.json": JSON.stringify({ ...JSON.parse(source["manifest.json"]), [field]: [] }) }, "https://capture.example.test"), /Unexpected/);
  }
  assert.throws(() => extensionFiles({ ...source, "popup.html": "missing-script" }, "https://capture.example.test"), /Expected one/);
  assert.throws(() => extensionZip({}), /Incomplete/);
  assert.throws(() => extensionZip({ "manifest.json": "x".repeat(4 * 1024 * 1024 + 1) }), /size limit/);
});
