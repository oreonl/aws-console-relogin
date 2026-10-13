import { parsePortal } from './lib.js';

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);

function input(value, placeholder) {
  return Object.assign(document.createElement('input'), { type: 'text', value: value || '', placeholder });
}

function addRow(acct = '', { name, role } = {}) {
  const tr = document.createElement('tr');
  const remove = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Remove' });
  remove.addEventListener('click', () => tr.remove());
  const nameInput = input(name, portalNames[acct] || 'Production');
  for (const node of [input(acct, '123456789012'), nameInput, input(role, 'AdministratorAccess'), remove]) {
    const td = document.createElement('td');
    td.append(node);
    tr.append(td);
  }
  $('accounts').append(tr);
}

const { settings, accounts, portalNames } = await send({ type: 'getSettings' });
$('portal').value = settings.portalBase;
$('duration').value = settings.durationMin;
$('auto').checked = settings.auto;
$('group').checked = settings.group;
for (const [acct, info] of Object.entries(accounts)) addRow(acct, info);

$('add').addEventListener('click', () => addRow());

$('save').addEventListener('click', async () => {
  const saved = $('saved');
  const raw = $('portal').value.trim();
  const portal = raw ? parsePortal(raw) : null;
  if (raw && !portal) {
    saved.textContent = 'That doesn\'t look like an access portal URL (…awsapps.com/start or …portal.<region>.app.aws).';
    return;
  }
  const next = {};
  for (const tr of $('accounts').rows) {
    const [acct, name, role] = [...tr.querySelectorAll('input')].map((i) => i.value.trim());
    const id = acct.replace(/\D/g, '');
    if (!id) continue;
    if (id.length !== 12) {
      saved.textContent = `"${acct}" isn't a 12-digit account ID.`;
      return;
    }
    next[id] = { name, role };
  }
  const durationMin = Math.min(720, Math.max(5, Math.round(Number($('duration').value) || 60)));
  await send({
    type: 'saveSettings',
    settings: { portalBase: portal ? portal.base : '', durationMin, auto: $('auto').checked, group: $('group').checked },
    accounts: next,
  });
  $('portal').value = portal ? portal.base : '';
  $('duration').value = durationMin;
  saved.textContent = 'Saved.';
});
