declare module "pg" {
  export class Client {
    constructor(config?: { connectionString?: string });
    connect(): Promise<void>;
    end(): Promise<void>;
    query(queryText: string, values?: unknown[]): Promise<{ rows: any[] }>;
  }
}
