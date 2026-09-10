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

For local development, load this repository's `extension` folder instead. Its
workbench address defaults to `http://localhost:3000`; account authorization still
applies. Do not distribute the loopback-only source build for a hosted workbench.

## Use

Open a profile, click the extension, check the fields, add a note in your own
words, pick the role, and save. The note is the part worth typing: it is the
one thing no page can tell you.

If LinkedIn changes its markup, the name or headline may come through empty.
Every field stays editable, so it degrades to typing rather than to breaking.
