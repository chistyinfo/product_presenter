// Probe product_viz.html in headless Edge and print every JS error + key DOM state.
// Usage: node tools/viz_probe.js [id]
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9337;
const ID = process.argv[2] || '2';
const WITH_BG = process.argv.indexOf('--bg') !== -1;
const BROKEN = process.argv.indexOf('--broken') !== -1;
const PAGE = 'http://localhost/product_presenter/product_viz.html?id=' + ID;
const WAIT = 6000;
const profile = path.join(__dirname, '..', '.edge-probe-' + Date.now());
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
  await cdp.send('Page.navigate', { url: PAGE });
  await until(() => cdp.events.some(e => e.method === 'Page.loadEventFired'), 30000, 'load');
  await sleep(WAIT);

  // --bg: hand the live viewer a placement on the real blue-wall image and
  // re-render. Exercises the background path (renderScene + fitStageToHost)
  // without inserting rows into the database.
  if (WITH_BG) {
    console.log('INJECT ' + await cdp.ev(`(() => {
      const v = window.pvViewer;
      if (!v) return 'no-viewer';
      const broken = ${BROKEN ? 'true' : 'false'};
      v.placements = [{
        background_id: 2,
        background_name: 'blue-wall',
        background_image_url: broken
          ? 'http://localhost/product_presenter/uploads/backgrounds/does-not-exist.png'
          : 'http://localhost/product_presenter/uploads/backgrounds/adc48a4a5a0b976f.png',
        background_width: 1920,
        background_height: 1080,
        placement: { x: 30, y: 10, w: 30, h: 80, padding: 0, z_index: 0 }
      }];
      if (broken && v.productData) {
        v.productData.image_url = 'http://localhost/product_presenter/uploads/products/does-not-exist.png';
      }
      v.currentBgId = 2;
      v.currentRoomName = 'blue-wall';
      v.renderRoom();
      return 'injected';
    })()`));
    await sleep(4000);
    console.log('BG ' + await cdp.ev(`(() => {
      const stage = document.querySelector('#pv-stage-host .pv-stage');
      const bg = document.querySelector('#pv-stage-host .pv-stage-bg');
      const box = document.querySelector('#pv-stage-host .pv-product-box');
      const img = document.querySelector('#pv-stage-host .pv-product-img');
      const r = stage ? stage.getBoundingClientRect() : null;
      const b = box ? box.getBoundingClientRect() : null;
      return JSON.stringify({
        stage: r ? Math.round(r.width) + 'x' + Math.round(r.height) + '@' + Math.round(r.left) + ',' + Math.round(r.top) : null,
        bgLoaded: bg ? (bg.complete && bg.naturalWidth + 'x' + bg.naturalHeight) : 'no-bg-img',
        box: b ? Math.round(b.left) + ',' + Math.round(b.top) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height) : null,
        imgLoaded: img ? (img.complete ? img.naturalWidth : 'pending') : null
      });
    })()`));
    console.log('UI ' + await cdp.ev(`(() => {
      const out = [];
      const info = document.getElementById('product-info');
      document.getElementById('info-toggle').click();
      out.push('infoHidden=' + info.classList.contains('hidden'));
      document.getElementById('info-toggle').click();
      out.push('infoBack=' + !info.classList.contains('hidden'));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }));
      out.push('keyI=' + info.classList.contains('hidden'));
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true }));
      out.push('keyI2=' + !info.classList.contains('hidden'));
      document.getElementById('prev-product-btn').click();
      document.getElementById('next-product-btn').click();
      out.push('arrowsOk');
      return out.join(' ');
    })()`));
    await sleep(1500);
  }

  const errs = cdp.events.filter(e => e.method === 'Runtime.exceptionThrown' ||
      (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') ||
      (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'))
    .map(e => e.method === 'Runtime.exceptionThrown'
      ? 'EXC ' + ((e.params.exceptionDetails.exception || {}).description || e.params.exceptionDetails.text)
      : e.method === 'Runtime.consoleAPICalled'
        ? 'CONSOLE ' + e.params.args.map(a => a.value || a.description).join(' ')
        : 'LOG ' + e.params.entry.text);

  console.log('ERRORS ' + JSON.stringify(errs, null, 2));
  console.log('STATE ' + await cdp.ev(`(() => {
    const host = document.getElementById('pv-stage-host');
    const err = document.getElementById('error-message');
    const lo = document.getElementById('loading-overlay');
    const prev = document.getElementById('prev-product-btn');
    const next = document.getElementById('next-product-btn');
    const bg = document.querySelector('#pv-stage-host .pv-stage-bg');
    const pi = document.querySelector('#pv-stage-host .pv-product-img');
    return JSON.stringify({
      title: document.title,
      name: (document.getElementById('product-name')||{}).textContent,
      desc: (document.getElementById('product-description')||{}).textContent,
      hostDisplay: host ? host.style.display : 'MISSING',
      stage: !!document.querySelector('#pv-stage-host .pv-stage'),
      bgSrc: bg ? bg.src : null,
      boxes: [].slice.call(document.querySelectorAll('#pv-stage-host .pv-product-box')).length,
      prodImg: pi ? pi.src : null,
      errorShown: err ? err.style.display : 'MISSING',
      errorText: (document.querySelector('#error-message p')||{}).textContent || null,
      loading: lo ? lo.style.display : 'MISSING',
      prevHidden: prev ? prev.classList.contains('hidden') : 'MISSING',
      nextHidden: next ? next.classList.contains('hidden') : 'MISSING'
    });
  })()`));

  // A non-existent product must surface a readable message, not a bare TypeError,
  // and a following good load must clear that panel again.
  console.log('MISSING ' + await cdp.ev(`(async () => {
    const v = window.pvViewer;
    if (!v) return 'no-viewer';
    await v.loadProduct('99999');
    const failed = {
      shown: document.getElementById('error-message').style.display,
      text: document.querySelector('#error-message p').textContent
    };
    await v.loadProduct('2');
    return JSON.stringify({
      failed: failed,
      recoveredShown: document.getElementById('error-message').style.display,
      recoveredName: document.getElementById('product-name').textContent,
      recoveredStage: !!document.querySelector('#pv-stage-host .pv-stage')
    });
  })()`));

  console.log('NET ' + JSON.stringify(cdp.events.filter(e => e.method === 'Network.responseReceived' && /api\/v1|state\.php|uploads\//.test(e.params.response.url))
    .map(e => e.params.response.status + ' ' + e.params.response.url.replace('http://localhost/product_presenter/', ''))));

  ws.close(); edge.kill(); await sleep(400);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})().catch(e => { console.error('PROBE FAILED: ' + e.message); process.exit(1); });