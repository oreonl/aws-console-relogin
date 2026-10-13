# Chrome Web Store listing

## Store listing tab

**Category:** Productivity → Developer Tools

**Language:** English

**Summary** (comes from `description` in manifest.json, 132 characters max):

> Signs IAM Identity Center console sessions back in before they expire, restores their tabs, and groups tabs by account.

**Description** (plain text; the store doesn't render Markdown):

```text
AWS Console Re-login keeps your AWS console tabs signed in when you work through IAM Identity Center.

Identity Center console sessions often last only an hour. When one ends, every tab for that account stops working, and you have to go back to the access portal, launch the account again and reload each tab. This extension does that for you.

WHAT IT DOES
• Two minutes before an account's session ends, it signs that account back in through your access portal in a background tab, then reloads each of that account's console tabs on the page it was on.
• Puts each account's console tabs in their own tab group, named after the account as your access portal shows it.
• Shows the minutes left until the next session ends on its toolbar icon. Its popup lists every account with open tabs, with a Re-login button for each.
• If your access portal needs you to sign in again, for example for MFA, it brings the sign-in tab to the front and finishes once you're done.
• If all 5 of the console's session slots are taken, it signs the account's old session out to make room.

SETUP
1. If you use several accounts at once, turn on multi-session in the AWS console (account menu → Turn on multi-session).
2. Open your access portal's account list once. The extension saves the portal address and your account names.
3. Launch accounts from the portal as usual.
If your sessions last longer than an hour, set the session length in Settings. You can also turn off automatic re-login or tab grouping there.

PRIVACY
The extension only works with AWS console, AWS sign-in and access portal pages. It reads the addresses of those tabs and moves them between pages. On the access portal it reads account IDs and names, and nothing else. It never reads cookies, credentials or console page contents, makes no network requests of its own, and sends nothing anywhere. Everything it remembers stays in your browser.

REQUIREMENTS
The AWS console in standard AWS regions, signed in through IAM Identity Center's access portal (…awsapps.com/start or …portal.<region>.app.aws). It doesn't support GovCloud or China regions, IAM users, or identity providers that sign straight into AWS roles without the access portal.

LIMITS
An AWS console session can't be extended, only replaced. When the extension signs an account back in, AWS ends the old session, so that account's tabs show a sign-in page for a few seconds until they reload. Anything you were typing on those pages is lost.

Open source (MIT): https://github.com/oreonl/aws-console-relogin

Not affiliated with, endorsed by, or sponsored by Amazon Web Services. AWS and IAM Identity Center are trademarks of Amazon.com, Inc. or its affiliates.
```

**Screenshot:** [screenshot-1280x800.png](screenshot-1280x800.png)

**Homepage URL:** https://github.com/oreonl/aws-console-relogin

**Support URL:** https://github.com/oreonl/aws-console-relogin/issues

## Privacy tab

**Single purpose:**

> Keeps AWS console tabs usable across IAM Identity Center session expiry: it signs each account back in before its session ends, restores that account's tabs, and groups them by account.

**Permission justifications:**

- **storage:** Saves the user's settings, access portal address, account names and roles, and when each session started, in local extension storage.
- **alarms:** Schedules each account's re-login 2 minutes before its session ends, and updates the time-left badge every minute.
- **tabGroups:** Puts each AWS account's console tabs into a tab group named after the account.
- **Host permissions** (`*.console.aws.amazon.com`, `*.signin.aws.amazon.com`, `*.awsapps.com`, `*.app.aws`): To see which AWS console tabs are open and for which account, open the access portal's sign-in link for an account in a helper tab and follow it until the console loads, and move the account's tabs onto the new session. A content script on the access portal (`*.awsapps.com/start*`, `*.app.aws`) reads account IDs and names to label tab groups.

**Remote code:** No. All code is in the package.

**Data usage:** Nothing leaves the user's device: no network requests, no analytics. The extension handles AWS tab addresses and account names/IDs from the access portal, and keeps them only in local extension storage. Check the form's current definitions: if data handled only on the device doesn't count as collected, tick no categories; otherwise "Website content" (account names) and "Web history" (AWS tab addresses) are the closest. Then tick the certifications: data isn't sold, isn't used for unrelated purposes, and isn't used for creditworthiness or lending.
