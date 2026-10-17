import { crc32, deflateRawSync } from "node:zlib";

// Workbooks built in memory for the import tests: no binary fixtures, and
// nothing from a real person.

export function zip(files, { method = 8, flags = 0, lieSize = null } = {}) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content);
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(flags, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(crc32(raw), 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(lieSize ?? raw.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    central.push(entry, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBytes, end]);
}

const esc = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const letters = (i) => String.fromCharCode(65 + i);

export function xlsx(rows, { shared = true, sheetName = "People" } = {}) {
  const strings = [];
  const cell = (value, c, r) => {
    const ref = `${letters(c)}${r}`;
    if (value === null || value === "") return `<c r="${ref}"/>`;
    if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
    if (!shared) return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
    strings.push(value);
    return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
  };
  const body = rows.map((cells, r) => `<row r="${r + 1}">${cells.map((value, c) => cell(value, c, r + 1)).join("")}</row>`).join("");
  return zip({
    "[Content_Types].xml": "<Types/>",
    "xl/workbook.xml": `<workbook xmlns:r="x"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId7"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId7" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData>${body}</sheetData></worksheet>`,
  });
}

// A workbook with several sheets, each optionally hidden, with cells linked
// to addresses (the way a name is often linked to a profile), merged ranges
// and formula cells: `{ value, formula }` saves both, like Excel does.
export function workbook(sheets) {
  const strings = [];
  const files = { "[Content_Types].xml": "<Types/>" };
  const workbookSheets = [];
  const workbookRels = [];
  sheets.forEach((sheet, index) => {
    const n = index + 1;
    const cell = (value, c, r) => {
      const ref = `${letters(c)}${r}`;
      if (value === null || value === undefined || value === "") return `<c r="${ref}"/>`;
      if (typeof value === "object") return `<c r="${ref}" t="str"><f>${esc(value.formula)}</f><v>${esc(value.value)}</v></c>`;
      if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
      strings.push(value);
      return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
    };
    const body = sheet.rows.map((cells, r) => `<row r="${r + 1}">${cells.map((value, c) => cell(value, c, r + 1)).join("")}</row>`).join("");
    const links = Object.entries(sheet.links ?? {});
    const merges = sheet.merges ?? [];
    files[`xl/worksheets/sheet${n}.xml`] = `<worksheet><sheetData>${body}</sheetData>${merges.length ? `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>` : ""}${links.length ? `<hyperlinks>${links.map(([ref], i) => `<hyperlink ref="${ref}" r:id="rIdL${i}"/>`).join("")}</hyperlinks>` : ""}</worksheet>`;
    if (links.length) files[`xl/worksheets/_rels/sheet${n}.xml.rels`] = `<Relationships>${links.map(([, url], i) => `<Relationship Id="rIdL${i}" Type="hyperlink" Target="${esc(url)}" TargetMode="External"/>`).join("")}</Relationships>`;
    workbookSheets.push(`<sheet name="${esc(sheet.name ?? `Sheet${n}`)}" sheetId="${n}"${sheet.hidden ? ' state="hidden"' : ""} r:id="rIdS${n}"/>`);
    workbookRels.push(`<Relationship Id="rIdS${n}" Type="worksheet" Target="worksheets/sheet${n}.xml"/>`);
  });
  files["xl/workbook.xml"] = `<workbook xmlns:r="x"><sheets>${workbookSheets.join("")}</sheets></workbook>`;
  files["xl/_rels/workbook.xml.rels"] = `<Relationships>${workbookRels.join("")}</Relationships>`;
  files["xl/sharedStrings.xml"] = `<sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`;
  return zip(files);
}
