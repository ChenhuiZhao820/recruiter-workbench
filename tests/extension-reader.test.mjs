import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { chromium } from "playwright";

// The extension's page reader, run in a real Chromium against the shape of
// LinkedIn's 2026 profile page (tests/fixtures/linkedin). The page is served
// from the fixture and every other request is refused: nothing reaches
// LinkedIn, and the page's own scripts never run.
const source = readFileSync(new URL("../extension/popup.js", import.meta.url), "utf8");
const reader = source.slice(source.indexOf("function readProfile()"), source.indexOf("async function readActiveTab")).trim();
const fixture = readFileSync(new URL("./fixtures/linkedin/profile-2026.html", import.meta.url), "utf8");
const address = "https://www.linkedin.com/in/priya-kaur/";

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

async function read(html = fixture) {
  const page = await browser.newPage({ javaScriptEnabled: false });
  try {
    await page.route("**/*", (route) => (route.request().url() === address
      ? route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html })
      : route.abort()));
    await page.goto(address);
    return await page.evaluate(`(${reader})()`);
  } finally {
    await page.close();
  }
}

const without = (html, from, to) => html.slice(0, html.indexOf(from)) + html.slice(html.indexOf(to) + to.length);

test("the 2026 profile page gives the name, headline, company and member id", async () => {
  assert.deepEqual(await read(), {
    profileUrl: address,
    name: "Priya Kaur",
    headline: "Head of Growth - Northwind Foods",
    company: "Northwind Foods",
    memberId: "ACoAAFixture01",
    isProfile: true,
    settled: true,
  });
});

test("without a logo, the current role's own lines name the company", async () => {
  assert.equal((await read(fixture.replace('<img alt="Northwind Foods logo">', ""))).company, "Northwind Foods");
});

test("several roles at one employer: the logo names the employer, never the time spent there", async () => {
  const first = fixture.indexOf('<div componentkey="entity-collection-item-0a1b2c3d">');
  const second = fixture.indexOf('<div componentkey="entity-collection-item--4e5f6a7b">');
  const grouped = (fixture.slice(0, first) + fixture.slice(second))
    .replace("Jun 2023 - Dec 2025 · 2 yrs 7 mos", "Jun 2023 - Present · 3 yrs 5 mos");
  // The grouped entry is first and still running.
  assert.equal((await read(grouped.replace("Head of Growth - Northwind Foods", "Marketing Lead"))).company, "Contoso");
  assert.equal((await read(grouped.replace('<img alt="Contoso logo">', ""))).company, "Contoso");
});

test("a first role that has ended is not where they work now: the header's line is used", async () => {
  const ended = fixture.replace("Jan 2026 - Present · 10 mos", "Jan 2024 - Dec 2025 · 2 yrs").replace("Northwind Foods · University", "Fabrikam · University");
  assert.equal((await read(ended)).company, "Fabrikam");
});

test("before Experience has loaded, the header's Company · School line gives the company", async () => {
  const header = without(fixture, '<section componentkey="99887766', "</div></section>");
  const profile = await read(header);
  assert.equal(profile.company, "Northwind Foods");
  assert.equal(profile.headline, "Head of Growth - Northwind Foods");
});
