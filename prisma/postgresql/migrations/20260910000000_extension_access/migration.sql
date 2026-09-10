CREATE TABLE "ExtensionAccess" (
    "userId" TEXT NOT NULL,
    "codeHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtensionAccess_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "ExtensionAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ExtensionAccess_codeHash_key" ON "ExtensionAccess"("codeHash");
