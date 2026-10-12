import { inflateRawSync } from "node:zlib";

// Reads the first sheet of an .xlsx or a .csv into rows of text. Plain
// JavaScript and free of the database so the app and the unit tests apply the
// same rules. It is deliberately small: an .xlsx is a zip of XML files, and
// only the workbook list, the shared strings and one sheet are read. Nothing
// is evaluated: a formula cell contributes the value Excel saved with it, and
// no macro, link or embedded object is ever opened.
//
// The input is a stranger's file, so every size is capped before it is
// expanded: the file, what a zip entry says it expands to, what it actually
// expands to, the number of rows and the number of columns.

export const MAX_FILE_BYTES = 4 * 1024 * 1024;
export const MAX_ROWS = 2000;
export const MAX_COLUMNS = 50;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_CELL_CHARS = 20_000;

export class SheetError extends Error {}

const fail = (message) => {
  throw new SheetError(message);
};

/** @param {Uint8Array} bytes */
function isZip(bytes) {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** @param {Uint8Array} bytes */
function isLegacyExcel(bytes) {
  return bytes.length > 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

// ---- zip ------------------------------------------------------------------

/** @param {Buffer} buf */
function zipEntries(buf) {
  const lowest = Math.max(0, buf.length - 65_557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= lowest; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) fail("That file is not a readable Excel workbook.");
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || offset === 0xffffffff) fail("That workbook is too large to import. Split it into smaller files.");
  if (count > 5000) fail("That file is not a readable Excel workbook.");
  /** @type {Map<string, { method: number, flags: number, size: number, csize: number, local: number }>} */
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) fail("That file is not a readable Excel workbook.");
    const flags = buf.readUInt16LE(offset + 8);
    const method = buf.readUInt16LE(offset + 10);
    const csize = buf.readUInt32LE(offset + 20);
    const size = buf.readUInt32LE(offset + 24);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const local = buf.readUInt32LE(offset + 42);
    const name = buf.toString("utf8", offset + 46, offset + 46 + nameLen);
    entries.set(name, { method, flags, size, csize, local });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** @param {Buffer} buf @param {Map<string, any>} entries @param {string} name */
function readEntry(buf, entries, name) {
  const entry = entries.get(name);
  if (!entry) return null;
  if (entry.flags & 1) fail("That workbook is password protected. Remove the password and try again.");
  if (entry.size > MAX_ENTRY_BYTES || entry.csize === 0xffffffff || entry.size === 0xffffffff) fail("That workbook is too large to import. Split it into smaller files.");
  const at = entry.local;
  if (at + 30 > buf.length || buf.readUInt32LE(at) !== 0x04034b50) fail("That file is not a readable Excel workbook.");
  const start = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
  const data = buf.subarray(start, start + entry.csize);
  if (data.length !== entry.csize) fail("That file is not a readable Excel workbook.");
  try {
    const out = entry.method === 0 ? Buffer.from(data) : entry.method === 8 ? inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES }) : null;
    if (!out) fail("That file is not a readable Excel workbook.");
    if (out.length > MAX_ENTRY_BYTES) fail("That workbook is too large to import. Split it into smaller files.");
    return out.toString("utf8");
  } catch (error) {
    if (error instanceof SheetError) throw error;
    // zlib reports an output past maxOutputLength as a RangeError.
    fail(error instanceof RangeError ? "That workbook is too large to import. Split it into smaller files." : "That file is not a readable Excel workbook.");
  }
}

// ---- xml ------------------------------------------------------------------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** @param {string} text */
function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

// A linear scan for <tag ...>inner</tag> and <tag .../>, in place of one big
// regular expression: an unclosed element in a hostile file then ends the
// scan instead of sending it back over the rest of the text again and again.
/** @param {string} xml @param {string} tag @returns {Generator<{ attrs: string, inner: string | undefined }>} */
function* elements(xml, tag) {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let pos = 0;
  for (;;) {
    const start = xml.indexOf(open, pos);
    if (start < 0) return;
    const after = xml[start + open.length];
    if (after === undefined || (after.trim() !== "" && after !== "/" && after !== ">")) {
      pos = start + open.length;
      continue;
    }
    const tagEnd = xml.indexOf(">", start);
    if (tagEnd < 0) return;
    const attrs = xml.slice(start + open.length, tagEnd);
    if (attrs.endsWith("/")) {
      yield { attrs: attrs.slice(0, -1), inner: undefined };
      pos = tagEnd + 1;
      continue;
    }
    const end = xml.indexOf(close, tagEnd);
    if (end < 0) return;
    yield { attrs, inner: xml.slice(tagEnd + 1, end) };
    pos = end + close.length;
  }
}

/** @param {string} xml @param {string} tag */
function without(xml, tag) {
  let out = "";
  let pos = 0;
  for (;;) {
    const start = xml.indexOf(`<${tag}`, pos);
    if (start < 0) return out + xml.slice(pos);
    out += xml.slice(pos, start);
    const end = xml.indexOf(`</${tag}>`, start);
    if (end < 0) return out;
    pos = end + tag.length + 3;
  }
}

// The text of a string item: every <t> run, leaving out phonetic hints.
/** @param {string} xml */
function textOf(xml) {
  let out = "";
  for (const run of elements(without(xml, "rPh"), "t")) out += decode(run.inner ?? "");
  return out;
}

/** @param {string} xml */
function sharedStrings(xml) {
  const strings = [];
  for (const item of elements(xml, "si")) strings.push(item.inner === undefined ? "" : textOf(item.inner));
  return strings;
}

/** @param {string} letters */
function columnIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** @param {string} attrs @param {string} name */
function attr(attrs, name) {
  const match = attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`));
  return match ? decode(match[1]) : null;
}

/** @param {string} xml @param {string[]} strings */
function sheetRows(xml, strings) {
  /** @type {{ n: number, cells: string[] }[]} */
  const rows = [];
  let seen = 0;
  for (const row of elements(xml, "row")) {
    const body = row.inner;
    if (body === undefined) continue;
    const declared = Number(attr(row.attrs, "r"));
    seen += 1;
    const n = Number.isInteger(declared) && declared > 0 ? declared : seen;
    /** @type {string[]} */
    const cells = [];
    let next = 0;
    for (const cell of elements(body, "c")) {
      const inner = cell.inner;
      if (inner === undefined) continue;
      const ref = attr(cell.attrs, "r")?.match(/^([A-Za-z]{1,3})\d*$/);
      const col = ref ? columnIndex(ref[1]) : next;
      next = col + 1;
      if (col < 0 || col >= MAX_COLUMNS) {
        if (col >= MAX_COLUMNS && textOfCell(cell.attrs, inner, strings) !== "") fail(`That sheet has more than ${MAX_COLUMNS} columns. Remove the ones you do not need and try again.`);
        continue;
      }
      while (cells.length < col) cells.push("");
      cells[col] = textOfCell(cell.attrs, inner, strings).slice(0, MAX_CELL_CHARS);
    }
    if (cells.some((cell) => cell.trim() !== "")) {
      rows.push({ n, cells });
      if (rows.length > MAX_ROWS + 1) fail(`That sheet has more than ${MAX_ROWS.toLocaleString("en-GB")} rows. Split it into smaller files and import them one at a time.`);
    }
  }
  return rows;
}

/** @param {string} attrs @param {string} inner @param {string[]} strings */
function textOfCell(attrs, inner, strings) {
  const type = attr(attrs, "t");
  if (type === "inlineStr") return textOf(inner);
  const value = inner.match(/<v\b[^>]*?>([\s\S]*?)<\/v>/);
  if (!value) return "";
  if (type === "s") return strings[Number(value[1])] ?? "";
  if (type === "b") return value[1].trim() === "1" ? "TRUE" : "FALSE";
  if (type === "e") return "";
  return decode(value[1]);
}

function firstSheetPath(workbook, rels, entries) {
  const sheet = workbook ? elements(workbook, "sheet").next().value : null;
  const id = sheet ? attr(sheet.attrs, "r:id") : null;
  if (id && rels) {
    for (const rel of elements(rels, "Relationship")) {
      if (attr(rel.attrs, "Id") === id) {
        const target = attr(rel.attrs, "Target") ?? "";
        const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
        if (/^xl\/worksheets\/[\w.-]+\.xml$/.test(path) && entries.has(path)) return path;
      }
    }
  }
  return entries.has("xl/worksheets/sheet1.xml") ? "xl/worksheets/sheet1.xml" : null;
}

/** @param {Buffer} buf */
function readXlsx(buf) {
  const entries = zipEntries(buf);
  if (!entries.has("xl/workbook.xml")) fail("That file is not an Excel workbook.");
  const path = firstSheetPath(readEntry(buf, entries, "xl/workbook.xml"), readEntry(buf, entries, "xl/_rels/workbook.xml.rels"), entries);
  if (!path) fail("That workbook has no sheet to read.");
  const strings = sharedStrings(readEntry(buf, entries, "xl/sharedStrings.xml") ?? "");
  return sheetRows(readEntry(buf, entries, path), strings);
}

// ---- csv ------------------------------------------------------------------

/** @param {Buffer} buf */
function decodeText(buf) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "");
  } catch {
    // Excel's "CSV" is often Windows-1252 rather than UTF-8.
    return new TextDecoder("windows-1252").decode(buf);
  }
}

/** @param {string} firstLine */
function delimiterOf(firstLine) {
  let best = ",";
  let bestCount = 0;
  for (const candidate of [",", ";", "\t"]) {
    let inQuotes = false;
    let count = 0;
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === candidate && !inQuotes) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

/** @param {string} text */
function csvRows(text) {
  const delimiter = delimiterOf(text.split(/\r\n|\n|\r/, 1)[0] ?? "");
  /** @type {{ n: number, cells: string[] }[]} */
  const rows = [];
  let cells = [];
  let cell = "";
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;
  const endCell = () => {
    cells.push(cell.slice(0, MAX_CELL_CHARS));
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (cells.length > MAX_COLUMNS) {
      if (cells.slice(MAX_COLUMNS).some((value) => value.trim() !== "")) fail(`That sheet has more than ${MAX_COLUMNS} columns. Remove the ones you do not need and try again.`);
      cells = cells.slice(0, MAX_COLUMNS);
    }
    if (cells.some((value) => value.trim() !== "")) {
      rows.push({ n: rowLine, cells });
      if (rows.length > MAX_ROWS + 1) fail(`That sheet has more than ${MAX_ROWS.toLocaleString("en-GB")} rows. Split it into smaller files and import them one at a time.`);
    }
    cells = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else inQuotes = false;
      } else {
        if (ch === "\n") line += 1;
        cell += ch;
      }
    } else if (ch === '"' && cell === "") inQuotes = true;
    else if (ch === delimiter) endCell();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      endRow();
      line += 1;
      rowLine = line;
    } else cell += ch;
  }
  if (cell !== "" || cells.length > 0) endRow();
  return rows;
}

// ---- entry point ----------------------------------------------------------

/**
 * @param {Uint8Array} bytes
 * @returns {{ rows: { n: number, cells: string[] }[] }} rows with the sheet's own row numbers; empty rows are left out
 */
export function readSpreadsheet(bytes) {
  if (bytes.length === 0) fail("That file is empty.");
  if (bytes.length > MAX_FILE_BYTES) fail(`That file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB. Split it into smaller files.`);
  if (isLegacyExcel(bytes)) fail("That is an old .xls workbook. In Excel choose Save As and pick .xlsx (or .csv), then import that.");
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rows = isZip(bytes) ? readXlsx(buf) : csvRows(decodeText(buf));
  if (rows.length < 2) fail("There is nothing to import: the first row should be the column names, followed by the people.");
  return { rows };
}
