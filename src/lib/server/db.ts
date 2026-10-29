/** The slice of the Cloudflare D1 API this app uses. Declared here so the code also runs against a test double. */
export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  run(): Promise<{ meta?: { changes?: number } }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}
export interface Db {
  prepare(sql: string): DbStatement;
  batch(statements: DbStatement[]): Promise<unknown[]>;
}
