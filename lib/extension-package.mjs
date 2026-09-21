export function validateOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("An explicit HTTPS workbench origin is required.");
  }
  if (typeof value !== "string" || !/^https:\/\/[^/?#\\@\s]+\/?$/.test(value) ||
      url.protocol !== "https:" || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash ||
      !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.?$/.test(url.hostname) ||
      /(^|\.)linkedin\.com\.?$/.test(url.hostname)) {
    throw new Error("Use an HTTPS workbench hostname with an optional port, no login, path, query, fragment or wildcard; LinkedIn is not a workbench host.");
  }
  return url.origin;
}

export function extensionFiles(source, originValue, { allowLoopback = false } = {}) {
  const local = allowLoopback && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(originValue);
  const origin = local ? new URL(originValue).origin : validateOrigin(originValue);
  const files = Object.fromEntries(["popup.html", "popup.css", "popup.js"].map((name) => {
    if (typeof source[name] !== "string") throw new Error("Missing extension source file.");
    return [name, source[name]];
  }));
  const manifest = JSON.parse(source["manifest.json"]);
  if (manifest.background || manifest.content_scripts || manifest.optional_host_permissions || manifest.optional_permissions ||
      JSON.stringify(manifest.permissions) !== JSON.stringify(["activeTab", "scripting", "storage"])) {
    throw new Error("Unexpected source extension permissions or background/content scripts; review before packaging.");
  }
  manifest.host_permissions = ["http://localhost/*", "http://127.0.0.1/*", ...(!local ? [`https://${new URL(origin).hostname}/*`] : [])];
  manifest.content_security_policy = {
    extension_pages: `script-src 'self'; object-src 'self'; connect-src http://localhost:* http://127.0.0.1:*${local ? "" : ` ${origin}`};`,
  };
  const popupScript = '<script src="popup.js"></script>';
  if (files["popup.html"].split(popupScript).length !== 2) throw new Error("Expected one external popup.js script in popup.html.");
  files["popup.html"] = files["popup.html"].replace(popupScript, `<script src="workbench.js"></script>\n    ${popupScript}`);
  files["workbench.js"] = `"use strict";\nglobalThis.CAPTURE_WORKBENCH_ORIGINS = ${JSON.stringify(local ? [] : [origin])};\n${local ? `globalThis.CAPTURE_WORKBENCH_DEFAULT = ${JSON.stringify(origin)};\n` : ""}`;
  files["manifest.json"] = JSON.stringify(manifest, null, 2) + "\n";
  return files;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function extensionZip(files) {
  const localEntries = [];
  const directory = [];
  let offset = 0;
  const names = ["manifest.json", "popup.css", "popup.html", "popup.js", "workbench.js"];
  for (const name of names) {
    if (typeof files[name] !== "string") throw new Error("Incomplete extension package.");
    const data = Buffer.from(files[name], "utf8");
    if (data.length > 4 * 1024 * 1024) throw new Error("Extension source exceeds the package size limit.");
    const filename = Buffer.from(`capture-extension/${name}`);
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(33, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    localEntries.push(header, filename, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    header.copy(entry, 6, 4, 30);
    entry.writeUInt32LE(offset, 42);
    directory.push(entry, filename);
    offset += header.length + filename.length + data.length;
  }
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localEntries, central, end]);
}
