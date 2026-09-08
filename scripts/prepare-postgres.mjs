import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function postgresSchema(source) {
  const datasource = /datasource\s+db\s*\{[^}]*\}/g;
  const blocks = source.match(datasource);
  if (blocks?.length !== 1 || !/provider\s*=\s*"sqlite"/.test(blocks[0])) {
    throw new Error("Expected exactly one SQLite datasource named db.");
  }
  return source.replace(datasource, (block) => block.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"'));
}

export async function preparePostgres({ check = false } = {}) {
  const source = await readFile(resolve(root, "prisma/schema.prisma"), "utf8");
  const target = resolve(root, "prisma/postgresql/schema.prisma");
  const schema = postgresSchema(source);
  if (check) {
    if (await readFile(target, "utf8") !== schema) throw new Error("PostgreSQL schema is stale; run prepare-postgres.mjs.");
  } else {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, schema, "utf8");
  }
  return target;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.slice(2).some((arg) => arg !== "--check") || process.argv.length > 3) throw new Error("Usage: node scripts/prepare-postgres.mjs [--check]");
    console.log(await preparePostgres({ check: process.argv.includes("--check") }));
  } catch {
    console.error("PostgreSQL schema preparation failed. Check the source schema and output permissions.");
    process.exitCode = 1;
  }
}
