#!/usr/bin/env node
// Run before every build. Refuses to build when the extension download changed
// without a release telling recruiters to fetch it (see lib/extension-release.mjs).
// `--fingerprint` prints the current download's fingerprint and nothing else.
import { extensionFingerprint, extensionReleaseProblems, readExtensionSource } from "../lib/extension-release.mjs";

const source = await readExtensionSource();
if (process.argv.includes("--fingerprint")) {
  console.log(extensionFingerprint(source));
} else {
  const problems = extensionReleaseProblems(source);
  if (problems.length) {
    console.error("Capture extension changed without telling anyone:");
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
  }
}
