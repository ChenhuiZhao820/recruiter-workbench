-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "recruiterName" TEXT NOT NULL DEFAULT '',
    "calendarLink" TEXT NOT NULL DEFAULT '',
    "bookingChaseDays" INTEGER NOT NULL DEFAULT 2,
    "quietNudgeDays" INTEGER NOT NULL DEFAULT 5,
    "captureToken" TEXT NOT NULL DEFAULT ''
);
INSERT INTO "new_Settings" ("bookingChaseDays", "calendarLink", "id", "quietNudgeDays", "recruiterName") SELECT "bookingChaseDays", "calendarLink", "id", "quietNudgeDays", "recruiterName" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
