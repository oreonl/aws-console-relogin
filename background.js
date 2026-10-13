// AWS Console Re-login: background service worker.
//
// How it works: every console tab belongs to a session (the "123456789012-abcd1234"
// prefix in its hostname). Shortly before a session expires, it opens the access
// portal's shortcut link for that account in a background tab. Once that tab
// lands back in the console with a fresh session, every tab from the old session is
// sent to the same page on the new session, and the helper tab is closed.
//
// Privacy: it only looks at the URLs of AWS console, sign-in and access-portal tabs,
// and navigates those tabs. The one page it reads is the access portal's account list,
// and from that only account IDs and names (portal.js). It never reads cookies or
// credentials, and it never stores sign-in URLs.

import {
  parseConsole, isSignin, isSessionChooser, parsePortal, shortcutUrl, signoutUrl, formatAcct,
} from './lib.js';

const CONSOLE_URLS = ['https://*.console.aws.amazon.com/*'];
const DEFAULT_SETTINGS = { portalBase: '', durationMin: 60, auto: true, group: true };
const BEFORE_EXPIRY_MS = 2 * 60_000; // re-login early so tabs never hit the expired page
const NUDGE_MS = 12_000; // if the portal needs you (login, MFA), bring its tab to the front
const JOB_TIMEOUT_MIN = 10;

let state = null;
let chain = Promise.resolve();

async function load() {
  if (state) return state;
  const [local, sess] = await Promise.all([
    chrome.storage.local.get(['settings', 'accounts', 'portalNames', 'sessions']),
    chrome.storage.session.get(['tabs', 'launches', 'job', 'queue', 'lastError']),
  ]);
  state = {
    settings: { ...DEFAULT_SETTINGS, ...local.settings },
    accounts: local.accounts || {}, // acct -> { name, role }, as set in Settings
    portalNames: local.portalNames || {}, // acct -> name, as shown in the access portal
    sessions: local.sessions || {}, // prefix (or 'single') -> { acct, role, start, exact }
    tabs: sess.tabs || {}, // tabId -> { key, url }: the last console URL seen in that tab
    launches: sess.launches || {}, // tabId -> { acct, role, at }: tab is on its way from the portal
    job: sess.job || null, // the re-login in progress
    queue: sess.queue || [], // session keys waiting to re-login
    lastError: sess.lastError || null,
  };
  return state;
}

async function save() {
  const s = state;
  await Promise.all([
    chrome.storage.local.set({
      settings: s.settings, accounts: s.accounts, portalNames: s.portalNames, sessions: s.sessions,
    }),
    chrome.storage.session.set({
      tabs: s.tabs, launches: s.launches, job: s.job, queue: s.queue, lastError: s.lastError,
    }),
  ]);
}

// Run handlers one at a time so tab events don't race each other on state.
function run(fn) {
  const next = chain.then(async () => {
    const s = await load();
    try {
      return await fn(s);
    } finally {
      await save();
      updateBadge();
    }
  });
  chain = next.catch((err) => console.error('[aws-relogin]', err));
  return next;
}

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url) run((s) => onTabUrl(s, tabId, info.url));
  else if (info.status === 'complete' && state?.job?.phase === 'signout' && state.job.driver === tabId) {
    // The sign-out page finished without moving to a page we can see. Give it a moment
    // in case it signs out from script, then go on to sign in.
    setTimeout(() => run((s) => startSignin(s, tabId)), 2000);
  }
});
chrome.tabs.onRemoved.addListener((tabId) => run((s) => onTabRemoved(s, tabId)));
chrome.tabs.onReplaced.addListener((added, removed) => run((s) => {
  for (const map of [s.tabs, s.launches]) {
    if (map[removed]) {
      map[added] = map[removed];
      delete map[removed];
    }
  }
  if (s.job?.driver === removed) s.job.driver = added;
}));
chrome.alarms.onAlarm.addListener((alarm) => run((s) => onAlarm(s, alarm.name)));
chrome.runtime.onInstalled.addListener(() => run(rescan));
chrome.runtime.onStartup.addListener(() => run(rescan));
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  run((s) => onMessage(s, msg)).then(reply, (err) => reply({ error: String(err) }));
  return true;
});

async function onTabUrl(s, tabId, url) {
  if (s.job?.driver === tabId) {
    // Moved on from the sign-out link, so the old session is gone: sign in again.
    if (s.job.phase === 'signout') {
      if (!url.startsWith(s.job.signout)) await startSignin(s, tabId);
      return;
    }
    if (isSessionChooser(url)) {
      // All 5 session slots are taken. Sign the old session out to free one (its tabs
      // show a sign-in page until they're moved over), then try again. If that still
      // isn't enough, you need to pick.
      if (s.job.signout && !s.job.signedOut) return startSignout(s, tabId);
      return nudge(s, tabId);
    }
  }

  const portal = parsePortal(url);
  if (portal) {
    if (!s.settings.portalBase) s.settings.portalBase = portal.base;
    if (portal.acct) {
      // A console launch from the portal: remember when it started and with which role.
      s.launches[tabId] = { acct: portal.acct, role: portal.role, at: Date.now() };
      if (portal.role) (s.accounts[portal.acct] ??= {}).role = portal.role;
    }
    delete s.tabs[tabId];
    return;
  }

  const c = parseConsole(url);
  if (!c) return; // e.g. a sign-in page: keep the tab's last console URL so it can be restored
  // A stop on the way in from sign-in, carrying a one-time code: wait for the real page.
  if (new URL(url).searchParams.has('isauthcode')) return;

  const launch = s.launches[tabId];
  let key, acct;
  if (c.prefix) {
    [key, acct] = [c.prefix, c.acct];
    if (s.sessions.single) dropSession(s, 'single'); // multi-session is on
  } else if (Object.keys(s.sessions).some((k) => k !== 'single')) {
    return; // multi-session is on, so this is a stop on the way to its session chooser
  } else if (launch) {
    [key, acct] = ['single', launch.acct];
  } else if (s.sessions.single) {
    [key, acct] = ['single', s.sessions.single.acct];
  } else {
    return; // the multi-session chooser, or a session we never saw start
  }

  delete s.launches[tabId];
  if (launch?.acct === acct) {
    setSession(s, key, { acct, role: launch.role, start: launch.at, exact: true });
  } else if (!s.sessions[key]) {
    setSession(s, key, { acct, role: null, start: Date.now(), exact: false });
  }
  const prev = s.tabs[tabId];
  s.tabs[tabId] = { key, acct, url };

  if (s.job?.driver === tabId) return finishJob(s, key);
  // Only when a tab first shows this account, so moving a tab out of its group sticks.
  if (s.settings.group && prev?.acct !== acct) await groupTab(s, tabId, acct);
}

async function onTabRemoved(s, tabId) {
  const t = s.tabs[tabId];
  delete s.tabs[tabId];
  delete s.launches[tabId];
  if (s.job?.driver === tabId) {
    // You closed the sign-in tab, so skip this account.
    endJob(s);
    return startNext(s);
  }
  if (t && !hasTabs(s, t.key)) dropSession(s, t.key);
}

async function onAlarm(s, name) {
  if (name === 'job-timeout' && s.job) {
    s.lastError = 'Sign-in did not finish within 10 minutes.';
    const { driver } = s.job;
    endJob(s);
    s.queue = [];
    await chrome.tabs.remove(driver).catch(() => {});
    return;
  }
  if (!name.startsWith('expire:')) return; // 'tick' only refreshes the badge
  const key = name.slice('expire:'.length);
  const sess = s.sessions[key];
  if (sess && s.settings.auto && Date.now() >= expiresAt(s, sess) - BEFORE_EXPIRY_MS) await queueRelogin(s, key);
}

async function onMessage(s, msg) {
  switch (msg.type) {
    case 'status':
      return status(s);
    case 'relogin':
      s.lastError = null;
      await queueRelogin(s, msg.key);
      return status(s);
    case 'reloginAll':
      s.lastError = null;
      for (const key of Object.keys(s.sessions)) if (hasTabs(s, key)) await queueRelogin(s, key);
      return status(s);
    case 'getSettings':
      return { settings: s.settings, accounts: s.accounts, portalNames: s.portalNames };
    case 'portalNames': {
      const accts = Object.keys(msg.names || {}).filter((a) => /^\d{12}$/.test(a));
      const oldTitles = Object.fromEntries(accts.map((a) => [a, groupTitle(s, a)]));
      for (const acct of accts) {
        const name = String(msg.names[acct]).trim().slice(0, 50);
        if (name) s.portalNames[acct] = name;
      }
      await renameGroups(s, oldTitles);
      return { ok: true };
    }
    case 'saveSettings': {
      const wasGrouping = s.settings.group;
      const accts = Object.keys({ ...s.accounts, ...msg.accounts });
      const oldTitles = Object.fromEntries(accts.map((a) => [a, groupTitle(s, a)]));
      s.settings = { ...DEFAULT_SETTINGS, ...msg.settings };
      s.accounts = msg.accounts;
      for (const [key, sess] of Object.entries(s.sessions)) setSession(s, key, sess);
      await renameGroups(s, oldTitles);
      if (s.settings.group && !wasGrouping) {
        for (const [id, t] of Object.entries(s.tabs)) await groupTab(s, Number(id), t.acct);
      }
      return { ok: true };
    }
  }
}

// One tab group per account in each window, found by its title so Chrome's own
// restored groups are reused after a restart. Colors are only set when a group is
// created, so a color you pick yourself stays.
async function groupTab(s, tabId, acct) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const title = groupTitle(s, acct);
    const [group] = await chrome.tabGroups.query({ windowId: tab.windowId, title });
    if (group && group.id === tab.groupId) return;
    if (group) {
      await chrome.tabs.group({ tabIds: tabId, groupId: group.id });
    } else {
      const groupId = await chrome.tabs.group({ tabIds: tabId, createProperties: { windowId: tab.windowId } });
      await chrome.tabGroups.update(groupId, { title, color: groupColor(acct) });
    }
  } catch (err) {
    console.warn('[aws-relogin] could not group tab', err); // e.g. tabs in popup windows
  }
}

async function renameGroups(s, oldTitles) {
  for (const [acct, oldTitle] of Object.entries(oldTitles)) {
    const title = groupTitle(s, acct);
    if (title === oldTitle) continue;
    for (const g of await chrome.tabGroups.query({ title: oldTitle })) await chrome.tabGroups.update(g.id, { title });
  }
}

const GROUP_COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange', 'grey'];
const accountName = (s, acct) => s.accounts[acct]?.name || s.portalNames[acct] || '';
const groupTitle = (s, acct) => accountName(s, acct) || formatAcct(acct);
const groupColor = (acct) => GROUP_COLORS[Number(BigInt(acct) % BigInt(GROUP_COLORS.length))];

async function queueRelogin(s, key) {
  if (s.job?.key === key || s.queue.includes(key)) return;
  s.queue.push(key);
  await startNext(s);
}

async function startNext(s) {
  while (!s.job && s.queue.length) {
    const key = s.queue.shift();
    const sess = s.sessions[key];
    if (!sess) continue;
    const targets = await collectTargets(s, key);
    if (!targets.length) {
      dropSession(s, key);
      continue;
    }
    if (!s.settings.portalBase) {
      s.queue = [];
      s.lastError = 'Set your AWS access portal URL in Settings.';
      chrome.runtime.openOptionsPage();
      return;
    }
    const role = sess.role || s.accounts[sess.acct]?.role;
    const signin = shortcutUrl(s.settings.portalBase, sess.acct, role);
    // Sign in without signing out first. AWS ends the old session itself the moment the
    // same account and role signs in, but until then (e.g. while you log in to the portal
    // again) its tabs keep working. Signing out is only the fallback when all 5 slots are
    // taken. Without multi-session there are no slots and nothing to sign out.
    const signout = key === 'single' ? null : signoutUrl(key, targets[0].rest);
    const driver = await chrome.tabs.create({
      url: signin,
      active: false,
      windowId: targets[0].windowId,
      index: targets[0].index + 1,
    });
    s.job = {
      key, acct: sess.acct, role, driver: driver.id, targets, signin, signout,
      phase: 'signin', signedOut: false, signinAt: Date.now(), shown: false,
    };
    chrome.alarms.create('job-timeout', { delayInMinutes: JOB_TIMEOUT_MIN });
    setTimeout(() => run((s) => nudge(s, driver.id)), NUDGE_MS);
    // Without a role the portal asks you to pick one, so show that tab right away.
    if (!role) await nudge(s, driver.id);
  }
}

async function startSignout(s, driverId) {
  const job = s.job;
  job.phase = 'signout';
  job.signedOut = true;
  await chrome.tabs.update(driverId, { url: job.signout });
}

async function startSignin(s, driverId) {
  const job = s.job;
  if (job?.driver !== driverId || job.phase !== 'signout') return;
  job.phase = 'signin';
  job.signinAt = Date.now();
  await chrome.tabs.update(driverId, { url: job.signin });
}

async function nudge(s, driverId) {
  if (s.job?.driver !== driverId || s.job.shown) return;
  s.job.shown = true;
  await chrome.tabs.update(driverId, { active: true }).catch(() => {});
}

// The helper tab reached the console: move every tab of the old session onto the new one.
async function finishJob(s, newKey) {
  const job = s.job;
  endJob(s);
  const sess = s.sessions[newKey];
  if (sess?.acct !== job.acct) {
    s.lastError = 'The portal signed in to a different account than expected.';
    return startNext(s);
  }
  // A fresh sign-in restarts the clock, even when AWS reuses the session's code.
  setSession(s, newKey, { ...sess, role: sess.role || job.role, start: job.signinAt, exact: true });
  delete s.tabs[job.driver];
  const host = newKey === 'single' ? '' : `${newKey}.`;
  for (const t of job.targets) {
    const tab = await chrome.tabs.get(t.tabId).catch(() => null);
    if (!tab) continue;
    const url = `https://${host}${t.rest}${t.path}`;
    s.tabs[t.tabId] = { key: newKey, acct: job.acct, url };
    if (tab.url === url) await chrome.tabs.reload(t.tabId);
    else await chrome.tabs.update(t.tabId, { url });
  }
  if (job.key !== newKey) dropSession(s, job.key);
  await chrome.tabs.remove(job.driver).catch(() => {});
  if (job.shown) await chrome.tabs.update(job.targets[0].tabId, { active: true }).catch(() => {});
  s.lastError = null;
  await startNext(s);
}

async function collectTargets(s, key) {
  const targets = [];
  for (const [id, t] of Object.entries(s.tabs)) {
    if (t.key !== key) continue;
    const tab = await chrome.tabs.get(Number(id)).catch(() => null);
    // Forget tabs that have since moved to another site.
    if (!tab?.url || !(parseConsole(tab.url) || isSignin(tab.url))) {
      delete s.tabs[id];
      continue;
    }
    const { rest, path } = parseConsole(t.url);
    targets.push({ tabId: Number(id), rest, path, windowId: tab.windowId, index: tab.index });
  }
  return targets;
}

async function rescan(s) {
  s.tabs = {};
  s.launches = {};
  s.queue = [];
  endJob(s);
  for (const tab of await chrome.tabs.query({ url: CONSOLE_URLS })) await onTabUrl(s, tab.id, tab.url);
  for (const key of Object.keys(s.sessions)) {
    // Chrome can drop alarms across restarts, so set them again.
    if (hasTabs(s, key)) setSession(s, key, s.sessions[key]);
    else dropSession(s, key);
  }
  chrome.alarms.create('tick', { periodInMinutes: 1 });
}

function setSession(s, key, sess) {
  s.sessions[key] = sess;
  chrome.alarms.create(`expire:${key}`, { when: expiresAt(s, sess) - BEFORE_EXPIRY_MS });
}

function dropSession(s, key) {
  delete s.sessions[key];
  chrome.alarms.clear(`expire:${key}`);
}

function endJob(s) {
  s.job = null;
  chrome.alarms.clear('job-timeout');
}

const expiresAt = (s, sess) => sess.start + s.settings.durationMin * 60_000;
const hasTabs = (s, key) => Object.values(s.tabs).some((t) => t.key === key);

function status(s) {
  const now = Date.now();
  const sessions = Object.entries(s.sessions)
    .map(([key, sess]) => ({
      key,
      acct: sess.acct,
      name: accountName(s, sess.acct),
      role: sess.role || s.accounts[sess.acct]?.role || '',
      tabs: Object.values(s.tabs).filter((t) => t.key === key).length,
      msLeft: expiresAt(s, sess) - now,
      exact: sess.exact,
      state: s.job?.key === key ? (s.job.shown ? 'waiting' : 'signing-in') : s.queue.includes(key) ? 'queued' : '',
    }))
    .filter((x) => x.tabs > 0)
    .sort((a, b) => a.msLeft - b.msLeft);
  return { sessions, portalBase: s.settings.portalBase, auto: s.settings.auto, lastError: s.lastError };
}

function updateBadge() {
  const s = state;
  let text = '';
  let color = '#1f883d';
  if (s.job) {
    text = s.job.shown ? '!' : '…';
    color = '#bf8700';
  } else if (s.lastError) {
    text = '!';
    color = '#cf222e';
  } else {
    const left = Math.min(
      ...Object.entries(s.sessions)
        .filter(([key]) => hasTabs(s, key))
        .map(([, sess]) => expiresAt(s, sess) - Date.now()),
    );
    if (Number.isFinite(left)) {
      const min = Math.ceil(left / 60_000);
      text = min <= 0 ? '0m' : min < 60 ? `${min}m` : `${Math.floor(min / 60)}h`;
      if (min <= 5) color = '#bf8700';
    }
  }
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}
