// @types/node 20 predates node:sqlite (built in from Node 22); declare the little the test double uses.
declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): { run(...p: unknown[]): { changes: number | bigint }; all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown };
  }
}
