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

Nothing is sent anywhere except your own workbench on localhost.

## Install

1. In the workbench, open **Settings** and generate a **capture key**.
2. Go to `chrome://extensions`, switch on **Developer mode**, choose **Load
   unpacked**, and pick this `extension` folder.
3. Click the extension, paste the workbench address (`http://localhost:3000`)
   and the capture key, and connect.

## Use

Open a profile, click the extension, check the fields, add a note in your own
words, pick the role, and save. The note is the part worth typing: it is the
one thing no page can tell you.

If LinkedIn changes its markup, the name or headline may come through empty.
Every field stays editable, so it degrades to typing rather than to breaking.
