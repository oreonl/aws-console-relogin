// End-to-end test of background.js against a simulated Chrome: tabs, tab groups,
// alarms, storage and messaging. Time is simulated too, so an hour-long session
// takes milliseconds.
//
//   npm test        (or: node test/background.test.mjs)
//
// Pass another extension folder as the first argument to test a copy of it.
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXT = process.argv[2] || fileURLToPath(new URL('..', import.meta.url));
let now = Date.parse('2026-10-12T09:00:00Z');
Date.now = () => now;

const permitted = (url) => {
  try {
    const h = new URL(url).hostname;
    return /(^|\.)console\.aws\.amazon\.com$|(^|\.)signin\.aws\.amazon\.com$|\.awsapps\.com$|\.app\.aws$/.test(h);
  } catch { return false; }
};

const listeners = {};
const on = (name) => ({ addListener: (fn) => ((listeners[name] ??= []).push(fn)) });
const fire = (name, ...args) => (listeners[name] || []).forEach((fn) => fn(...args));

const tabs = new Map();
const groups = new Map();
let nextGroup = 100;
let nextId = 1;
const log = [];
const alarms = new Map();
const store = { local: {}, session: {} };
const timers = [];
let badge = '';

const view = (t) => ({ ...t, url: permitted(t.url) ? t.url : undefined });
function setUrl(id, url) {
  tabs.get(id).url = url;
  setImmediate(() => fire('tabs.onUpdated', id, permitted(url) ? { url } : { status: 'loading' }, view(tabs.get(id))));
}

const area = (k) => ({
  get: async (keys) => Object.fromEntries(keys.filter((x) => x in store[k]).map((x) => [x, structuredClone(store[k][x])])),
  set: async (obj) => Object.assign(store[k], structuredClone(obj)),
});

globalThis.chrome = {
  tabs: {
    onUpdated: on('tabs.onUpdated'), onRemoved: on('tabs.onRemoved'), onReplaced: on('tabs.onReplaced'),
    get: async (id) => { if (!tabs.has(id)) throw new Error('no tab'); return view(tabs.get(id)); },
    create: async ({ url, active, windowId = 1, index = 0 }) => {
      const id = nextId++;
      tabs.set(id, { id, url, active: !!active, windowId, index, groupId: -1 });
      log.push(['create', id, url, !!active]);
      setUrl(id, url);
      return view(tabs.get(id));
    },
    update: async (id, props) => {
      if (!tabs.has(id)) throw new Error('no tab');
      if ('active' in props) { tabs.get(id).active = props.active; log.push(['activate', id]); }
      if (props.url) { log.push(['update', id, props.url]); setUrl(id, props.url); }
    },
    reload: async (id) => log.push(['reload', id]),
    remove: async (id) => { tabs.delete(id); log.push(['remove', id]); setImmediate(() => fire('tabs.onRemoved', id)); },
    group: async ({ tabIds, groupId, createProperties }) => {
      const id = groupId ?? nextGroup++;
      if (!groups.has(id)) groups.set(id, { id, windowId: createProperties.windowId, title: '', color: 'grey' });
      for (const t of [tabIds].flat()) { tabs.get(t).groupId = id; log.push(['group', t, id]); }
      return id;
    },
    query: async () => [...tabs.values()].filter((t) => /console\.aws\.amazon\.com/.test(t.url)).map(view),
  },
  storage: { local: area('local'), session: area('session') },
  tabGroups: {
    query: async ({ windowId, title }) => [...groups.values()]
      .filter((g) => (windowId === undefined || g.windowId === windowId) && (title === undefined || g.title === title)),
    update: async (id, props) => Object.assign(groups.get(id), props),
  },
  alarms: {
    onAlarm: on('alarms.onAlarm'),
    create: (name, o) => alarms.set(name, o.when ?? now + (o.delayInMinutes ?? o.periodInMinutes) * 60_000),
    clear: async (name) => alarms.delete(name),
  },
  runtime: {
    onInstalled: on('runtime.onInstalled'), onStartup: on('runtime.onStartup'), onMessage: on('runtime.onMessage'),
    openOptionsPage: () => log.push(['options']),
  },
  action: { setBadgeText: ({ text }) => (badge = text), setBadgeBackgroundColor: () => {} },
};
const realSetTimeout = setTimeout;
globalThis.setTimeout = (fn, ms) => (ms >= 10_000 ? timers.push(fn) : realSetTimeout(fn, ms));

const settle = () => new Promise((r) => realSetTimeout(r, 30));
const tab = (url) => { const id = nextId++; tabs.set(id, { id, url, active: false, windowId: 1, index: id, groupId: -1 }); setUrl(id, url); return id; };
const nav = async (id, url) => { setUrl(id, url); await settle(); };
const message = (msg) => new Promise((r) => fire('runtime.onMessage', msg, {}, r));
const advance = async (ms) => {
  now += ms;
  for (const [name, when] of [...alarms]) if (when <= now) { alarms.delete(name); fire('alarms.onAlarm', { name }); await settle(); }
};
const sinceLast = (n) => log.slice(n);
const loaded = async (id) => { fire('tabs.onUpdated', id, { status: 'complete' }, view(tabs.get(id))); await settle(); };
const groupOf = (id) => groups.get(tabs.get(id).groupId);

await import(pathToFileURL(path.join(EXT, 'background.js')));
fire('runtime.onInstalled');
await settle();

const PORTAL = 'https://d-1234567890.awsapps.com/start';
const A = '111111111111', B = '222222222222', C = '333333333333';

// 1. Open the portal: its URL is learned.
const portalTab = tab(`${PORTAL}/#/`);
await settle();
assert.equal(store.local.settings.portalBase, PORTAL);

// 2. Launch account A (Admin) from the portal, then browse two pages in two regions.
const a1 = tab(`${PORTAL}/#/console?account_id=${A}&role_name=Admin`);
await settle();
await nav(a1, 'https://signin.aws.amazon.com/federation?Action=login&SigninToken=SECRET123');
await nav(a1, `https://${A}-aaaa1111.us-east-1.console.aws.amazon.com/console/home?region=us-east-1`);
await nav(a1, `https://${A}-aaaa1111.us-east-1.console.aws.amazon.com/ec2/home?region=us-east-1#Instances:instanceState=running`);
const a2 = tab(`https://${A}-aaaa1111.us-west-2.console.aws.amazon.com/lambda/home?region=us-west-2#/functions`);
const aGone = tab(`https://${A}-aaaa1111.us-east-1.console.aws.amazon.com/s3/home`);
await settle();
await nav(aGone, 'https://example.com/elsewhere'); // left AWS; must not be dragged back
assert.equal(store.local.sessions[`${A}-aaaa1111`].exact, true);
assert.equal(store.local.accounts[A].role, 'Admin');

// 3. Ten minutes later, launch account B (ReadOnly).
await advance(10 * 60_000);
const b1 = tab(`${PORTAL}/#/console?account_id=${B}&role_name=ReadOnly`);
await settle();
await nav(b1, `https://${B}-bbbb2222.us-east-1.console.aws.amazon.com/cloudwatch/home?region=us-east-1#logsV2:log-groups`);
const status1 = await message({ type: 'status' });
assert.deepEqual(status1.sessions.map((s) => [s.acct, s.tabs, s.role]), [[A, 3, 'Admin'], [B, 1, 'ReadOnly']]);
assert.equal(badge, '50m');
// Tabs are grouped per account; the tab that left AWS stays where it was put.
assert.equal(groupOf(a1).title, '1111-1111-1111');
assert.equal(groupOf(a2).id, groupOf(a1).id);
assert.equal(groupOf(b1).title, '2222-2222-2222');
assert.notEqual(groupOf(b1).id, groupOf(a1).id);
assert.equal(groupOf(portalTab), undefined, 'portal tab not grouped');
assert.equal(groups.size, 2);
// Drag a2 out of its group: browsing within the same account doesn't pull it back.
tabs.get(a2).groupId = -1;
await nav(a2, `https://${A}-aaaa1111.us-west-2.console.aws.amazon.com/lambda/home?region=us-west-2#/functions`);
assert.equal(tabs.get(a2).groupId, -1, 'manual ungroup respected');
tabs.get(a2).groupId = groupOf(a1).id;

// 4. Two minutes before A expires (58 min in), a background helper tab signs A in again.
let mark = log.length;
await advance(48 * 60_000 - 1_000);
assert.ok(!sinceLast(mark).some((e) => e[0] === 'create'), 'nothing yet at 57:59');
await advance(1_000);
const created = sinceLast(mark).find((e) => e[0] === 'create');
assert.ok(created, 'helper tab created');
const [, driverA, driverUrl, driverActive] = created;
assert.equal(driverUrl, `${PORTAL}/#/console?account_id=${A}&role_name=Admin`);
assert.equal(driverActive, false);
assert.equal(badge, '…');

// The portal signs in and lands on a NEW session prefix.
mark = log.length;
await nav(driverA, 'https://signin.aws.amazon.com/federation?Action=login&SigninToken=SECRET456');
await nav(driverA, `https://${A}-cccc3333.us-east-1.console.aws.amazon.com/console/home?region=us-east-1`);
await settle();
const ev = sinceLast(mark);
assert.deepEqual(ev.filter((e) => e[0] === 'update').map((e) => [e[1], e[2]]).sort(), [
  [a1, `https://${A}-cccc3333.us-east-1.console.aws.amazon.com/ec2/home?region=us-east-1#Instances:instanceState=running`],
  [a2, `https://${A}-cccc3333.us-west-2.console.aws.amazon.com/lambda/home?region=us-west-2#/functions`],
].sort());
assert.ok(ev.some((e) => e[0] === 'remove' && e[1] === driverA), 'helper tab closed');
assert.ok(!ev.some((e) => e[1] === aGone), 'tab that left AWS untouched');
assert.ok(!log.some((e) => /\/v1\/logout$/.test(e[2] || '')), 'old session never signed out when a slot was free');
assert.ok(!store.local.sessions[`${A}-aaaa1111`], 'old session dropped');
assert.equal(store.local.sessions[`${A}-cccc3333`].exact, true);
assert.equal(alarms.get(`expire:${A}-cccc3333`), now + 58 * 60_000);
assert.ok(!alarms.has(`expire:${A}-aaaa1111`));
assert.ok(!JSON.stringify(store).includes('SigninToken'), 'sign-in tokens never stored');
assert.equal(groupOf(a1).title, '1111-1111-1111');
assert.equal(groups.size, 2, 'no extra groups after re-login');
assert.ok(!log.some((e) => e[0] === 'group' && e[1] === driverA), 'helper tab never grouped');

// 5. B is 2 minutes from expiry (68 min in) while the portal needs a fresh login (IdP page we can't see).
mark = log.length;
await advance(10 * 60_000);
const driverB = sinceLast(mark).find((e) => e[0] === 'create')[1];
await nav(driverB, 'https://accounts.google.com/signin');
timers.splice(0).forEach((fn) => fn()); // 12 s pass
await settle();
assert.ok(sinceLast(mark).some((e) => e[0] === 'activate' && e[1] === driverB), 'sign-in tab shown');
assert.equal(badge, '!');
// After login, sign-in passes through the plain console host with a one-time code, then
// lands on the SAME session code as before: the tab is reloaded and the clock restarts.
const signedInAt = now;
mark = log.length;
await nav(driverB, 'https://us-east-1.console.aws.amazon.com/console/home?ca-oauth-flow-id=5f07&isauthcode=true&code=ONETIME');
await nav(driverB, `https://${B}-bbbb2222.us-east-1.console.aws.amazon.com/console/home?region=us-east-1`);
await settle();
assert.equal(store.local.sessions[`${B}-bbbb2222`].start, signedInAt, 'clock restarted');
assert.equal((await message({ type: 'status' })).sessions.find((x) => x.acct === B).msLeft, 60 * 60_000);
assert.ok(!JSON.stringify(store).includes('ONETIME'), 'one-time sign-in code never stored');
assert.ok(sinceLast(mark).some((e) => e[0] === 'reload' && e[1] === b1), 'same-prefix tab reloaded');
assert.ok(sinceLast(mark).some((e) => e[0] === 'activate' && e[1] === b1), 'back to your tab');

// 6. A tab from a bookmark (no launch seen, role unknown) gets a role-less link, shown right away.
const c1 = tab(`https://${C}-dddd4444.eu-west-1.console.aws.amazon.com/rds/home?region=eu-west-1`);
await settle();
assert.equal(store.local.sessions[`${C}-dddd4444`].exact, false);
mark = log.length;
await message({ type: 'relogin', key: `${C}-dddd4444` });
await settle();
const [, driverC, urlC] = sinceLast(mark).find((e) => e[0] === 'create');
assert.equal(urlC, `${PORTAL}/#/console?account_id=${C}`);
assert.ok(sinceLast(mark).some((e) => e[0] === 'activate' && e[1] === driverC), 'role picker shown');
// All 5 slots taken: the helper signs C's old session out (in C's region), then once the
// sign-out redirects, signs in again.
const lastUpdate = (id) => sinceLast(mark).filter((e) => e[0] === 'update' && e[1] === id).at(-1)?.[2];
await nav(driverC, 'https://eu-west-1.signin.aws.amazon.com/sessions/selector?client_id=x');
assert.equal(lastUpdate(driverC), `https://eu-west-1.signin.aws.amazon.com/sessions/${C}-dddd4444/v1/logout`);
await settle();
await nav(driverC, 'https://eu-west-1.signin.aws.amazon.com/oauth?redirect_uri=x');
assert.equal(lastUpdate(driverC), urlC, 'signs in again after signing out');
// A plain console address in multi-session mode is not mistaken for a session.
await nav(driverC, 'https://us-east-1.console.aws.amazon.com/console/home?region=us-east-1');
assert.ok(!store.local.sessions.single, 'chooser not treated as a session');
assert.equal(store.session.job.driver, driverC, 'still waiting on the helper tab');
// You close the helper tab: it gives up on C cleanly.
await chrome.tabs.remove(driverC);
await settle();
assert.equal(store.session.job, null);

// 7. Re-login all queues each session and runs them one after another.
mark = log.length;
const st = await message({ type: 'reloginAll' });
assert.equal(st.sessions.filter((s) => s.state).length, 3);
let creates = sinceLast(mark).filter((e) => e[0] === 'create');
assert.equal(creates.length, 1, 'one at a time');
const [, driverAll, urlAll] = creates[0];
const job = store.session.job;
const activated = (id) => sinceLast(mark).some((e) => e[0] === 'activate' && e[1] === id);
// Slots full: sign out the old session first, not showing anything yet.
await nav(driverAll, 'https://us-east-2.signin.aws.amazon.com/sessions/selector?client_id=x');
assert.equal(lastUpdate(driverAll),
  `https://${job.targets[0].rest.split('.')[0]}.signin.aws.amazon.com/sessions/${job.key}/v1/logout`);
assert.ok(!activated(driverAll), 'not shown yet');
// The sign-out lands somewhere we can't see: it moves on 2 s after that page loads.
await settle();
await nav(driverAll, 'https://aws.amazon.com/');
await loaded(driverAll);
assert.notEqual(lastUpdate(driverAll), urlAll, 'waits a moment first');
await new Promise((r) => setTimeout(r, 2_100));
await settle();
assert.equal(lastUpdate(driverAll), urlAll);
// Still no free slot after signing out: now you're asked to pick.
await nav(driverAll, 'https://us-east-2.signin.aws.amazon.com/sessions/selector?client_id=y');
assert.ok(activated(driverAll), 'chooser shown when signing out did not free a slot');

// 8. Closing every tab of a session forgets it.
await chrome.tabs.remove(c1);
await settle();
assert.ok(!store.local.sessions[`${C}-dddd4444`]);

// 9. Names from the portal's account list rename the groups and show in the popup.
await message({ type: 'portalNames', names: { [A]: 'acme-prod', [B]: 'acme-staging', bogus: 'x' } });
assert.equal(groupOf(a1).title, 'acme-prod');
assert.equal(groupOf(b1).title, 'acme-staging');
assert.ok(!('bogus' in store.local.portalNames));
assert.equal((await message({ type: 'status' })).sessions.find((x) => x.acct === A).name, 'acme-prod');
// A name typed in Settings wins over the portal's.
await message({ type: 'saveSettings', settings: store.local.settings,
  accounts: { ...store.local.accounts, [A]: { name: 'Production', role: 'Admin' } } });
assert.equal(groupOf(a1).title, 'Production');
assert.equal(groupOf(b1).title, 'acme-staging');
const a3 = tab(`https://${A}-cccc3333.us-east-1.console.aws.amazon.com/iam/home`);
await settle();
assert.equal(groupOf(a3).id, groupOf(a1).id, 'new tab joins the renamed group');
console.log('All checks passed.');
process.exit(0);
