// Edge cases for "Remove from this background".
// Usage: node tools/remove_test2.js [double|uncheck|single|unsaved|readd]
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9334;
const PAGE = 'http://localhost/product_presenter/index.html';
const scenario = process.argv[2] || 'double';
const PID = process.argv[3] || '50';
const BG = process.argv[4] || '';
const WAIT = 8000;
const profile = path.join(__dirname, '..', '.edge-prof2-' + Date.now());
const sleep = ms => new Promise(r => setTimeout(r, ms));

function get(p) {
  return new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, r => {
      let b = ''; r.on('data', c => (b += c));
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { res(b); } });
    }).on('error', rej);
  });
}
async function until(fn, ms, label) {
  const t0 = Date.now();
  for (;;) {
    let v = false; try { v = await fn(); } catch (e) {}
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timeout: ' + label);
    await sleep(200);
  }
}
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.w = new Map(); this.events = [];
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.w.has(m.id)) { const x = this.w.get(m.id); this.w.delete(m.id); m.error ? x.rej(new Error(JSON.stringify(m.error))) : x.res(m.result); }
      else if (m.method) this.events.push(m);
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => { this.w.set(id, { res, rej }); this.ws.send(JSON.stringify({ id, method, params: params || {} })); });
  }
  async ev(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('PAGE EXCEPTION: ' + ((r.exceptionDetails.exception || {}).description || r.exceptionDetails.text));
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
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Log.enable'); await cdp.send('Network.enable');
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Page.javascriptDialogOpening') cdp.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
  });
  await cdp.send('Page.navigate', { url: PAGE });
  await until(() => cdp.events.some(e => e.method === 'Page.loadEventFired'), 30000, 'load');
  await until(() => cdp.ev('!!document.querySelector("#product-assignment .assign-row")'), 30000, 'rows');

  const errs = () => cdp.events.filter(e => e.method === 'Runtime.exceptionThrown' ||
      (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') ||
      (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'))
    .map(e => e.method === 'Runtime.exceptionThrown'
      ? 'EXC ' + ((e.params.exceptionDetails.exception || {}).description || e.params.exceptionDetails.text)
      : e.method === 'Runtime.consoleAPICalled'
        ? 'CONSOLE ' + e.params.args.map(a => a.value || a.description).join(' ')
        : 'LOG ' + e.params.entry.text);

  const snap = () => cdp.ev(`(() => {
    const row = document.querySelector('#product-assignment .assign-row[data-product-id="${PID}"]');
    const rm = document.getElementById('remove-from-background-btn');
    return JSON.stringify({
      rowTxt: row ? row.textContent.replace(/\\s+/g,' ').trim() : null,
      chk: row ? !!row.querySelector('input[type=checkbox]').checked : null,
      unlink: row ? !!row.querySelector('.assign-remove') : null,
      selected: (document.querySelector('#product-assignment .assign-row.is-selected') || {}).dataset
        ? document.querySelector('#product-assignment .assign-row.is-selected').dataset.productId : null,
      hint: document.getElementById('editor-selection-hint').textContent,
      rmDisabled: rm.disabled,
      saveDisabled: document.getElementById('save-marking-btn').disabled,
      addDetailDisabled: document.getElementById('add-product-detail-btn').disabled,
      fields: ['marking-left','marking-top','marking-width','marking-height','marking-padding']
        .map(id => document.getElementById(id).value).join(','),
      dims: document.getElementById('marking-dimensions').textContent,
      boxes: [].slice.call(document.querySelectorAll('#pv-host .pv-product-box')).map(b => b.dataset.productId),
      toast: (document.getElementById('pv-toast') || {}).textContent || ''
    });
  })()`);

  await sleep(600);

  // Optionally switch to a specific background first.
  if (BG) {
    console.log('SELECT BG ' + await cdp.ev(`(() => {
      const t = document.querySelector('.background-thumbnail[data-bg-id="${BG}"]');
      if (!t) return 'no-thumb';
      t.click(); return 'clicked';
    })()`));
    await sleep(3000);
  }

  console.log('SCENARIO ' + scenario + ' product ' + PID + (BG ? ' bg ' + BG : ''));
  console.log('BEFORE ' + await snap());

  // Make sure the product is assigned to this background and selected.
  console.log('PREP ' + await cdp.ev(`(() => {
    const row = document.querySelector('#product-assignment .assign-row[data-product-id="${PID}"]');
    if (!row) return 'no-row';
    const cb = row.querySelector('input[type=checkbox]');
    if (!cb.checked) { cb.click(); return 'ticked'; }
    row.click(); return 'selected';
  })()`));
  // Wait until the async assign/select has settled and the button is enabled.
  await until(() => cdp.ev('(() => { const b = document.getElementById("remove-from-background-btn"); return !b.disabled; })()'), 15000, 'remove enabled');
  await sleep(400);
  console.log('AFTER PREP ' + await snap());

  if (scenario === 'double') {
    console.log('CLICK ' + await cdp.ev(`(() => {
      const b = document.getElementById('remove-from-background-btn');
      if (b.disabled) return 'disabled';
      b.click(); b.click(); b.click();
      return 'triple-clicked';
    })()`));
  } else if (scenario === 'uncheck') {
    console.log('CLICK ' + await cdp.ev(`(() => {
      const row = document.querySelector('#product-assignment .assign-row[data-product-id="${PID}"]');
      const cb = row.querySelector('input[type=checkbox]');
      cb.click(); return 'unchecked';
    })()`));
  } else if (scenario === 'unsaved') {
    // Simulate unsaved edits (drag/resize change state only) then remove.
    console.log('EDIT ' + await cdp.ev(`(() => {
      const i = document.getElementById('marking-left');
      i.value = '10'; i.dispatchEvent(new Event('input', { bubbles: true }));
      return 'edited';
    })()`));
    await sleep(300);
    console.log('AFTER EDIT ' + await snap());
    console.log('CLICK ' + await cdp.ev(`(() => {
      const b = document.getElementById('remove-from-background-btn');
      if (b.disabled) return 'disabled';
      b.click(); return 'clicked';
    })()`));
  } else if (scenario === 'readd') {
    console.log('CLICK ' + await cdp.ev(`(() => {
      const b = document.getElementById('remove-from-background-btn');
      if (b.disabled) return 'disabled';
      b.click(); return 'removed';
    })()`));
    await sleep(WAIT);
    console.log('AFTER REMOVE ' + await snap());
    console.log('READD ' + await cdp.ev(`(() => {
      const row = document.querySelector('#product-assignment .assign-row[data-product-id="${PID}"]');
      const cb = row.querySelector('input[type=checkbox]');
      cb.click(); return 're-ticked';
    })()`));
    await sleep(WAIT);
    console.log('AFTER READD ' + await snap());
    console.log('END ERRORS ' + JSON.stringify(errs()));
    console.log('NET ' + JSON.stringify(cdp.events.filter(e => e.method === 'Network.requestWillBeSent' && /api\/v1\/(backgrounds\/\d+\/products|products)/.test(e.params.request.url)).map(e => e.params.request.method + ' ' + e.params.request.url.replace('http://localhost/product_presenter/api/v1/', '').split('?')[0])));
    ws.close(); edge.kill(); await sleep(400);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
    process.exit(0);
  }

  await sleep(WAIT);
  console.log('AFTER ' + await snap());
  console.log('END ERRORS ' + JSON.stringify(errs()));
  console.log('RESPONSES ' + JSON.stringify(cdp.events.filter(e => e.method === 'Network.responseReceived' && /api\/v1/.test(e.params.response.url)).map(e => e.params.response.status + ' ' + e.params.response.url.replace('http://localhost/product_presenter/api/v1/', '').split('?')[0])));
  console.log('NET ' + JSON.stringify(cdp.events.filter(e => e.method === 'Network.requestWillBeSent' && /api\/v1\/(backgrounds\/\d+\/products|products)/.test(e.params.request.url)).map(e => e.params.request.method + ' ' + e.params.request.url.replace('http://localhost/product_presenter/api/v1/', '').split('?')[0])));

  ws.close(); edge.kill(); await sleep(400);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})().catch(e => { console.error('HARNESS FAILED: ' + e.message); process.exit(1); });
