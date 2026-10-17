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
// Rows above the headings that are read before giving up on finding them.
export const HEADER_SEARCH = 10;
const MAX_SHEETS = 10;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;

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

/** @typedef {{ n: number, cells: string[], links: string[] }} SheetRow */
/** @typedef {{ name: string, rows: SheetRow[], tooMany: boolean, tooWide: boolean }} Sheet */

/** @param {string | null | undefined} ref e.g. "B2" */
function cellRef(ref) {
  const match = /^([A-Za-z]{1,3})(\d+)$/.exec(ref ?? "");
  return match ? { col: columnIndex(match[1]), row: Number(match[2]) } : null;
}

const HYPERLINK_FORMULA = /HYPERLINK\(\s*"([^"]{1,2000})"/i;

// Rows of one sheet, with the link behind each cell where there is one: a
// recruiter often links a person's name to their profile rather than pasting
// the address. Every cell of a merged range shows the range's value, the way
// Excel displays it, so a role written once beside a group of people reaches
// each of them.
/** @param {string} xml @param {string[]} strings @param {Map<string, string>} relTargets @returns {Omit<Sheet, "name">} */
function sheetRows(xml, strings, relTargets) {
  /** @type {Map<number, SheetRow>} */
  const byNumber = new Map();
  let seen = 0;
  let filled = 0;
  let tooMany = false;
  let tooWide = false;
  for (const row of elements(xml, "row")) {
    seen += 1;
    const body = row.inner;
    if (body === undefined) continue;
    const declared = Number(attr(row.attrs, "r"));
    const n = Number.isInteger(declared) && declared > 0 ? declared : seen;
    /** @type {string[]} */
    const cells = [];
    /** @type {string[]} */
    const links = [];
    let next = 0;
    for (const cell of elements(body, "c")) {
      const ref = attr(cell.attrs, "r")?.match(/^([A-Za-z]{1,3})\d*$/);
      const col = ref ? columnIndex(ref[1]) : next;
      next = col + 1;
      const inner = cell.inner;
      if (inner === undefined || col < 0) continue;
      const text = textOfCell(cell.attrs, inner, strings);
      if (col >= MAX_COLUMNS) {
        if (text.trim() !== "") tooWide = true;
        continue;
      }
      while (cells.length < col) cells.push("");
      cells[col] = text.slice(0, MAX_CELL_CHARS);
      const formula = inner.match(/<f\b[^>]*>([\s\S]*?)<\/f>/);
      const link = formula ? HYPERLINK_FORMULA.exec(decode(formula[1])) : null;
      if (link) links[col] = link[1];
    }
    if (cells.some((cell) => cell.trim() !== "")) {
      filled += 1;
      if (filled > MAX_ROWS + HEADER_SEARCH) {
        tooMany = true;
        break;
      }
    }
    byNumber.set(n, { n, cells, links });
  }
  for (const link of elements(xml, "hyperlink")) {
    const target = relTargets.get(attr(link.attrs, "r:id") ?? "");
    const [first, last] = (attr(link.attrs, "ref") ?? "").split(":");
    const from = cellRef(first);
    const to = cellRef(last ?? first);
    if (!target || !from || !to) continue;
    for (let r = from.row; r <= Math.min(to.row, from.row + MAX_ROWS); r++) {
      const row = byNumber.get(r);
      if (!row) continue;
      for (let c = from.col; c <= Math.min(to.col, MAX_COLUMNS - 1); c++) row.links[c] = target;
    }
  }
  for (const merge of elements(xml, "mergeCell")) {
    const [first, last] = (attr(merge.attrs, "ref") ?? "").split(":");
    const from = cellRef(first);
    const to = cellRef(last);
    if (!from || !to) continue;
    const value = byNumber.get(from.row)?.cells[from.col] ?? "";
    if (!value) continue;
    for (let r = from.row; r <= Math.min(to.row, from.row + MAX_ROWS); r++) {
      let row = byNumber.get(r);
      if (!row) {
        row = { n: r, cells: [], links: [] };
        byNumber.set(r, row);
      }
      for (let c = from.col; c <= Math.min(to.col, MAX_COLUMNS - 1); c++) {
        while (row.cells.length < c) row.cells.push("");
        if (!row.cells[c]) row.cells[c] = value;
      }
    }
  }
  const rows = [...byNumber.values()]
    .sort((a, b) => a.n - b.n)
    .filter((row) => row.cells.some((cell) => cell && cell.trim() !== ""));
  for (const row of rows) for (let c = 0; c < row.cells.length; c++) row.cells[c] ??= "";
  return { rows, tooMany, tooWide };
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

/** @param {string | null} xml */
function relationships(xml) {
  /** @type {Map<string, string>} */
  const targets = new Map();
  for (const rel of elements(xml ?? "", "Relationship")) {
    const id = attr(rel.attrs, "Id");
    if (id) targets.set(id, attr(rel.attrs, "Target") ?? "");
  }
  return targets;
}

// The visible sheets, in the workbook's order. A hidden sheet is someone's
// workings, not their list.
/** @param {string | null} workbook @param {string | null} rels @param {Map<string, unknown>} entries */
function sheetList(workbook, rels, entries) {
  const targets = relationships(rels);
  /** @type {{ name: string, path: string }[]} */
  const sheets = [];
  for (const sheet of elements(workbook ?? "", "sheet")) {
    const state = attr(sheet.attrs, "state");
    if (state === "hidden" || state === "veryHidden") continue;
    const target = targets.get(attr(sheet.attrs, "r:id") ?? "") ?? "";
    const path = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    if (/^xl\/worksheets\/[\w.-]+\.xml$/.test(path) && entries.has(path)) sheets.push({ name: attr(sheet.attrs, "name") || `Sheet ${sheets.length + 1}`, path });
    if (sheets.length >= MAX_SHEETS) break;
  }
  if (!sheets.length && entries.has("xl/worksheets/sheet1.xml")) sheets.push({ name: "Sheet1", path: "xl/worksheets/sheet1.xml" });
  return sheets;
}

/** @param {Buffer} buf @returns {Sheet[]} */
function readXlsx(buf) {
  const entries = zipEntries(buf);
  if (!entries.has("xl/workbook.xml")) fail("That file is not an Excel workbook.");
  let expanded = 0;
  /** @param {string} name */
  const read = (name) => {
    const text = readEntry(buf, entries, name);
    expanded += text?.length ?? 0;
    if (expanded > MAX_TOTAL_BYTES) fail("That workbook is too large to import. Split it into smaller files.");
    return text;
  };
  const list = sheetList(read("xl/workbook.xml"), read("xl/_rels/workbook.xml.rels"), entries);
  if (!list.length) fail("That workbook has no sheet to read.");
  const strings = sharedStrings(read("xl/sharedStrings.xml") ?? "");
  return list.map(({ name, path }) => {
    const relsPath = path.replace(/^xl\/worksheets\//, "xl/worksheets/_rels/") + ".rels";
    const links = new Map([...relationships(read(relsPath))].filter(([, target]) => /^https?:\/\//i.test(target)));
    return { name, ...sheetRows(read(path) ?? "", strings, links) };
  });
}

// ---- csv ------------------------------------------------------------------

/** @param {Buffer} buf */
function decodeText(buf) {
  // Excel's "Unicode Text" is UTF-16 with a byte-order mark.
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder("utf-16be").decode(buf.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, "");
  } catch {
    // Excel's "CSV" is often Windows-1252 rather than UTF-8.
    return new TextDecoder("windows-1252").decode(buf);
  }
}

// The separator is the one that splits the opening lines most consistently,
// not just the first line: a title line above the table has none.
/** @param {string} text */
function delimiterOf(text) {
  const lines = text.split(/\r\n|\n|\r/).filter((line) => line.trim() !== "").slice(0, 12);
  let best = ",";
  let bestScore = 0;
  for (const candidate of [",", ";", "\t"]) {
    const counts = lines.map((line) => {
      let inQuotes = false;
      let count = 0;
      for (const ch of line) {
        if (ch === '"') inQuotes = !inQuotes;
        else if (ch === candidate && !inQuotes) count += 1;
      }
      return count;
    });
    const score = counts.filter((count) => count > 0).length * 1000 + Math.max(0, ...counts);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/** @param {string} text @returns {Omit<Sheet, "name">} */
function csvRows(text) {
  const delimiter = delimiterOf(text);
  /** @type {SheetRow[]} */
  const rows = [];
  let cells = [];
  let cell = "";
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;
  let tooMany = false;
  let tooWide = false;
  const endCell = () => {
    cells.push(cell.slice(0, MAX_CELL_CHARS));
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (cells.length > MAX_COLUMNS) {
      if (cells.slice(MAX_COLUMNS).some((value) => value.trim() !== "")) tooWide = true;
      cells = cells.slice(0, MAX_COLUMNS);
    }
    if (cells.some((value) => value.trim() !== "")) {
      rows.push({ n: rowLine, cells, links: [] });
      if (rows.length > MAX_ROWS + HEADER_SEARCH) tooMany = true;
    }
    cells = [];
  };
  for (let i = 0; i < text.length && !tooMany; i++) {
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
  if (!tooMany && (cell !== "" || cells.length > 0)) endRow();
  return { rows: tooMany ? rows.slice(0, MAX_ROWS + HEADER_SEARCH) : rows, tooMany, tooWide };
}

// ---- entry points ---------------------------------------------------------

/**
 * Every visible sheet of a workbook (one for a CSV), with the sheets' own row
 * numbers and empty rows left out. A sheet that is too large is marked rather
 * than refused, so a big sheet of workings beside the real list does not stop
 * the import; using a marked sheet is refused by assertUsable.
 * @param {Uint8Array} bytes
 * @returns {{ sheets: Sheet[] }}
 */
export function readWorkbook(bytes) {
  if (bytes.length === 0) fail("That file is empty.");
  if (bytes.length > MAX_FILE_BYTES) fail(`That file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB. Split it into smaller files.`);
  if (isLegacyExcel(bytes)) fail("That is an old .xls workbook. In Excel choose Save As and pick .xlsx (or .csv), then import that.");
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sheets = isZip(bytes) ? readXlsx(buf) : [{ name: "CSV", ...csvRows(decodeText(buf)) }];
  return { sheets };
}

/** @param {Sheet} sheet @param {number} bodyRows the number of people rows once the headings are found */
export function assertUsable(sheet, bodyRows = sheet.rows.length - 1) {
  if (sheet.tooWide) fail(`That sheet has more than ${MAX_COLUMNS} columns. Remove the ones you do not need and try again.`);
  if (sheet.tooMany || bodyRows > MAX_ROWS) fail(`That sheet has more than ${MAX_ROWS.toLocaleString("en-GB")} rows. Split it into smaller files and import them one at a time.`);
  if (bodyRows < 1) fail("There is nothing to import: the sheet needs a row of column names followed by the people.");
}

/**
 * The first sheet, with the first row as the headings.
 * @param {Uint8Array} bytes
 * @returns {{ rows: SheetRow[] }}
 */
export function readSpreadsheet(bytes) {
  const [sheet] = readWorkbook(bytes).sheets;
  assertUsable(sheet);
  return { rows: sheet.rows };
}
