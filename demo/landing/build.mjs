// Inlines the two local fonts and writes a standalone page next to this script.
// Usage: node demo/landing/build.mjs [artifact-out-path]
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const font = (f) => "data:font/woff2;base64," + readFileSync(join(here, "../../app/fonts", f)).toString("base64");
const png = (f) => "data:image/png;base64," + readFileSync(join(here, f)).toString("base64");
const body = readFileSync(join(here, "landing.src.html"), "utf8")
  .replace("__SCHIBSTED__", font("schibsted-grotesk-variable.woff2"))
  .replace("__JETBRAINS__", font("jetbrains-mono-variable.woff2"))
  .replaceAll("__LOGO__", png("retrivr-logo.png"))
  .replaceAll("__MARK__", png("retrivr-mark.png"));
writeFileSync(join(here, "index.html"), `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${body}\n</body>\n</html>\n`);
if (process.argv[2]) writeFileSync(process.argv[2], body);
