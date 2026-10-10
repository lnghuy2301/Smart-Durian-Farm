import { ClientSession } from 'mongodb';
import { PoolClient } from 'pg';

// Contracts cho các adapter ở đợt sau; không đưa interface này vào DI khi chưa có
// đầy đủ ghi record + request + audit + metadata trong cùng transaction.
export interface AsyncReadRepository<T> {
  findById(id: string): Promise<T | null>;
}
export interface PostgresUnitOfWork {
  run<T>(work: (client: PoolClient) => Promise<T>): Promise<T>;
}
export interface MongoUnitOfWork {
  run<T>(work: (session: ClientSession) => Promise<T>): Promise<T>;
}
