import { Pool, PoolClient } from 'pg';

export async function inPostgresTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    // Không dùng pool.query trong work: BEGIN và mọi ghi phải cùng connection.
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { broken = true; }
    throw error;
  } finally { client.release(broken); }
}

// Khóa cha TRƯỚC câu INSERT/PATCH; trigger là phòng vệ, không thay contract adapter.
export async function lockFarm(client: PoolClient, farmId: string): Promise<void> {
  const result = await client.query('SELECT id FROM public.farms WHERE id=$1 FOR UPDATE', [farmId]);
  if (!result.rowCount) { throw new Error('Farm not found'); }
}

export async function lockHarvestBatches(client: PoolClient, batches: string[]): Promise<void> {
  for (const batch of [...new Set(batches)].sort()) {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('harvest-batch:' || $1,0))", [batch]);
  }
}
