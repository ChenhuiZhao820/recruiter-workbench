import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const usage = "Usage: node scripts/package-extension.mjs --origin https://workbench.example.com[:port]";

export function validateOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("An explicit HTTPS workbench origin is required. " + usage);
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

async function existing(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function packageExtension(originValue, root = projectRoot) {
  const origin = validateOrigin(originValue);
  const source = join(root, "extension");
  const files = {};
  for (const name of ["popup.html", "popup.css", "popup.js"]) {
    files[name] = await readFile(join(source, name), "utf8");
  }
  const manifest = JSON.parse(await readFile(join(source, "manifest.json"), "utf8"));
  manifest.host_permissions = ["http://localhost/*", "http://127.0.0.1/*", `https://${new URL(origin).hostname}/*`];
  manifest.content_security_policy = {
    extension_pages: `script-src 'self'; object-src 'self'; connect-src http://localhost:* http://127.0.0.1:* ${origin};`,
  };
  if (manifest.background || manifest.content_scripts || manifest.optional_host_permissions || manifest.optional_permissions ||
      JSON.stringify(manifest.permissions) !== JSON.stringify(["activeTab", "scripting", "storage"])) {
    throw new Error("Unexpected source extension permissions or background/content scripts; review before packaging.");
  }
  const popupScript = '<script src="popup.js"></script>';
  if (files["popup.html"].split(popupScript).length !== 2) {
    throw new Error("Expected one external popup.js script in popup.html.");
  }
  files["popup.html"] = files["popup.html"].replace(popupScript, `<script src="workbench.js"></script>\n    ${popupScript}`);
  files["workbench.js"] = `"use strict";\nglobalThis.BASANITE_WORKBENCH_ORIGINS = ${JSON.stringify([origin])};\n`;
  files["manifest.json"] = JSON.stringify(manifest, null, 2) + "\n";

  const dist = join(root, "dist");
  const output = join(dist, "capture-extension");
  const distStat = await existing(dist);
  if (distStat && (!distStat.isDirectory() || distStat.isSymbolicLink())) {
    throw new Error("Refusing an output parent that is not a real directory: " + dist);
  }
  if (await existing(output)) {
    throw new Error("Output already exists; move it aside before packaging: " + output);
  }
  if (!distStat) await mkdir(dist);
  await mkdir(output);
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(output, name), content, { flag: "wx" });
  }
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  try {
    if (args.length !== 2 || args[0] !== "--origin") throw new Error(usage);
    const output = await packageExtension(args[1]);
    console.log(`Packaged Basanite Capture for ${validateOrigin(args[1])}: ${output}`);
    console.log("Load this directory as an unpacked extension. Its capture account is independent of website login.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
