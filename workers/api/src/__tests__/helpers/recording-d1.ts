export interface RecordedD1Call {
  sql: string;
  binds: unknown[];
  method: 'run' | 'all' | 'first';
}

type RecordingFixture = unknown[] | (() => unknown[]);

export function makeRecordingD1(fixtures: Record<string, RecordingFixture> = {}) {
  const calls: RecordedD1Call[] = [];
  const rowsFor = (sql: string) => {
    const key = Object.keys(fixtures).find((candidate) => sql.includes(candidate));
    if (!key) return [];
    const fixture = fixtures[key];
    return typeof fixture === 'function' ? fixture() : fixture;
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
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
  } as unknown as D1Database;
  return { db, calls };
}
