/*
 * Video storage for the in-page panel.
 *
 * IndexedDB here belongs to the tiktok.com origin (content scripts share the
 * page's origin storage), which is what lets a batch survive the page reload
 * TikTok does between posts. Blobs never leave the browser.
 */
(function (global) {
  'use strict';

  const DB_NAME = 'ttbulk-media';
  const DB_VERSION = 1;
  const STORE = 'files';

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB unavailable'));
    });
    return dbPromise;
  }

  function tx(mode, run) {
    return open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE, mode);
          const store = transaction.objectStore(STORE);
          let request;
          try {
            request = run(store);
          } catch (error) {
            reject(error);
            return;
          }
          transaction.oncomplete = () => resolve(request ? request.result : undefined);
          transaction.onerror = () => reject(transaction.error || new Error('IndexedDB write failed'));
          transaction.onabort = () => reject(transaction.error || new Error('IndexedDB write aborted'));
        })
    );
  }

  const Store = {
    put(id, blob, meta = {}) {
      const name = meta.name || blob.name || 'video.mp4';
      const type = meta.type || blob.type || 'video/mp4';
      return tx('readwrite', (store) => store.put({ id, blob, name, type, size: blob.size, addedAt: Date.now() }));
    },
    get(id) {
      return tx('readonly', (store) => store.get(id));
    },
    del(id) {
      return tx('readwrite', (store) => store.delete(id));
    },
    clear() {
      return tx('readwrite', (store) => store.clear());
    },
    keys() {
      return tx('readonly', (store) => store.getAllKeys());
    }
  };

  Object.defineProperty(global, '__TTBULK_STORE__', { value: Store, enumerable: false });
})(globalThis);
