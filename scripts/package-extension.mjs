import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { extensionFiles, validateOrigin } from "../lib/extension-package.mjs";

export { validateOrigin };
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const usage = "Usage: node scripts/package-extension.mjs --origin https://workbench.example.com[:port]";

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
  const inputs = {};
  for (const name of ["popup.html", "popup.css", "popup.js", "manifest.json"]) {
    inputs[name] = await readFile(join(source, name), "utf8");
  }
  const files = extensionFiles(inputs, origin);

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
    console.log(`Packaged Capture for ${validateOrigin(args[1])}: ${output}`);
    console.log("Load this directory as an unpacked extension. Its capture account is independent of website login.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
