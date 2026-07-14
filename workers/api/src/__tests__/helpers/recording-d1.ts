export interface RecordedD1Call {
  sql: string;
  binds: unknown[];
  method: 'run' | 'all' | 'first';
}

export function makeRecordingD1(fixtures: Record<string, unknown[]> = {}) {
  const calls: RecordedD1Call[] = [];
  const rowsFor = (sql: string) => {
    const key = Object.keys(fixtures).find((candidate) => sql.includes(candidate));
    return key ? fixtures[key] : [];
  };
  const db = {
    prepare(sql: string) {
      const statement = {
        binds: [] as unknown[],
        bind(...values: unknown[]) {
          statement.binds = values;
          return statement;
        },
        async run() {
          calls.push({ sql, binds: statement.binds, method: 'run' as const });
          return { success: true };
        },
        async all<T>() {
          calls.push({ sql, binds: statement.binds, method: 'all' as const });
          return { results: rowsFor(sql) as T[] };
        },
        async first<T>() {
          calls.push({ sql, binds: statement.binds, method: 'first' as const });
          return (rowsFor(sql)[0] ?? null) as T | null;
        },
      };
      return statement;
    },
  } as unknown as D1Database;
  return { db, calls };
}
