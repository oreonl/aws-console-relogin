// URL helpers shared by the service worker, popup and options page.

// Console tabs look like one of:
//   https://123456789012-abcd1234.us-east-1.console.aws.amazon.com/ec2/home?...  (multi-session on)
//   https://us-east-1.console.aws.amazon.com/ec2/home?...                        (multi-session off)
// The "123456789012-abcd1234" prefix identifies one signed-in session.
export function parseConsole(url) {
  const u = toURL(url);
  if (!u) return null;
  const m = u.hostname.match(/^(?:(\d{12})-([a-z0-9]+)\.)?((?:[a-z0-9-]+\.)?console\.aws\.amazon\.com)$/i);
  if (!m) return null;
  return {
    acct: m[1] || null,
    prefix: m[1] ? `${m[1]}-${m[2]}`.toLowerCase() : null,
    rest: m[3].toLowerCase(),
    path: u.pathname + u.search + u.hash,
  };
}

export function isSignin(url) {
  const u = toURL(url);
  return !!u && /(^|\.)signin\.aws\.amazon\.com$/i.test(u.hostname);
}

// "Choose your AWS session", e.g. when all 5 multi-session slots are taken:
//   https://us-east-2.signin.aws.amazon.com/sessions/selector?...
export function isSessionChooser(url) {
  return isSignin(url) && new URL(url).pathname.startsWith('/sessions/selector');
}

// Signs out one multi-session session, the same link as the console's own "Sign out":
//   https://us-east-2.signin.aws.amazon.com/sessions/123456789012-abcd1234/v1/logout
export function signoutUrl(prefix, rest) {
  const region = rest.match(/^([a-z0-9-]+)\.console\.aws\.amazon\.com$/)?.[1] || 'us-east-1';
  return `https://${region}.signin.aws.amazon.com/sessions/${prefix}/v1/logout`;
}

// The IAM Identity Center access portal:
//   https://d-1234567890.awsapps.com/start/#/...
//   https://ssoins-1234567890abcdef.portal.us-east-1.app.aws/#/...
// Console launch links add  #/console?account_id=...&role_name=...
export function parsePortal(url) {
  const u = toURL(url);
  if (!u) return null;
  let base;
  if (/\.awsapps\.com$/i.test(u.hostname) && u.pathname.startsWith('/start')) base = `${u.origin}/start`;
  else if (/\.portal\.[a-z0-9-]+\.app\.aws$/i.test(u.hostname)) base = u.origin;
  else return null;
  const q = u.hash.match(/^#\/console\?(.*)$/);
  const params = new URLSearchParams(q ? q[1] : '');
  const acct = params.get('account_id');
  return {
    base,
    acct: /^\d{12}$/.test(acct || '') ? acct : null,
    role: params.get('role_name') || null,
  };
}

export function shortcutUrl(portalBase, acct, role) {
  const params = new URLSearchParams({ account_id: acct });
  if (role) params.set('role_name', role);
  return `${portalBase}/#/console?${params}`;
}

export function formatAcct(acct) {
  return acct.replace(/^(\d{4})(\d{4})(\d{4})$/, '$1-$2-$3');
}

function toURL(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}
