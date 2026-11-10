"use client";
/**
 * Optional, opt-in draft of the current session in this browser's IndexedDB.
 * Nothing leaves the device; the user can delete the draft at any time.
 * Page images are stored once per page and only re-written when they change.
 */
import type { ScanPage } from "./scan";

const DB_NAME = "ak-scan-drafts";
const VERSION = 1;
const META = "meta";
const BLOBS = "blobs";
const SETTING_KEY = "ak-scan-draft-enabled";

export interface DraftSummary { savedAt: number; pageCount: number }
type StoredPage = Omit<ScanPage, "url"> & { blobKey: string };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("IndexedDB không khả dụng.")); return; }
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Không mở được bộ nhớ nháp."));
  });
}

function done(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Không ghi được bản nháp."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Đã hủy ghi bản nháp."));
  });
}

function read<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}

export function isDraftEnabled() {
  try { return localStorage.getItem(SETTING_KEY) === "1"; } catch { return false; }
}
export function setDraftEnabled(enabled: boolean) {
  try { if (enabled) localStorage.setItem(SETTING_KEY, "1"); else localStorage.removeItem(SETTING_KEY); } catch { /* private mode: drafts simply stay off */ }
  window.dispatchEvent(new Event(SETTING_EVENT));
}
const SETTING_EVENT = "ak-scan-draft-setting";
/** For useSyncExternalStore: notifies when the setting changes (this tab or another). */
export function subscribeDraftSetting(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(SETTING_EVENT, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(SETTING_EVENT, callback); };
}

export async function saveDraft(pages: ScanPage[]) {
  const db = await openDb();
  try {
    const existing = new Set(await read(db.transaction(BLOBS).objectStore(BLOBS).getAllKeys() as IDBRequest<IDBValidKey[]>).then((keys) => keys.map(String)));
    const blobs = new Map<string, Blob>();
    for (const page of pages) {
      const key = `${page.id}:${page.url}`;
      if (!existing.has(key)) blobs.set(key, await (await fetch(page.url)).blob());
    }
    const transaction = db.transaction([META, BLOBS], "readwrite");
    const wanted = new Set(pages.map((page) => `${page.id}:${page.url}`));
    for (const key of existing) if (!wanted.has(key)) transaction.objectStore(BLOBS).delete(key);
    for (const [key, blob] of blobs) transaction.objectStore(BLOBS).put(blob, key);
    const stored: StoredPage[] = pages.map(({ url, ...page }) => ({ ...page, blobKey: `${page.id}:${url}` }));
    transaction.objectStore(META).put({ savedAt: Date.now(), pages: stored }, "current");
    await done(transaction);
  } finally {
    db.close();
  }
}

export async function draftSummary(): Promise<DraftSummary | null> {
  const db = await openDb();
  try {
    const meta = await read(db.transaction(META).objectStore(META).get("current")) as { savedAt: number; pages: StoredPage[] } | undefined;
    return meta?.pages.length ? { savedAt: meta.savedAt, pageCount: meta.pages.length } : null;
  } finally {
    db.close();
  }
}

/** Restores pages with fresh blob URLs (registered by the caller for cleanup). */
export async function loadDraft(register: (url: string) => void): Promise<ScanPage[]> {
  const db = await openDb();
  try {
    const transaction = db.transaction([META, BLOBS]);
    const meta = await read(transaction.objectStore(META).get("current")) as { pages: StoredPage[] } | undefined;
    if (!meta) return [];
    const pages: ScanPage[] = [];
    for (const { blobKey, ...page } of meta.pages) {
      const blob = await read(db.transaction(BLOBS).objectStore(BLOBS).get(blobKey)) as Blob | undefined;
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      register(url);
      pages.push({ ...page, url });
    }
    return pages;
  } finally {
    db.close();
  }
}

export async function clearDraft() {
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}
