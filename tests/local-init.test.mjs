import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const script = fileURLToPath(new URL("../scripts/init-local.mjs", import.meta.url));
const run = (target) => spawnSync(process.execPath, [script, "--path", target], { encoding: "utf8" });

test("local initialization refuses existing files without changing their bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "capture-init-refusal-"));
  const target = join(directory, "existing.db");
  try {
    await writeFile(target, "test fixture that must remain untouched");
    const before = await readFile(target);
    const result = run(target);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing to initialize/);
    assert.deepEqual(await readFile(target), before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fresh local schema and real Prisma enforce extended unique and nested ownership filters", async () => {
  const directory = await mkdtemp(join(tmpdir(), "capture-prisma-ownership-"));
  const target = join(directory, "new.db");
  const db = new PrismaClient({ datasourceUrl: `file:${target.replaceAll("\\", "/")}`, log: [] });
  try {
    const result = run(target);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const alice = await db.user.create({ data: { email: "alice@fixture.invalid", name: "Alice" } });
    const bob = await db.user.create({ data: { email: "bob@fixture.invalid", name: "Bob" } });
    const role = await db.role.create({ data: { title: "Alice private role", userId: alice.id } });
    const candidate = await db.candidate.create({ data: { roleId: role.id, fullName: "Fixture Candidate" } });
    assert.equal(await db.candidate.findUnique({ where: { id: candidate.id, role: { userId: bob.id } } }), null);
    await assert.rejects(db.candidate.update({ where: { id: candidate.id, role: { userId: bob.id } }, data: { notes: "forbidden" } }), { code: "P2025" });
    await assert.rejects(db.candidate.create({ data: { fullName: "Forbidden candidate", role: { connect: { id: role.id, userId: bob.id } } } }), { code: "P2025" });
    assert.equal(await db.candidate.count(), 1);
    assert.equal((await db.candidate.findUniqueOrThrow({ where: { id: candidate.id } })).notes, null);
    const search = await db.savedSearch.create({ data: { userId: alice.id, roleId: role.id, name: "Alice search" } });
    assert.equal(await db.savedSearch.findUnique({ where: { id: search.id, userId: bob.id, OR: [{ roleId: null }, { role: { userId: bob.id } }] } }), null);
    await db.candidate.update({ where: { id: candidate.id, role: { userId: alice.id } }, data: { notes: "allowed" } });
    assert.equal((await db.candidate.findUniqueOrThrow({ where: { id: candidate.id } })).notes, "allowed");
  } finally {
    await db.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
