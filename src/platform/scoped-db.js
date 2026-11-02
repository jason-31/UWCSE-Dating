// Restricted data access handed to a module. Every statement is bound with the module's
// challenge_id as ?1 and may only touch the module's own tables. This keeps a challenge inside its
// namespace by construction; it is an organisational guard for trusted code, not a sandbox.
export function scopedDb(db, challengeId, tablePrefix) {
  // "DO UPDATE SET" (upsert) is not a table reference.
  const tableRef = /\b(?:FROM|INTO|(?<!\bDO\s+)UPDATE|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)/gi;

  function check(sql) {
    if (!/\bchallenge_id\b/.test(sql) || !/\?1\b/.test(sql)) {
      throw new Error(`scoped query must filter by challenge_id = ?1: ${sql}`);
    }
    for (const [, table] of sql.matchAll(tableRef)) {
      if (!table.startsWith(tablePrefix)) {
        throw new Error(`table ${table} is outside module namespace ${tablePrefix}`);
      }
    }
  }

  return {
    challengeId,
    prepare(sql, ...params) {
      check(sql);
      return db.prepare(sql).bind(challengeId, ...params);
    },
    batch(statements) {
      return db.batch(statements);
    },
  };
}
