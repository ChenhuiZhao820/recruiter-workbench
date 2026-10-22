# Retrivr for Chrome

Saves the LinkedIn profile you already have open to your workbench, so you stop
retyping a name, a headline and a URL you are both looking at.

## What it does, and what it deliberately does not

It reads **the page you are looking at, and nothing else**. There is no
background script, no crawler, no bulk save, and no request is ever made to
LinkedIn: the page is already open in front of you, and only what is on it is
read.

Out of the box the extension asks for `activeTab`, which Chrome grants only
after you click the toolbar button and takes back as soon as the tab moves on.
That is why the panel used to need a click on every profile. LinkedIn is also
declared as an **optional** origin: it is not granted when you install. The
panel's **Follow profiles** switch asks Chrome for it the first time you turn
it on, and from then on the panel fills itself in as you move between profiles
until you turn the switch off. You can say no and keep clicking; you can grant
it and later remove it in `chrome://extensions`; and turning the switch off
stops the reading without closing the panel. Even granted, nothing is registered to run on
LinkedIn - the reader is injected only while the panel is open, and nothing
leaves your browser until you press Save.

Requests go only to the configured workbench. Source builds support HTTP
loopback; hosted packages additionally permit one explicit HTTPS workbench origin.

## Install

The extension is built for one workbench address, and that address is baked into
the package: Chrome will only let it talk to the host it was packaged for. So
install it from the site you actually use, not from this source folder.

For the hosted deployment that is <https://retrivr.app>.

1. Sign in to Retrivr and open **Your account**. Ask your administrator for your
   account's extension activation code and redeem it there within 7 days.
   Codes work once for the assigned account only. A replacement invalidates the
   previous code. Active administrators do not need an extension activation code.
2. Choose **Download extension ZIP** and extract it into a permanent folder.
3. In desktop Chrome, go to `chrome://extensions`, enable **Developer mode**,
   choose **Load unpacked**, and select the extracted `capture-extension` folder
   containing `manifest.json`. Keep that folder on your computer.
4. Pin Retrivr from Chrome's extensions menu. In Retrivr **Settings**, generate
   your personal **extension key**. Paste it into the extension and connect; the
   workbench address is already filled in. Verify the displayed name and email.
5. Create an open role in your own workspace if you do not have one yet.

The activation code unlocks account access; it is not the extension key. Neither is
included in the ZIP. Website login and the extension's connected account remain
independent. Changing your password revokes extension keys but retains extension
access, so generate a new key and reconnect afterwards.

You can download again without another activation code. Unpacked extensions do
not update automatically: download a fresh package when an update is available.
If your organisation blocks Developer mode, contact your IT administrator.

The hosted workbench may be asleep when you first click **Connect**: a free
instance spins down while nobody is using it and takes up to a minute to answer
the request that wakes it. The extension waits that long before giving up and
says so; pressing **Connect** again after the site has woken always works.

## Building for another address

`/api/extension/download` packages for whatever `APP_ORIGIN` the running site is
configured with, so a correctly configured deployment already serves the right
package. To build one by hand, from a checkout:

```
npm run extension:package -- --origin https://retrivr.app
```

That writes `dist/capture-extension`, ready to load unpacked. The origin must be
an exact HTTPS host with no path; there are no wildcards, and the packaged
extension can reach that host and loopback, nothing else.

For local development, load this repository's `extension` folder instead. It is
built for the deployment above and offers that address by default, and it also
reaches `http://localhost` and `http://127.0.0.1` on any port, so point it at your
dev server by typing the address. Account authorization still applies either way.

A package built for some other origin reaches that origin and loopback, and
nothing else - the deployment above is not carried along with it.

If the extension keeps offering an address you no longer use, it is remembering
the last one you connected to. **Disconnect** in Settings forgets both the key and
the address and puts back the one this build is for.

## Use

Open a profile, click the extension, check the fields, add a note in your own
words, pick the role, and save. The note is the part worth typing: it is the
one thing no page can tell you. After a save, **Open this role in the
workbench** takes you straight to where the person landed.

## Their email

Below the profile link is an **Email** field. Type an address there, or, when
your plan has the email finder, press the green **Find email** beside it: the
panel asks your workbench, which asks Enrow by the profile's LinkedIn address.
Nothing is asked of LinkedIn. The searches left show above the field, and only
a search that finds an email uses one. It says **Found.** and fills the field,
or **Email cannot be found. No credit was used.** It searches once per click,
never on its own. Someone you already keep an email for shows it instead, and
the button is greyed out with the reason on hover, as it is when no searches
are left. Saving puts the address on the person when they have none; it never
replaces one you already keep.

## Keeping it open while you work a list

The popup closes the moment it loses focus, so working through a list of
profiles means clicking the toolbar button on every one of them. **Keep open**
in the top corner moves the same page into Chrome's side panel, where it stays
while you walk from profile to profile. Chrome remembers that the panel is open
across page loads and tab switches, so it is there on the next profile without
being asked for again. **Close panel**, or Chrome's own X, puts it away; the
toolbar button brings it back.

The panel notices when the tab moves to another page and fills in the new
person, clearing the note, which belonged to the last one. If it cannot read the
page - you have not allowed LinkedIn, and Chrome has taken `activeTab` back -
it empties the name, headline and link rather than showing you somebody else's
details, and offers **Read this profile** once you have clicked the toolbar
button. A stale name is never left sitting next to a new profile.

On a page that is not a profile, a search result list or your inbox, the panel
simply waits. That is not an error and it does not say it is.

## People you already have

When the panel reads a profile it asks your workbench - not LinkedIn - whether
that link is already on one of your roles. If it is, it says so, names the role
and offers to open it. It does not stop you: filing the same person against a
second role is a decision you are allowed to make, and the save still refuses
an exact duplicate on the same role.

The panel is the same page as the popup. It cannot read a page you have not
allowed it to read, and nothing is saved without your click.

**Settings** shows the connected account and the address it saves to. From
there, **Open workbench settings** jumps to the page that generates capture
keys, **Back** returns to the profile you were saving, and **Forget this key**
disconnects the account without touching your website login.

If the popup or panel says it could not reach the workbench, the workbench
itself is usually not running. Start it, then press **Connect** again; nothing
you typed is lost.

If LinkedIn changes its markup, the name or headline may come through empty.
Every field stays editable, so it degrades to typing rather than to breaking.
