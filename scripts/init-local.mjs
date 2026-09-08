import { open, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

async function main() {
  const [flag, target, ...rest] = process.argv.slice(2);
  if (flag !== "--path" || !target || !isAbsolute(target) || !target.endsWith(".db") || rest.length) {
    throw new Error("Usage: node scripts/init-local.mjs --path ABSOLUTE_NEW_DATABASE.db");
  }
  const parent = await realpath(dirname(target));
  if (!(await stat(parent)).isDirectory()) throw new Error("The parent must be an existing directory.");
  const path = resolve(target);
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
  } catch {
    throw new Error("Refusing to initialize an existing or inaccessible file. Choose a new private database path.");
  }
  await handle.close();
  const result = spawnSync(process.execPath, [require.resolve("prisma/build/index.js"), "db", "push", "--schema", resolve(root, "prisma/schema.prisma"), "--skip-generate"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: `file:${path.replaceAll("\\", "/")}` },
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error("Initialization failed. Do not use the partially initialized target; the legacy database was not touched.");
  console.log("Fresh account database initialized. Set DATABASE_URL to this new file before bootstrapping Admin and importing legacy data.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
