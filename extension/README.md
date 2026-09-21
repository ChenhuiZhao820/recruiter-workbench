# Capture

Saves the LinkedIn profile you already have open to your workbench, so you stop
retyping a name, a headline and a URL you are both looking at.

## What it does, and what it deliberately does not

It reads **one page, when you click it**. There is no background script, no
crawler, and no bulk save. The extension asks for `activeTab` rather than
permission over `linkedin.com`, which means Chrome itself only grants it access
to the tab after you click the toolbar button. It cannot read anything while
you browse, even if it wanted to: that is enforced by the browser, not by a
promise in this file.

Requests go only to the configured workbench. Source builds support HTTP
loopback; hosted packages additionally permit one explicit HTTPS workbench origin.

## Install

The extension is built for one workbench address, and that address is baked into
the package: Chrome will only let it talk to the host it was packaged for. So
install it from the site you actually use, not from this source folder.

For the hosted deployment that is <https://capture-workbench.onrender.com>.

1. Sign in to Capture and open **Your account**. Ask your administrator for your
   account's extension activation code and redeem it there within 7 days.
   Codes work once for the assigned account only. A replacement invalidates the
   previous code. Active administrators do not need an extension activation code.
2. Choose **Download extension ZIP** and extract it into a permanent folder.
3. In desktop Chrome, go to `chrome://extensions`, enable **Developer mode**,
   choose **Load unpacked**, and select the extracted `capture-extension` folder
   containing `manifest.json`. Keep that folder on your computer.
4. Pin Capture from Chrome's extensions menu. In Capture **Settings**, generate
   your personal **capture key**. Paste it into the extension and connect; the
   workbench address is already filled in. Verify the displayed name and email.
5. Create an open role in your own workspace if you do not have one yet.

The activation code unlocks account access; it is not the capture key. Neither is
included in the ZIP. Website login and the extension's connected account remain
independent. Changing your password revokes capture keys but retains extension
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
npm run extension:package -- --origin https://capture-workbench.onrender.com
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

**Settings** shows the connected account and the address it saves to. From
there, **Open workbench settings** jumps to the page that generates capture
keys, **Back** returns to the profile you were saving, and **Forget this key**
disconnects the account without touching your website login.

If the popup says it could not reach the workbench, the workbench itself is
usually not running. Start it, then press **Connect** again; nothing you typed
is lost.

If LinkedIn changes its markup, the name or headline may come through empty.
Every field stays editable, so it degrades to typing rather than to breaking.
