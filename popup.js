import { formatAcct } from './lib.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

$('settings').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});
$('all').addEventListener('click', async () => render(await send({ type: 'reloginAll' })));

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function timeLeft(row) {
  if (row.state === 'signing-in') return ['Signing in…', ''];
  if (row.state === 'waiting') return ['Needs you in the sign-in tab', 'soon'];
  if (row.state === 'queued') return ['Queued', ''];
  const min = Math.ceil(row.msLeft / 60_000);
  if (min <= 0) return ['Expired', 'gone'];
  const approx = row.exact ? '' : '~';
  const text = min < 60 ? `${approx}${min} min left` : `${approx}${Math.floor(min / 60)} h ${min % 60} min left`;
  return [text, min <= 5 ? 'soon' : ''];
}

function render(status) {
  const notice = $('notice');
  const message = status.lastError
    || (!status.portalBase && 'Open your AWS access portal once, or set its URL in Settings, so this knows where to sign in.');
  notice.hidden = !message;
  notice.textContent = message || '';

  const list = $('list');
  list.replaceChildren();
  if (!status.sessions.length) list.append(el('li', { className: 'empty', textContent: 'No AWS console tabs open.' }));
  for (const row of status.sessions) {
    const [text, cls] = timeLeft(row);
    const button = el('button', { textContent: 'Re-login', disabled: !!row.state });
    button.addEventListener('click', async () => render(await send({ type: 'relogin', key: row.key })));
    const tabs = `${row.tabs} tab${row.tabs === 1 ? '' : 's'}`;
    list.append(el('li', {},
      el('div', { className: 'info' },
        el('div', { className: 'name', textContent: row.name || formatAcct(row.acct), title: row.acct }),
        el('div', { className: 'meta', textContent: [row.role, tabs].filter(Boolean).join(' · ') }),
      ),
      el('span', { className: `left ${cls}`, textContent: text }),
      button,
    ));
  }
  $('all').hidden = status.sessions.length < 2;
  $('auto').textContent = status.auto ? 'Auto re-login is on' : 'Auto re-login is off';
}

render(await send({ type: 'status' }));
setInterval(async () => render(await send({ type: 'status' })), 2000);
