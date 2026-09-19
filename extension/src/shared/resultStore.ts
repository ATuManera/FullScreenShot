// SPDX-License-Identifier: MPL-2.0-no-copyleft-exception
// Copyright (c) 2026 ATuManera / Fernando Gallarday

/**
 * Local-only, binary-safe persistence for a finished capture's bytes,
 * shared by background/index.ts (writer) and result/result.ts (reader).
 *
 * Replaces the earlier `chrome.storage.session` + base64 data-URL
 * approach (UX-P3), which had two independent problems surfaced by
 * physical testing: (1) `chrome.storage.session` is cleared whenever
 * the unpacked extension is reloaded — routine during development —
 * even though it does survive a bare service-worker restart, so a
 * result produced just before a reload silently vanished; and (2) a
 * giant base64 string is ~33% larger than the source bytes and forces
 * the whole payload through JSON (de)serialization.
 *
 * IndexedDB stores the result as a `Blob` (no base64 inflation), lives
 * in the extension's own origin storage (survives service-worker
 * restarts *and* "reload extension" during dev, unlike
 * chrome.storage.session — it's only cleared if the extension is
 * uninstalled or its stored data is explicitly cleared), and is
 * available from both a service worker and a normal extension page.
 * Nothing here is ever sent over the network — see SECURITY.md.
 */

const DB_NAME = "fullscreenshot-results";
const DB_VERSION = 1;
const STORE_NAME = "results";
const CREATED_AT_INDEX = "createdAt";

/** How long a result is kept before it's treated as expired and cleaned up. */
export const RESULT_TTL_MS = 15 * 60 * 1000;

/**
 * Small, optional presentation metadata for the Result Page — never a
 * second copy of the screenshot bytes (those live only in `blob`).
 * Every field is optional so a record saved before this metadata
 * existed still loads correctly (`loadResult` just returns `undefined`
 * for fields it never had).
 */
export interface ResultMetadata {
  width?: number;
  height?: number;
  pdfPageSize?: "a4" | "letter" | "auto";
  pdfOrientation?: "portrait" | "landscape";
  /**
   * Whether this PDF's text layer was really written. Recorded rather than
   * inferred from the format, so the Result Page can only say a PDF is
   * searchable when the composer reported placing text in it.
   */
  textLayer?: boolean;
}

export interface StoredResult extends ResultMetadata {
  blob: Blob;
  filename: string;
  createdAt: number;
}

interface StoredRecord extends StoredResult {
  id: string;
}

/** Pure expiry policy — testable without IndexedDB. */
export function isExpired(createdAt: number, now: number): boolean {
  return now - createdAt > RESULT_TTL_MS;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex(CREATED_AT_INDEX, CREATED_AT_INDEX);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error instanceof Error ? req.error : new Error("Failed to open result store."));
  });
}

/** Stores a capture result. Also opportunistically clears expired entries so storage never grows unbounded. */
export async function saveResult(id: string, blob: Blob, filename: string, metadata: ResultMetadata = {}): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const record: StoredRecord = { id, blob, filename, createdAt: Date.now(), ...metadata };
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error instanceof Error ? tx.error : new Error("Failed to save result."));
    });
  } finally {
    db.close();
  }
  void cleanupExpired();
}

/**
 * Loads a result by id. Does NOT delete it — reading (including a page
 * reload) must not consume the data before the user has downloaded it.
 * Returns null for an unknown id or one whose TTL has elapsed (and
 * removes the expired entry as a side effect).
 */
export async function loadResult(id: string): Promise<StoredResult | null> {
  const db = await openDb();
  let record: StoredRecord | undefined;
  try {
    record = await new Promise<StoredRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result as StoredRecord | undefined);
      req.onerror = () => reject(req.error instanceof Error ? req.error : new Error("Failed to load result."));
    });
  } finally {
    db.close();
  }

  if (!record) {
    return null;
  }
  if (isExpired(record.createdAt, Date.now())) {
    void deleteResult(id);
    return null;
  }
  return {
    blob: record.blob,
    filename: record.filename,
    createdAt: record.createdAt,
    width: record.width,
    height: record.height,
    pdfPageSize: record.pdfPageSize,
    pdfOrientation: record.pdfOrientation,
    textLayer: record.textLayer,
  };
}

export async function deleteResult(id: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error instanceof Error ? tx.error : new Error("Failed to delete result."));
    });
  } finally {
    db.close();
  }
}

/** Removes every entry whose TTL has elapsed. Never throws — cleanup is best-effort. */
export async function cleanupExpired(): Promise<void> {
  try {
    const db = await openDb();
    const cutoff = Date.now() - RESULT_TTL_MS;
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const index = tx.objectStore(STORE_NAME).index(CREATED_AT_INDEX);
        const range = IDBKeyRange.upperBound(cutoff);
        const cursorReq = index.openCursor(range);
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error instanceof Error ? tx.error : new Error("Cleanup failed."));
      });
    } finally {
      db.close();
    }
  } catch {
    // Best-effort: a cleanup failure must never block saving/loading a result.
  }
}
