# AWS Console Re-login

A small Chrome extension for IAM Identity Center users with many AWS console tabs open
across several accounts. 2 minutes before an account's session ends, it signs that account
back in through your access portal in a background tab. Every console tab for that account
then reloads on the page it was on, so you never see the "session expired" page. It also
keeps each account's tabs in a tab group named after the account.

## Who it's for

People who sign in to the AWS console through IAM Identity Center's access portal
(`…awsapps.com/start` or `…portal.<region>.app.aws`), in Chrome, in AWS's standard regions.
It doesn't cover GovCloud or China regions, IAM users, or companies that federate from Okta
or another identity provider straight into AWS roles without the access portal.

## Install

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick this `aws-console-relogin` folder.
3. Pin it from the puzzle-piece menu so you can see its badge.

## First use

- Open your access portal's account list once. The extension saves the portal URL and your account names. You can also enter the URL under **Settings**.
- Launch your accounts from the portal as usual. The extension then knows each session's role and exact start time.
- If your permission sets allow sessions longer than 60 minutes, change **Session length** in Settings.
- Turn on the console's **multi-session** support (account menu, **Turn on multi-session**) if it isn't on already. That's what lets one browser stay signed in to several accounts.

## What you'll see

- **Tab groups:** each account's console tabs go into their own colored tab group, named after the account as your access portal shows it. Until the portal's account list has been opened, the group shows the account ID. To use a different name, set one under **Settings**. A tab is grouped when it first opens on an account, so if you drag one out, it stays out. You can recolor a group in Chrome and it keeps your color. Turn grouping off in Settings.
- **Badge:** minutes left on the session that expires next. `…` means it's signing an account back in. `!` means it needs you.
- **Popup:** each account with open tabs, how long it has left, and **Re-login** / **Re-login all** buttons.
- **2 minutes before expiry:** a helper tab opens in the background, signs in again and closes by itself. That account's tabs then reload onto the new session. If your portal login has also expired (or MFA is needed), the helper tab comes to the front after about 12 seconds so you can sign in. Then it finishes the job.

## Permissions

It only asks for access to these sites: `*.console.aws.amazon.com`, `*.signin.aws.amazon.com`, `*.awsapps.com` and `*.app.aws`. It reads the URLs of tabs on those sites, navigates those tabs, and puts them in tab groups (`tabGroups`). The only page it reads is your access portal: a small script ([portal.js](portal.js)) picks out each account ID and the name next to it, and nothing else. It has no permission to read cookies, never reads AWS console pages, and never stores sign-in URLs. It makes no network requests of its own and sends nothing anywhere: everything it remembers stays in Chrome's local extension storage.

## Limits

- Expiry is a timer. For a session that was already open when you installed the extension, it doesn't know the real start time (shown as `~` in the popup). Use **Re-login** for those.
- A session can't be extended, only replaced. AWS ends the old session as soon as the same account and role signs in again, so that account's tabs show a sign-in page for the few seconds until they reload. Anything you were typing on those pages is lost. The only way to have fewer interruptions is a longer session: an admin can raise the permission set's session duration to up to 12 hours.
- The console allows up to 5 signed-in sessions per browser. If all 5 are taken when a re-login signs in, the helper tab signs the old session out (the same link as the console's own **Sign out**) and tries again. That account's tabs show a sign-in page for those few seconds, until they reload. If even that doesn't free a slot, the helper tab comes to the front on "Choose your AWS session" so you can pick.

## Development

There's no build step: Chrome loads the files as they are. After a change, click reload on the extension's card in `chrome://extensions`.

- [background.js](background.js) tracks sessions and tabs, runs re-logins and tab groups.
- [lib.js](lib.js) has the URL helpers for console, sign-in and access portal addresses.
- [portal.js](portal.js) runs on the access portal and reads account names.
- [popup.html](popup.html) / [options.html](options.html) are the toolbar popup and Settings page.

Tests:

- `npm test` (Node 20 or later, no dependencies) runs [test/background.test.mjs](test/background.test.mjs), which drives background.js through a simulated Chrome with simulated time: launches, re-logins before expiry, portal logins, full session slots, tab groups and names.
- Open [test/portal.html](test/portal.html) in Chrome to check portal.js against several portal-style layouts. The page title turns to PASS or FAIL.

The icons are drawn as SVG in [icons/](icons). To re-render the PNGs (needs `rsvg-convert` from librsvg):

```sh
rsvg-convert -w 16 -h 16 icons/icon-16.svg -o icons/icon16.png
rsvg-convert -w 32 -h 32 icons/icon-32.svg -o icons/icon32.png
rsvg-convert -w 48 -h 48 icons/icon.svg -o icons/icon48.png
rsvg-convert -w 128 -h 128 icons/icon.svg -o icons/icon128.png
```

## Packaging

`npm run package` builds `dist/aws-console-relogin.zip` with just the files the extension needs (no tests or icon sources). Bump `version` in [manifest.json](manifest.json) first: the Chrome Web Store rejects an upload whose version isn't higher than the last one.

- **Chrome Web Store:** upload the ZIP in the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) (one-time $5 developer registration). The listing needs a description, at least one screenshot (1280×800 or 640×400) and the Privacy tab: a single-purpose statement, a reason for each permission, and a declaration that no user data is collected. Visibility can be **Public**, **Unlisted** (anyone with the link) or **Private** (only your Google Workspace domain or listed testers).
- **Screenshot:** [store/screenshot-1280x800.png](store/screenshot-1280x800.png) shows the extension with made-up data. It's rendered from [store/screenshot.html](store/screenshot.html) by `npm run screenshot` (needs Chrome; set `CHROME` to its path if it isn't in /Applications).
- **Microsoft Edge Add-ons:** the same ZIP works, through Microsoft Partner Center (free).
- **Without a store:** share the ZIP or the repo; people unzip it and use **Load unpacked**. Chrome's own **Pack extension** button makes a `.crx`, but Chrome on Mac and Windows won't install one from outside the Web Store.

## Disclaimer

Not affiliated with, endorsed by, or sponsored by Amazon Web Services. AWS and IAM Identity Center are trademarks of Amazon.com, Inc. or its affiliates.

## License

[MIT](LICENSE)
