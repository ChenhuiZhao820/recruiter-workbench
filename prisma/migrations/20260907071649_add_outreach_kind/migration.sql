-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MessageTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'message',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_MessageTemplate" ("body", "createdAt", "id", "name", "updatedAt") SELECT "body", "createdAt", "id", "name", "updatedAt" FROM "MessageTemplate";
DROP TABLE "MessageTemplate";
ALTER TABLE "new_MessageTemplate" RENAME TO "MessageTemplate";
CREATE TABLE "new_OutreachLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candidateId" TEXT NOT NULL,
    "templateId" TEXT,
    "renderedBody" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'message',
    "sentAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OutreachLog_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OutreachLog_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_OutreachLog" ("candidateId", "id", "renderedBody", "sentAt", "templateId") SELECT "candidateId", "id", "renderedBody", "sentAt", "templateId" FROM "OutreachLog";
DROP TABLE "OutreachLog";
ALTER TABLE "new_OutreachLog" RENAME TO "OutreachLog";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
