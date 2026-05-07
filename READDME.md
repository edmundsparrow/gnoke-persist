# gnoke-persist

Durable browser persistence — write-ahead shelf, form state survival, and I/O orchestration for the File System Access API.

No server. No Electron wrapper. No framework asking nicely if the browser can please have a filesystem. 🙂

---

## What it is

Three coordinated layers shipped as a single bundle:

**gnoke-spirit** — captures form state to IndexedDB on every keystroke (debounced), force-saves on `visibilitychange`, restores on wake. Sensitive fields (`password`, `token`, `secret`, etc.) are never persisted.

**gnoke-savenative** — wraps the File System Access API with a per-filename write queue and a write-ahead shelf. If a write fails mid-crash, it lands in IndexedDB and replays automatically on next wake.

**web2diskbridge** — orchestrates both layers in a single lifecycle. One `wake()` call restores form state, re-acquires your directory handle, and flushes any shelved writes from the last crash.

---

## Why it exists

The File System Access API is genuinely exciting. A user picks a folder. You write to it. No server involved.

On mobile, Android kills your browser tab mid-write. No error thrown. No warning. The write just doesn't complete. Then your handle is stale. Then ten queued writes race, collide, and most of them silently disappear.

These aren't web developer problems. They're kernel problems — write ordering, process lifecycle, I/O durability. `gnoke-persist` solves them at the browser layer so you don't have to. 🤔

---

## Install

```html
<script src="gnoke.bundle.js"></script>
```

Verify load:
```js
if (!window.__GNOKE_READY__) throw new Error('Gnoke not loaded');
```

---

## Usage

```js
import { openDB } from 'idb'; // or roll a native adapter — see below

// once: user picks a folder
await Gnoke.bridge.mount(openDB);

// every page load after that
Gnoke.bridge.onPermissionLost     = () => showBanner('permission lost');
Gnoke.bridge.onPermissionRestored = () => hideBanner();
Gnoke.bridge.onFlushComplete      = n  => toast(`recovered ${n} writes`);

await Gnoke.bridge.wake(openDB, { formEl: document.querySelector('form') });
await Gnoke.bridge.write('output.json', JSON.stringify(data));
```

### No idb? No problem.

`openDB` is a pluggable adapter. The bundle doesn't require `idb` — it requires *a function that opens an IndexedDB-like database*. Roll your own:

```js
function openDB(name, version, { upgrade } = {}) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = e => { if (upgrade) upgrade(e.target.result); };
    req.onsuccess = () => resolve(wrap(req.result));
    req.onerror   = () => reject(req.error);
  });
}
```

Full native adapter in `examples/opendb-native.js`.

---

## Debug

```js
console.log(Gnoke.inspect());
// {
//   version: '0.1.1',
//   woken: true,
//   hasWorkspace: true,
//   permission: true,
//   shelfFailures: 0,
//   queueSize: 0
// }
```

---

## Browser support

| Feature | Chrome | Edge | Firefox | Safari |
|---|---|---|---|---|
| Spirit (form state) | ✅ | ✅ | ✅ | ✅ |
| SaveNative + Bridge | ✅ | ✅ | ❌ | ❌ |

`showDirectoryPicker()` is Chromium only by design. Safari and Firefox do not support it.

---

## Architecture

```
web2diskbridge      ← lifecycle · permission watch · reset()
      ↓
gnoke-spirit        ← form capture · restore · sensitive exclusion
      ↓
gnoke-savenative    ← write queue · shelf · flush on wake
```

Each layer is independently usable. The bundle is convenience, not a requirement.

It’s a durability layer, not a magic wand—you still have to handle the user click to open the door.

---

## License

MIT — Edmund Sparrow, 2026.

