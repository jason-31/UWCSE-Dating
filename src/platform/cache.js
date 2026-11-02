// Versioned in-memory caches for data every page view needs but that changes rarely: all
// profiles, and each period's member list. D1 bills every row a query scans, so reading a whole
// list and every listed profile on each view made reads grow with the square of daily users.
//
// Each cached value is tagged with a version token from the cache_versions table. Every write
// that changes the data bumps the token in the same batch (versionBumpStatement), and readers
// fetch the token (one row) and reload only when it moved. Tokens are random rather than
// counters, so a Time Travel restore or a recreated database can never make an old copy look
// current. As a safety net for a write path that forgets to bump (or manual SQL by an operator),
// a copy is also reloaded once it is older than MAX_AGE_MS.
//
// Values live in the isolate's memory and are shared by its requests; callers must treat them
// as read-only.

export const MAX_AGE_MS = 3600_000;

const entries = new Map(); // name -> { version, at, promise }

// Statement that marks `name` as changed. Put it in the same db.batch() as the write.
export function versionBumpStatement(db, name) {
  return db
    .prepare(
      `INSERT INTO cache_versions (name, version) VALUES (?, random() % 1000000000000)
       ON CONFLICT (name) DO UPDATE SET version = random() % 1000000000000`,
    )
    .bind(name);
}

// The current token for `name`; 0 if it was never bumped.
export async function readVersion(db, name) {
  const row = await db.prepare("SELECT version FROM cache_versions WHERE name = ?").bind(name).first();
  return row?.version ?? 0;
}

// Returns the cached value for (name, version), calling load() when there is none, it carries
// another version, or it has expired. Concurrent callers in one isolate share a single load.
export function cachedValue(name, version, load, now = Date.now()) {
  const hit = entries.get(name);
  if (hit && hit.version === version && now - hit.at < MAX_AGE_MS) return hit.promise;
  for (const [key, e] of entries) if (now - e.at >= MAX_AGE_MS) entries.delete(key);
  const entry = { version, at: now, promise: null };
  entry.promise = Promise.resolve()
    .then(load)
    .catch((err) => {
      if (entries.get(name) === entry) entries.delete(name);
      throw err;
    });
  entries.set(name, entry);
  return entry.promise;
}

// Reads the version, then the value: data loaded after reading version v is at least as new as
// v, so a write that lands in between only causes one extra reload later, never a stale hit.
export async function cached(db, name, load) {
  return cachedValue(name, await readVersion(db, name), load);
}

// A module's member lists, one cached value per period (handed to modules as ctx.lists). The
// module puts changed(periodId) in the batch of every write to that period's list rows, and reads
// the list through cached(periodId, load). Its daily clean-up runs forgetBefore(oldest open
// period) to drop the version rows of lists that are closed for good; period ids must sort by
// time. (Dropping the row of a list that is still read would only cause a reload.)
export function listCache(db, challengeId) {
  const name = (periodId) => `list:${challengeId}:${periodId}`;
  return {
    changed: (periodId) => versionBumpStatement(db, name(periodId)),
    cached: (periodId, load) => cached(db, name(periodId), load),
    forgetBefore: (periodId) => db.prepare("DELETE FROM cache_versions WHERE name >= ? AND name < ?").bind(name(""), name(periodId)),
  };
}

// Tests only: forget everything (each test starts with a fresh database).
export function resetCaches() {
  entries.clear();
}
