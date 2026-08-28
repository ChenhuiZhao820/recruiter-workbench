import { db } from "./db";

// Single-row settings. Created on first read so the app works with no seed step.
export async function getSettings() {
  return db.settings.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1 },
  });
}
