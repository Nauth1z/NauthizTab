import { spawn } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import assert from 'node:assert/strict';

const candidates = [process.env.NAUTHIZ_BROWSER, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean);
let executable;
for (const candidate of candidates) {
  try { await access(candidate); executable = candidate; break; } catch {}
}
assert(executable, 'Set NAUTHIZ_BROWSER to a Chromium browser executable.');
await access(resolve('dist/manifest.json'));
const profile = await mkdtemp(join(tmpdir(), 'nauthiz-tab-smoke-'));
const browser = spawn(executable, [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update',
  '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
  `--user-data-dir=${profile}`, '--window-size=1280,800',
], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });

const pending = new Map();
let nextId = 0;
let buffer = '';
let stderr = '';
const runtimeErrors = [];
let firstSession;
browser.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4000); });
browser.on('error', (error) => { for (const item of pending.values()) item.reject(error); });
browser.stdio[4].on('data', (chunk) => {
  buffer += chunk.toString();
  let end;
  while ((end = buffer.indexOf('\0')) !== -1) {
    const raw = buffer.slice(0, end); buffer = buffer.slice(end + 1);
    if (!raw) continue;
    const message = JSON.parse(raw);
    if (message.id) {
      const item = pending.get(message.id);
      if (!item) continue;
      pending.delete(message.id); clearTimeout(item.timer);
      if (message.error) item.reject(new Error(JSON.stringify(message.error)));
      else item.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') {
      runtimeErrors.push(message.params.exceptionDetails);
    }
  }
});

function send(method, params = {}, sessionId) {
  return new Promise((resolvePromise, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out. ${stderr}`)); }, 10000);
    pending.set(id, { resolve: resolvePromise, reject, timer });
    browser.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });
}
async function evaluate(session, expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function until(session, expression) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await evaluate(session, expression)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 40));
  }
  throw new Error(`Condition timed out: ${expression}\n${await evaluate(session, 'document.body.innerText')}`);
}
async function page(url) {
  const { targetId } = await send('Target.createTarget', { url });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Page.enable', {}, sessionId);
  await until(sessionId, `!!document.querySelector('.newTab') && !document.querySelector('.loading')`);
  return sessionId;
}
async function openSettings(session) {
  await send('Page.bringToFront', {}, session);
  await evaluate(session, `document.querySelector('[aria-label="打开设置"]')?.click()`);
  await until(session, `!!document.querySelector('.drawerBackdrop.open')`);
}
async function closeSettings(session) {
  await evaluate(session, `document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))`);
  await until(session, `!document.querySelector('.drawerBackdrop.open')`);
}
const setInput = `(input, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', {bubbles:true})); }`;
async function addShortcut(session, name, url) {
  await evaluate(session, `(() => {
    const set = ${setInput};
    set(document.querySelector('.settingsPanel input[placeholder="留空时使用域名"]'), ${JSON.stringify(name)});
    set(document.querySelector('.settingsPanel input[placeholder="example.com"]'), ${JSON.stringify(url)});
    document.querySelector('.settingsPanel form').requestSubmit();
  })()`);
}
async function menuItem(session, shortcutName, itemName) {
  await send('Page.bringToFront', {}, session);
  await evaluate(session, `(() => {
    const button = Array.from(document.querySelectorAll('.shortcut')).find(item => item.title === ${JSON.stringify(shortcutName)});
    button.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,clientX:1200,clientY:760}));
  })()`);
  await until(session, `!!document.querySelector('.contextMenu')`);
  await evaluate(session, `Array.from(document.querySelectorAll('.contextMenu button')).find(item => item.textContent === ${JSON.stringify(itemName)}).click()`);
}
async function upload(session, selector, path) {
  const { root } = await send('DOM.getDocument', {}, session);
  const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector }, session);
  assert(nodeId, `No file input: ${selector}`);
  await send('DOM.setFileInputFiles', { nodeId, files: [path] }, session);
}
async function tab(session, shift = false) {
  const params = { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0 };
  await send('Input.dispatchKeyEvent', { ...params, type: 'keyDown' }, session);
  await send('Input.dispatchKeyEvent', { ...params, type: 'keyUp' }, session);
}
async function drag(session, start, end, hold = 0) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start }, session);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1 }, session);
  if (hold) await new Promise((resolvePromise) => setTimeout(resolvePromise, hold));
  for (let step = 1; step <= 5; step++) {
    const x = start.x + (end.x - start.x) * step / 5;
    const y = start.y + (end.y - start.y) * step / 5;
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 }, session);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...end, button: 'left', buttons: 0, clickCount: 1 }, session);
}
async function holdShortcutSave(session) {
  await evaluate(session, `(() => {
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    chrome.storage.local.set = (items) => new Promise((resolve, reject) => {
      globalThis.releaseShortcutSave = () => {
        chrome.storage.local.set = set;
        delete globalThis.releaseShortcutSave;
        set(items).then(resolve, reject);
      };
    });
  })()`);
}

try {
  const version = await send('Browser.getVersion');
  console.log(`Browser: ${version.product}`);
  const { id } = await send('Extensions.loadUnpacked', { path: resolve('dist') });
  const url = `chrome-extension://${id}/index.html`;
  const first = await page(url);
  firstSession = first;
  await send('Page.bringToFront', {}, first);
  const openingFrames = await evaluate(first, `new Promise(resolve => {
    const frames = [];
    const start = performance.now();
    const sample = () => {
      const app = document.querySelector('.newTab');
      const grid = document.querySelector('.desktopGrid').getBoundingClientRect();
      const panel = document.querySelector('.settingsPanel');
      frames.push({time:Math.round(performance.now()-start),appScroll:app.scrollLeft,rootScroll:document.querySelector('#root').scrollLeft,bodyScroll:document.body.scrollLeft,gridLeft:grid.left,panelLeft:panel?.getBoundingClientRect().left});
      if (performance.now()-start < 400) requestAnimationFrame(sample); else resolve(frames);
    };
    sample();
    document.querySelector('[aria-label="打开设置"]').click();
  })`);
  assert(openingFrames.every(frame => frame.appScroll === 0 && frame.rootScroll === 0 && frame.bodyScroll === 0 && Math.abs(frame.gridLeft-openingFrames[0].gridLeft)<1), 'Opening settings must not scroll or shift the page');
  await until(first, `document.querySelector('.settingsPanel').getAnimations().length === 0`);
  console.log('PASS: settings opening animation does not scroll or shift the page');
  await evaluate(first, `(() => { globalThis.settingsTransitions = []; document.addEventListener('transitionend', event => globalThis.settingsTransitions.push({property:event.propertyName,target:event.target.className})); })()`);
  await closeSettings(first);
  await until(first, `!document.querySelector('.settingsPanel')`);
  for (const delay of [0, 30, 120, 300]) {
    await openSettings(first);
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    await closeSettings(first);
    await until(first, `!document.querySelector('.settingsPanel')`);
  }
  console.log('PASS: rapid settings open/close reliably unmounts the drawer');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, first);
  await openSettings(first);
  await closeSettings(first);
  assert.equal(await evaluate(first, `!!document.querySelector('.settingsPanel')`), false);
  assert.equal(await evaluate(first, `document.activeElement.getAttribute('aria-label')`), '打开设置');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }, first);
  console.log('PASS: reduced-motion settings close immediately and restore focus');

  await holdShortcutSave(first);
  await evaluate(first, `document.querySelector('[aria-label="选择搜索提供商"]').click()`);
  await evaluate(first, `Array.from(document.querySelectorAll('.providerMenu button')).find(item=>item.textContent.includes('Google')).click()`);
  await until(first, `typeof globalThis.releaseShortcutSave === 'function'`);
  assert.equal(await evaluate(first, `document.querySelector('[aria-label="搜索内容"]').placeholder`), '使用 Google 搜索');
  assert.equal(await evaluate(first, `(async () => (await chrome.storage.local.get('appData')).appData.preferences.searchProvider)()`), 'bing');
  await evaluate(first, 'globalThis.releaseShortcutSave()');
  await until(first, `(async () => (await chrome.storage.local.get('appData')).appData.preferences.searchProvider === 'google')()`);
  await evaluate(first, `document.querySelector('[aria-label="选择搜索提供商"]').click()`);
  await evaluate(first, `Array.from(document.querySelectorAll('.providerMenu button')).find(item=>item.textContent.includes('Bing')).click()`);
  await until(first, `(async () => (await chrome.storage.local.get('appData')).appData.preferences.searchProvider === 'bing')()`);
  console.log('PASS: search-provider selection takes effect before storage completes');
  const second = await page(url);

  await openSettings(first);
  await openSettings(second);
  await Promise.all([addShortcut(first, 'Site A', 'localhost:3000/docs'), addShortcut(second, 'Site B', 'example.com:8080')]);
  for (const session of [first, second]) {
    await until(session, `document.querySelectorAll('.shortcut').length === 2`);
    await closeSettings(session);
  }
  const data = await evaluate(first, `(async () => (await chrome.storage.local.get('appData')).appData)()`);
  assert.equal(data.shortcuts.length, 2);
  assert.equal(new Set(data.shortcuts.map((item) => item.slot)).size, 2);
  assert(data.shortcuts.some((item) => item.url === 'https://localhost:3000/docs'));
  console.log('PASS: concurrent additions, ports, live tab synchronization');

  await menuItem(first, 'Site A', '修改名称');
  await tab(first, true);
  assert.equal(await evaluate(first, 'document.activeElement.textContent'), '保存');
  await tab(first);
  assert.equal(await evaluate(first, 'document.activeElement.tagName'), 'INPUT');
  await evaluate(first, `(() => { const set = ${setInput}; set(document.querySelector('.dialog input'), 'Renamed A'); document.querySelector('.dialog').requestSubmit(); })()`);
  await until(second, `!!document.querySelector('[title="Renamed A"]')`);
  assert.equal(await evaluate(first, 'document.activeElement.title'), 'Renamed A');
  console.log('PASS: shortcut edits preserve other tabs additions');
  console.log('PASS: native Tab focus trapping and focus restoration');

  const searchDrag = await evaluate(first, `(() => {
    const input = document.querySelector('[aria-label="搜索内容"]').getBoundingClientRect();
    const cells = document.querySelectorAll('.gridSlot');
    const offset = cells[22].getBoundingClientRect().top - cells[2].getBoundingClientRect().top;
    return {start:{x:input.left+20,y:input.top+input.height/2},end:{x:input.left+20,y:input.top+input.height/2+offset}};
  })()`);
  await holdShortcutSave(first);
  await drag(first, searchDrag.start, searchDrag.end, 420);
  await until(first, `typeof globalThis.releaseShortcutSave === 'function'`);
  assert.equal(await evaluate(first, `(async () => (await chrome.storage.local.get('appData')).appData.layout.searchSlot)()`), 2);
  await send('Page.bringToFront', {}, second);
  await evaluate(first, `document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}))`);
  assert.equal(await evaluate(first, `document.querySelector('.searchWidget').style.gridRowStart`), '3');
  await send('Page.bringToFront', {}, first);
  for (const [name, slot] of [['Renamed A', 2], ['Site B', 10]]) {
    const move = await evaluate(first, `(() => {
      const rect = document.querySelector('[title="${name}"]').getBoundingClientRect();
      const cell = document.querySelectorAll('.gridSlot')[${slot}].getBoundingClientRect();
      return {start:{x:rect.left+rect.width/2,y:rect.top+rect.height/2},end:{x:cell.left+cell.width/2,y:cell.top+cell.height/2}};
    })()`);
    await drag(first, move.start, move.end);
    const shown = await evaluate(first, `(() => { const style = document.querySelector('[title="${name}"]').parentElement.style; return (Number(style.gridRowStart)-1)*10+Number(style.gridColumnStart)-1; })()`);
    assert.equal(shown, slot, 'Shortcut drops must remain visible while the search layout is still saving');
    await until(first, `!document.querySelector('.dragOverlay')`);
  }
  assert.equal(await evaluate(first, `(async () => (await chrome.storage.local.get('appData')).appData.layout.searchSlot)()`), 2);
  await evaluate(first, 'globalThis.releaseShortcutSave()');
  await until(second, `(async () => (await chrome.storage.local.get('appData')).appData.layout.searchSlot === 22)()`);
  await until(second, `(async () => { const data = (await chrome.storage.local.get('appData')).appData; return data.shortcuts.some(item=>item.name==='Renamed A' && item.slot===2) && data.shortcuts.some(item=>item.name==='Site B' && item.slot===10); })()`);
  await send('Page.bringToFront', {}, first);
  console.log('PASS: a dropped search widget stays in place on blur or Escape during save');
  console.log('PASS: subsequent shortcut drops stay visible before the search layout save completes');
  const shortcutDrag = await evaluate(first, `(() => {
    const icon = document.querySelector('[title="Renamed A"]').getBoundingClientRect();
    const cell = document.querySelectorAll('.gridSlot')[10].getBoundingClientRect();
    return {start:{x:icon.left+icon.width/2,y:icon.top+icon.height/2},end:{x:cell.left+cell.width/2,y:cell.top+cell.height/2}};
  })()`);
  await holdShortcutSave(first);
  await drag(first, shortcutDrag.start, shortcutDrag.end);
  await until(first, `typeof globalThis.releaseShortcutSave === 'function'`);
  const pendingDrop = await evaluate(first, `(async () => {
    const button = document.querySelector('[title="Renamed A"]');
    const position = button.parentElement.getBoundingClientRect();
    const target = document.querySelectorAll('.gridSlot')[10].getBoundingClientRect();
    const data = (await chrome.storage.local.get('appData')).appData;
    return {left:position.left,top:position.top,targetLeft:target.left,targetTop:target.top,storedSlot:data.shortcuts.find(item=>item.name==='Renamed A').slot};
  })()`);
  assert.notEqual(pendingDrop.storedSlot, 10, 'Test must hold the storage write pending');
  assert(Math.abs(pendingDrop.left-pendingDrop.targetLeft)<1 && Math.abs(pendingDrop.top-pendingDrop.targetTop)<1, 'Dropped shortcut must occupy the destination before storage finishes');
  await until(first, `!document.querySelector('.dragOverlay')`);
  assert.equal(await evaluate(first, `getComputedStyle(document.querySelector('[title="Renamed A"]')).opacity`), '1');
  await evaluate(first, 'globalThis.releaseShortcutSave()');
  await until(second, `(async () => (await chrome.storage.local.get('appData')).appData.shortcuts.some(item => item.name === 'Renamed A' && item.slot === 10))()`);
  console.log('PASS: native search-widget dragging and shortcut dragging');

  await until(first, `document.querySelector('[title="Site B"]').parentElement.getAnimations().length === 0`);
  const swapping = await evaluate(first, `(async () => {
    const source = document.querySelector('[title="Renamed A"]');
    const other = document.querySelector('[title="Site B"]');
    const from = source.getBoundingClientRect(); const to = other.getBoundingClientRect();
    const data = (await chrome.storage.local.get('appData')).appData;
    globalThis.swapAnimations = {source:0,other:0};
    for (const [node,key] of [[source.parentElement,'source'],[other.parentElement,'other']]) {
      const animate = node.animate;
      node.animate = function(...args) { if (args[1]?.duration === 260) globalThis.swapAnimations[key]++; return animate.apply(this,args); };
    }
    return {start:{x:from.left+from.width/2,y:from.top+from.height/2},end:{x:to.left+to.width/2,y:to.top+to.height/2},slot:data.shortcuts.find(item=>item.name==='Site B').slot};
  })()`);
  await holdShortcutSave(first);
  await drag(first, swapping.start, swapping.end);
  await until(first, `typeof globalThis.releaseShortcutSave === 'function'`);
  const swapLayout = await evaluate(first, `(() => {
    const slot = name => { const style = document.querySelector('[title="'+name+'"]').parentElement.style; return (Number(style.gridRowStart)-1)*10+Number(style.gridColumnStart)-1; };
    return {source:slot('Renamed A'),other:slot('Site B'),animations:globalThis.swapAnimations};
  })()`);
  assert.equal(swapLayout.source, swapping.slot, 'Dragged icon must immediately occupy the other icon slot');
  assert.equal(swapLayout.other, 10, 'Other icon must immediately move to the vacated slot');
  assert.deepEqual(swapLayout.animations, { source: 0, other: 1 }, 'Use the drop overlay for the dragged icon and one layout animation for the swapped icon');
  await evaluate(first, 'globalThis.releaseShortcutSave()');
  await until(second, `(async () => (await chrome.storage.local.get('appData')).appData.shortcuts.some(item=>item.name==='Site B' && item.slot===10))()`);
  await until(first, `!document.querySelector('.dragOverlay')`);
  console.log('PASS: immediate drops and animated swaps while persistence is delayed');

  const fixture = join(profile, 'fixture.png');
  const png = await evaluate(first, `(() => { const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16; const context = canvas.getContext('2d'); context.fillStyle = '#5c768d'; context.fillRect(0,0,16,16); return canvas.toDataURL('image/png').split(',')[1]; })()`);
  await writeFile(fixture, Buffer.from(png, 'base64'));
  await menuItem(first, 'Renamed A', '修改图标');
  await evaluate(first, `document.querySelectorAll('.dialog input[type="radio"]')[1].click()`);
  await upload(first, '.dialog input[type="file"]', fixture);
  await evaluate(first, `document.querySelectorAll('.dialog input[type="radio"]')[0].click()`);
  await evaluate(first, `document.querySelectorAll('.dialog input[type="radio"]')[1].click()`);
  assert.equal(await evaluate(first, `document.querySelector('.dialog input[type="file"]').files.length`), 0);
  await evaluate(first, `document.querySelector('.dialog').requestSubmit()`);
  await until(first, `document.querySelector('.dialog [role="alert"]')?.textContent.includes('请选择自定义图标')`);
  assert.equal(await evaluate(first, `(async () => (await chrome.storage.local.get('appData')).appData.shortcuts.find(item=>item.name==='Renamed A').iconMode)()`), 'favicon');
  await upload(first, '.dialog input[type="file"]', fixture);
  await evaluate(first, `document.querySelector('.dialog').requestSubmit()`);
  await until(first, `!document.querySelector('.dialog')`);
  await until(second, `(async () => (await chrome.storage.local.get('appData')).appData.shortcuts.some(item => item.name === 'Renamed A' && item.iconMode === 'custom' && item.customIconId))()`);
  await until(first, `!!document.querySelector('[title="Renamed A"] img[src^="blob:"]')`);
  console.log('PASS: native image processing and IndexedDB icon storage');
  console.log('PASS: switching icon modes discards the previously selected file');

  const beforeDelete = await evaluate(first, `(async () => (await chrome.storage.local.get('appData')).appData.shortcuts.find(item=>item.name==='Renamed A').slot)()`);
  await menuItem(first, 'Site B', '删除');
  await evaluate(first, `document.querySelector('.dialog .dangerButton').click()`);
  await until(second, `(async () => (await chrome.storage.local.get('appData')).appData.shortcuts.length === 1)()`);
  assert.equal(await evaluate(first, `(async () => (await chrome.storage.local.get('appData')).appData.shortcuts[0].slot)()`), beforeDelete);
  await until(first, `!document.querySelector('.dialog')`);
  console.log('PASS: deleting a shortcut preserves the remaining slot');

  await openSettings(first);
  await openSettings(second);
  await Promise.all([upload(first, '.settingsPanel input[type="file"][accept^=".jpg"]', fixture), upload(second, '.settingsPanel input[type="file"][accept^=".jpg"]', fixture)]);
  for (const session of [first, second]) await until(session, `!document.querySelector('.settingsPanel input[type="file"]:disabled') && !!document.querySelector('.wallpaperLayer img')`);
  const wallpaper = await evaluate(first, `(async () => {
    const data = (await chrome.storage.local.get('appData')).appData;
    const directory = await navigator.storage.getDirectory();
    const files = []; for await (const name of directory.keys()) if (name.startsWith('wallpaper-')) files.push(name);
    return {files, current:data.wallpaperMetadata.opfsFileName};
  })()`);
  assert.deepEqual(wallpaper.files, [wallpaper.current]);
  console.log('PASS: concurrent native OPFS wallpaper imports retain the committed file');

  const wallpaperSrc = await evaluate(first, `document.querySelector('.wallpaperLayer img').src`);
  await closeSettings(first);
  await send('Page.bringToFront', {}, first);
  await evaluate(first, `document.querySelector('[aria-label="选择搜索提供商"]').click()`);
  await evaluate(first, `Array.from(document.querySelectorAll('.providerMenu button')).find(item=>item.textContent.includes('Google')).click()`);
  await until(first, `(async () => (await chrome.storage.local.get('appData')).appData.preferences.searchProvider === 'google')()`);
  assert.equal(await evaluate(first, `document.querySelector('.wallpaperLayer img').src`), wallpaperSrc);
  console.log('PASS: changing settings does not reload the current wallpaper');

  await closeSettings(first);
  await evaluate(first, `(() => {
    const set = ${setInput}; const input = document.querySelector('[aria-label="搜索内容"]');
    set(input, '中文'); input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',isComposing:true,keyCode:229,bubbles:true}));
  })()`);
  assert.equal(await evaluate(first, 'location.href'), url);
  console.log('PASS: IME confirmation does not navigate');

  await evaluate(first, `(async () => {
    const data = (await chrome.storage.local.get('appData')).appData;
    await chrome.storage.local.set({appData:{...data,schemaVersion:3}});
  })()`);
  const third = await page(url);
  await until(third, `document.querySelector('[role="alert"]')?.textContent.includes('原始数据已保留')`);
  assert.equal(await evaluate(third, `(async () => (await chrome.storage.local.get('appData')).appData.schemaVersion)()`), 3);
  const filesAfter = await evaluate(third, `(async () => { const dir = await navigator.storage.getDirectory(); const result = []; for await (const name of dir.keys()) if (name.startsWith('wallpaper-')) result.push(name); return result; })()`);
  assert.deepEqual(filesAfter, wallpaper.files);
  console.log('PASS: unknown schema preserves settings and OPFS files');
  assert.deepEqual(runtimeErrors, [], `Unhandled runtime exceptions: ${JSON.stringify(runtimeErrors)}`);
} catch (error) {
  if (firstSession) {
    console.error(JSON.stringify(await evaluate(firstSession, `(async () => ({data:(await chrome.storage.local.get('appData')).appData, focus:document.activeElement.outerHTML, grid:document.querySelector('.desktopGrid').className, transitions:globalThis.settingsTransitions, panel:document.querySelector('.settingsPanel')&&{transform:getComputedStyle(document.querySelector('.settingsPanel')).transform,animations:document.querySelector('.settingsPanel').getAnimations().map(item=>({state:item.playState,timing:item.effect.getComputedTiming()}))},overlays:Array.from(document.querySelectorAll('.drawerBackdrop')).map(item=>({class:item.className,inert:item.inert}))}))()`), null, 2));
    if (process.env.NAUTHIZ_SMOKE_SCREENSHOT) {
      const screenshot = await send('Page.captureScreenshot', { format: 'png' }, firstSession);
      await writeFile(process.env.NAUTHIZ_SMOKE_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
    }
  }
  throw error;
} finally {
  await send('Browser.close').catch(() => browser.kill());
  if (browser.exitCode === null) await new Promise((resolvePromise) => {
    const timer = setTimeout(() => { browser.kill(); resolvePromise(); }, 3000);
    browser.once('exit', () => { clearTimeout(timer); resolvePromise(); });
  });
  for (const item of pending.values()) clearTimeout(item.timer);
  // Only remove the uniquely created test profile inside the system temp directory.
  assert(profile.startsWith(resolve(tmpdir()) + sep) && basename(profile).startsWith('nauthiz-tab-smoke-'));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
}
