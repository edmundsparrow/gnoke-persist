/* =====================================================
gnoke.bundle.js  —  Gnoke Persistence Suite
v0.1.1 — Edmund Sparrow © 2026 — MIT

Includes:
1. gnoke-spirit.js       (state layer)
2. gnoke-savenative.js   (I/O layer)
3. web2diskbridge.js     (orchestration)

Usage:
<script src="gnoke.bundle.js"></script>
if (!window.GNOKE_READY) throw new Error('Gnoke not loaded');
===================================================== */

/* ── Build identity ── */

window.GNOKE_BUILD = {
version:   '0.1.1',
buildTime: '2026-05-06T00:00:00Z',
hash:      'gnk-0.1.1-core',
mode:      'bundle'
};

window.Gnoke = window.Gnoke || {};

/* ── gnoke-spirit.js ── */

(() => {
const DB_NAME   = 'gnoke:spirit';
const STORE     = 'processes';
const VERSION   = 1;
const SENSITIVE = new Set(['password', 'token', 'cc', 'cvv', 'ssn', 'secret']);

let _mem = {};
let _db  = null;

const getDB = () => {
if (_db) return Promise.resolve(_db);
return new Promise((res, rej) => {
const r = indexedDB.open(DB_NAME, 1);
r.onupgradeneeded = e => e.target.result.createObjectStore(STORE);
r.onsuccess = e => { _db = e.target.result; res(_db); };
r.onerror   = e => rej(e.target.error);
});
};

const tx     = (db, mode) => db.transaction(STORE, mode).objectStore(STORE);
const dbGet  = (db, key)      => new Promise((res, rej) => { const r = tx(db,'readonly').get(key);       r.onsuccess = e => res(e.target.result); r.onerror = e => rej(e.target.error); });
const dbPut  = (db, val, key) => new Promise((res, rej) => { const r = tx(db,'readwrite').put(val, key); r.onsuccess = () => res();              r.onerror = e => rej(e.target.error); });
const dbDel  = (db, key)      => new Promise((res, rej) => { const r = tx(db,'readwrite').delete(key);   r.onsuccess = () => res();              r.onerror = e => rej(e.target.error); });
const dbKeys = (db)           => new Promise((res, rej) => { const r = tx(db,'readonly').getAllKeys();    r.onsuccess = e => res(e.target.result); r.onerror = e => rej(e.target.error); });

const migrate = (state) => {
if (!state) return null;
if (state.v !== VERSION) state.v = VERSION;
return state;
};

const isSensitive = f =>
f.type === 'password' ||
SENSITIVE.has(f.type) ||
[...SENSITIVE].some(s => (f.name || f.id || '').toLowerCase().includes(s));

const sel = el =>

  el.id ? `#${el.id}` : el.name ? `[name="${el.name}"]` : el.tagName.toLowerCase();  
const capture = (root) => {
const r = root || document;
return {
v: VERSION, ts: Date.now(), url: location.href,
scroll: { x: scrollX, y: scrollY },
focus: document.activeElement ? sel(document.activeElement) : null,
forms: [...(r.tagName === 'FORM' ? [r] : r.querySelectorAll('form'))].map(f => ({
sel: sel(f),
fields: [...f.querySelectorAll('input,textarea,select')]
.filter(el => !isSensitive(el) && (el.name || el.id))
.map(el => ({ sel: sel(el), val: el.value }))
})).filter(f => f.fields.length)
};
};

const save = async (pid, formEl) => {
_mem[pid] = capture(formEl);
await dbPut(await getDB(), _mem[pid], pid);
};

const restore = async (db, pid, root) => {
const raw   = await dbGet(db, pid);
const state = migrate(raw);
if (!state || state.url !== location.href) return;
scrollTo(state.scroll.x, state.scroll.y);
const r = root || document;
state.forms.forEach(({ sel: fSel, fields }) => {
const form = r.tagName === 'FORM' ? r : r.querySelector(fSel);
if (!form) return;
fields.forEach(({ sel: eSel, val }) => {
const el = form.querySelector(eSel);
if (el) el.value = val;
});
});
if (state.focus) document.querySelector(state.focus)?.focus();
};

const spirit = {
async wake(pid, formEl) {
pid = pid || location.pathname;
const db = await getDB();
await restore(db, pid, formEl);
let t;
const target = formEl || window;
target.addEventListener('input', () => {
clearTimeout(t);
t = setTimeout(() => save(pid, formEl), 300);
});
window.addEventListener('visibilitychange', async () => {
if (document.visibilityState === 'hidden') await save(pid, formEl);
});
return pid;
},
async kill(pid) { await dbDel(await getDB(), pid || location.pathname); },
async list()    { return dbKeys(await getDB()); }
};

window.Gnoke.spirit  = spirit;
window.gnokeSpirit   = spirit; // legacy alias
})();

/* ── gnoke-savenative.js ── */

(() => {
const saveNative = {

onFlushProgress: null,  
onFlushComplete: null,  
onWriteFailure:  null,  
_queues: {},  

async mount(openDB) {  
  const handle = await window.showDirectoryPicker();  
  const db = await this._db(openDB);  
  await db.put('handles', handle, 'workspace');  
  return handle;  
},  

async wake(openDB) {  
  const db     = await this._db(openDB);  
  const handle = await db.get('handles', 'workspace');  
  if (!handle) throw new Error('gnoke-savenative: No stashed handle. Call mount() first.');  
  const perm = await handle.queryPermission({ mode: 'readwrite' });  
  if (perm !== 'granted') {  
    const req = await handle.requestPermission({ mode: 'readwrite' });  
    if (req !== 'granted') throw new Error('gnoke-savenative: Permission denied on wake.');  
  }  
  await this._flush(handle, db);  
  return { handle, db };  
},  

write(workspace, name, content) {  
  if (!content) return Promise.resolve();  
  const prev = this._queues[name] || Promise.resolve();  
  this._queues[name] = prev  
    .then(() => this._doWrite(workspace, name, content))  
    .catch(async () => {  
      await workspace.db.add('shelf', { name, content, createdAt: new Date().toISOString() });  
    });  
  return this._queues[name];  
},  

async _doWrite(workspace, name, content) {  
  const { handle, db } = workspace;  
  try {  
    const file   = await handle.getFileHandle(name, { create: true });  
    const stream = await file.createWritable();  
    await stream.write(content);  
    await stream.close();  
  } catch (err) {  
    if (this.onWriteFailure) this.onWriteFailure(name, err);  
    await db.add('shelf', { name, content, createdAt: new Date().toISOString() });  
  }  
},  

async _flush(handle, db) {  
  const pending = await db.getAll('shelf');  
  if (!pending.length) return;  
  let recovered = 0;  
  for (const item of pending) {  
    try {  
      const file   = await handle.getFileHandle(item.name, { create: true });  
      const stream = await file.createWritable();  
      await stream.write(item.content);  
      await stream.close();  
      await db.delete('shelf', item.id);  
      recovered++;  
      if (this.onFlushProgress) this.onFlushProgress(recovered, pending.length);  
    } catch { return; }  
  }  
  if (this.onFlushComplete) this.onFlushComplete(recovered);  
},  

async _db(openDB) {  
  return openDB('ShadowStorage', 1, {  
    upgrade(db) {  
      if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');  
      if (!db.objectStoreNames.contains('shelf'))   db.createObjectStore('shelf', { keyPath: 'id', autoIncrement: true });  
    }  
  });  
}

};

window.Gnoke.saveNative = saveNative;
window.saveNative       = saveNative; // legacy alias
})();

/* ── web2diskbridge.js ── */
// ⚠️  Platform note: mount() requires the File System Access API
//     (showDirectoryPicker / queryPermission). Supported in Chromium-based
//     browsers only. Safari and Firefox are not supported by design.      [P5]

(() => {
const bridge = {

workspace:    null,  
spiritPid:    null,  
permissionOk: false,  

onPermissionLost:     null,  
onPermissionRestored: null,  
onFlushProgress:      null,  
onFlushComplete:      null,  
onWriteFailure:       null,  

_permWatchAttached: false,  
_woken:             false,                        // [4] wake-once contract  
_shelfFailures:     0,                            // [5] shelf failure counter  

async mount(openDB) {  
  if (typeof openDB !== 'function') {             // [1] openDB guard  
    throw new Error('Gnoke: openDB (idb) is required and must be a function.');  
  }  
  return window.Gnoke.saveNative.mount(openDB);  
},  

async wake(openDB, { formEl = null, pid = null } = {}) {  
  if (this._woken) {                              // [4] prevent spirit listener duplication  
    console.warn('Gnoke: bridge.wake() called more than once — ignoring.');  
    return this;  
  }  
  this._woken = true;  

  if (typeof openDB !== 'function') {             // [1] openDB guard  
    throw new Error('Gnoke: openDB (idb) is required and must be a function.');  
  }  

  this.spiritPid = await window.Gnoke.spirit.wake(pid, formEl);  

  window.Gnoke.saveNative.onFlushProgress = this.onFlushProgress;  
  window.Gnoke.saveNative.onFlushComplete = this.onFlushComplete;  
  window.Gnoke.saveNative.onWriteFailure  = this.onWriteFailure;  

  try {                                           // [2] wake() failure surface  
    this.workspace = await window.Gnoke.saveNative.wake(openDB);  
  } catch (err) {  
    this.permissionOk = false;  
    this._woken = false;                          // allow re-attempt after failure  
    if (this.onPermissionLost) this.onPermissionLost(err);  
    throw err;  
  }  

  this.permissionOk = true;  
  this._attachPermissionWatch();  
  return this;  
},  

write(name, content) {  
  if (!this.workspace) throw new Error('web2diskBridge: call wake() before write().');  
  const queues = window.Gnoke.saveNative._queues;  
  const p = window.Gnoke.saveNative.write(this.workspace, name, content)  
    .catch(async () => {                          // [5] shelf failure boundary  
      try {  
        await this.workspace.db.add('shelf', {  
          name,  
          content,  
          createdAt: new Date().toISOString()  
        });  
      } catch (e) {  
        this._shelfFailures++;                    // [5]  
        console.error('Gnoke: shelf failure — write lost:', name, e);  
        if (this.onWriteFailure) this.onWriteFailure(name, e);  
      }  
    })  
    .finally(() => {                              // [6] prune settled queue slot  
      if (queues[name] === p) delete queues[name];  
    });  
  return p;  
},  

async killSpirit() {  
  await window.Gnoke.spirit.kill(this.spiritPid);  
},  

// [7] reset() — exits the frozen-after-permission-loss state.  
// Call after onPermissionLost fires to allow wake() again with a fresh mount().  
async reset() {  
  this.workspace    = null;  
  this.spiritPid    = null;  
  this.permissionOk = false;  
  this._woken       = false;  
  // _permWatchAttached kept: listener is already on document, re-attaching would duplicate it.  
  // _shelfFailures kept: cumulative counter, intentionally survives reset for inspect().  
},  

_attachPermissionWatch() {  
  if (this._permWatchAttached) return;  
  this._permWatchAttached = true;  
  document.addEventListener('visibilitychange', async () => {  
    if (document.visibilityState !== 'visible') return;  
    if (!this.workspace?.handle) return;  
    const perm = await this.workspace.handle.queryPermission({ mode: 'readwrite' });  
    if (perm !== 'granted') {  
      if (this.permissionOk && this.onPermissionLost) this.onPermissionLost();  
      this.permissionOk = false;  
    } else {  
      if (!this.permissionOk) {  
        await this._safeFlush();  
        if (this.onPermissionRestored) this.onPermissionRestored();  
      }  
      this.permissionOk = true;  
    }  
  });  
},  

async _safeFlush() {  
  const { handle, db } = this.workspace;  
  const pending = await db.getAll('shelf');  
  if (!pending.length) return;  
  let recovered = 0;  
  for (const item of pending) {  
    try {  
      const file   = await handle.getFileHandle(item.name, { create: true });  
      const stream = await file.createWritable();  
      await stream.write(item.content);  
      await stream.close();  
      await db.delete('shelf', item.id);  
      recovered++;  
      if (this.onFlushProgress) this.onFlushProgress(recovered, pending.length);  
    } catch (err) {  
      if (_isPermissionError(err)) return;  
      if (this.onWriteFailure) this.onWriteFailure(item.name, err);  
      continue;  
    }  
  }  
  if (this.onFlushComplete) this.onFlushComplete(recovered);  
}

};

function _isPermissionError(err) {
return (
err?.name === 'NotAllowedError' ||
err?.name === 'SecurityError'   ||
err?.message?.toLowerCase().includes('permission')
);
}

window.Gnoke.bridge   = bridge;
window.web2diskBridge = bridge; // legacy alias

/* ── Debug inspector ── */    // [3] console debug tool
window.Gnoke.inspect = () => ({
build:         window.GNOKE_BUILD,
ready:         window.GNOKE_READY,
woken:         window.Gnoke.bridge._woken,         // [4]
hasWorkspace:  !!window.Gnoke.bridge.workspace,
permission:    window.Gnoke.bridge.permissionOk,
shelfFailures: window.Gnoke.bridge._shelfFailures, // [5]
queueSize:     Object.keys(window.Gnoke.saveNative._queues).length // [6]
});
})();

/* ── Ready signal ── */

window.GNOKE_READY = true;
