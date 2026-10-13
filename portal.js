// Runs on the AWS access portal. Finds each account ID in the account list and the
// name shown next to it, and sends only those pairs to the extension for tab group names.
(() => {
  // An ID on its own: "123456789012", "#123456789012", "1234-5678-9012",
  // "123456789012 | ops@example.com". Not inside an email like "aws+123456789012@example.com".
  const ID = /(?:^|[\s#:(])(\d{4}-?\d{4}-?\d{4})(?=$|[\s|,)])/;
  const idOf = (text) => text.match(ID)?.[1].replace(/-/g, '');
  const LABEL = /^(account( id| name)?|email|id)$/i;

  function textNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.parentElement?.closest('script, style, [aria-hidden="true"]')) nodes.push(n);
    }
    return nodes;
  }

  const idsIn = (root) => new Set(textNodes(root).map((n) => idOf(n.data)).filter(Boolean));

  function isName(text) {
    const t = text.trim();
    return t.length > 0 && t.length <= 50 && /[a-z0-9]/i.test(t)
      && !t.includes('@') && !ID.test(t) && !t.endsWith(':') && !LABEL.test(t);
  }

  const firstName = (root) => textNodes(root).find((n) => isName(n.data))?.data.trim() ?? null;

  // From each ID, look outward for the nearest text that reads like a name, without
  // going so far that the container holds another account too.
  function scan() {
    const names = {};
    for (const n of textNodes(document.body)) {
      const id = idOf(n.data);
      if (!id || names[id]) continue;
      let el = n.parentElement;
      for (let depth = 0; el && el !== document.body && depth < 6; depth++, el = el.parentElement) {
        if (idsIn(el).size > 1) break;
        const name = firstName(el);
        if (name) {
          names[id] = name;
          break;
        }
      }
    }
    return names;
  }

  let sent = '';
  let timer;
  function report() {
    const names = scan();
    const json = JSON.stringify(names);
    if (json === sent || json === '{}') return;
    sent = json;
    chrome.runtime.sendMessage({ type: 'portalNames', names }).catch(() => {});
  }

  // The portal renders its account list after loading, so watch for changes.
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(report, 500);
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  report();
})();
