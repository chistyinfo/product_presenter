// Headless Edge (CDP) harness: reproduce "Remove from this background".
// No deps: uses Node 22 global WebSocket. Usage: node tools/remove_test.js [button|icon]
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9333;
const PAGE = 'http://localhost/product_presenter/index.html';
const scenario = process.argv[2] || 'button';
const profile = path.join(__dirname, '..', '.edge-prof-' + Date.now());

const sleep = ms => new Promise(r => setTimeout(r, ms));

function get(pathname) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: pathname }, r => {
      let b = '';
      r.on('data', c => (b += c));
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { res(b); } });
    }).on('error', rej);
  });
}

async function until(fn, ms, label) {
  const t0 = Date.now();
  for (;;) {
    let v = false;
    try { v = await fn(); } catch (e) {}
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timeout: ' + label);
    await sleep(200);
  }
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.waiters = new Map(); this.events = [];
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.waiters.has(m.id)) {
        const w = this.waiters.get(m.id); this.waiters.delete(m.id);
        m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result);
      } else if (m.method) { this.events.push(m); }
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.waiters.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  async ev(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error('PAGE EXCEPTION: ' + (d.exception && d.exception.description || d.text));
    }
    return r.result.value;
  }
}

(async () => {
  fs.mkdirSync(profile, { recursive: true });
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });

  await until(async () => { try { await get('/json/version'); return true; } catch (e) { return false; } }, 30000, 'devtools');

  const list = await get('/json/list');
  const target = list.find(t => t.type === 'page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const cdp = new CDP(ws);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  // Accept native dialogs (window.confirm) so the run is unattended.
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Page.javascriptDialogOpening') {
      cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    }
  });

  await cdp.send('Page.navigate', { url: PAGE });
  await until(() => cdp.events.some(e => e.method === 'Page.loadEventFired'), 30000, 'load');
  await until(() => cdp.ev('!!document.querySelector("#product-assignment .assign-row")'), 30000, 'rows');

  const errs = () => cdp.events.filter(e => e.method === 'Runtime.exceptionThrown' ||
      (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') ||
      (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'))
    .map(e => e.method === 'Runtime.exceptionThrown'
      ? 'EXCEPTION ' + ((e.params.exceptionDetails.exception || {}).description || e.params.exceptionDetails.text)
      : e.method === 'Runtime.consoleAPICalled'
        ? 'CONSOLE.ERROR ' + e.params.args.map(a => a.value || a.description).join(' ')
        : 'LOG.ERROR ' + e.params.entry.text);

  const snap = () => cdp.ev(`(() => {
    const rows = [].slice.call(document.querySelectorAll('#product-assignment .assign-row'));
    const sel = document.querySelector('#product-assignment .assign-row.is-selected');
    const rm = document.getElementById('remove-from-background-btn');
    return JSON.stringify({
      heading: document.getElementById('products-heading').textContent,
      rows: rows.map(r => ({ id: r.dataset.productId,
        txt: r.textContent.replace(/\\s+/g, ' ').trim(),
        chk: !!(r.querySelector('input[type=checkbox]') || {}).checked,
        unlink: !!r.querySelector('.assign-remove') })),
      selected: sel ? sel.dataset.productId : null,
      hint: document.getElementById('editor-selection-hint').textContent,
      rmDisabled: rm.disabled,
      boxes: [].slice.call(document.querySelectorAll('#pv-host .pv-product-box')).map(b => b.dataset.productId),
      X: document.getElementById('marking-left').value,
      W: document.getElementById('marking-width').value,
      toast: (document.getElementById('pv-toast') || {}).textContent || ''
    });
  })()`);

  console.log('SCENARIO ' + scenario);
  console.log('LOAD ERRORS ' + JSON.stringify(errs()));
  console.log('BEFORE ' + await snap());

  // Ensure product 50 is assigned to the current background, then select it.
  console.log('PREP ' + await cdp.ev(`(() => {
    const row = document.querySelector('#product-assignment .assign-row[data-product-id="50"]');
    if (!row) return 'no-row';
    const cb = row.querySelector('input[type=checkbox]');
    if (!cb.checked) { cb.click(); return 'ticked'; }
    row.click(); return 'selected';
  })()`));
  await sleep(1800);
  console.log('AFTER PREP ' + await snap());

  if (scenario === 'icon') {
    console.log('CLICK ' + await cdp.ev(`(() => {
      const row = document.querySelector('#product-assignment .assign-row[data-product-id="50"]');
      const rm = row && row.querySelector('.assign-remove');
      if (!rm) return 'no-unlink';
      rm.click(); return 'icon-clicked';
    })()`));
  } else {
    console.log('CLICK ' + await cdp.ev(`(() => {
      const b = document.getElementById('remove-from-background-btn');
      if (b.disabled) return 'disabled';
      b.click(); return 'button-clicked';
    })()`));
  }

  await sleep(9000);
  console.log('AFTER REMOVE ' + await snap());
  console.log('END ERRORS ' + JSON.stringify(errs()));
  console.log('NET FAILS ' + JSON.stringify(cdp.events.filter(e => e.method === 'Network.loadingFailed').map(e => e.params.errorText)));
  console.log('NET REQS ' + JSON.stringify(cdp.events.filter(e => e.method === 'Network.requestWillBeSent' && /api\/v1/.test(e.params.request.url)).map(e => e.params.request.method + ' ' + e.params.request.url.replace('http://localhost/product_presenter/', ''))));

  ws.close(); edge.kill();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})().catch(e => { console.error('HARNESS FAILED: ' + e.message); process.exit(1); });
