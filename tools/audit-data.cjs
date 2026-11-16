// Read-only acceptance audit. Never constructs Nest, MQTT or external providers.
const { config } = require('dotenv');
const { resolve } = require('node:path');
const { Pool } = require('pg');
const { MongoClient } = require('mongodb');

async function main() {
  config({ path: resolve(__dirname, '../.env') });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, statement_timeout: 30000 });
  const mongo = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN READ ONLY');
    const counts = {};
    // Identifiers are a fixed source-controlled whitelist, never CLI input.
    for (const table of ['users', 'cooperatives', 'farms', 'zones', 'trees', 'devices', 'sensors', 'actuators', 'tree_harvests', 'farming_standards', 'agricultural_materials']) {
      counts[table] = Number((await client.query(`SELECT count(*) FROM public.${table}`)).rows[0].count);
    }
    const checks = {
      zone_area_exceeds_farm: `SELECT count(*) FROM (SELECT f.id FROM public.farms f JOIN public.zones z ON z.farm_id=f.id GROUP BY f.id HAVING sum(z.area_size)>f.area_size) q`,
      invalid_farm_owner: `SELECT count(*) FROM public.farms f JOIN public.users u ON u.id=f.owner_id WHERE u.role<>'Farmer' OR NOT u.is_owner`,
      invalid_attached_manager: `SELECT count(*) FROM public.cooperatives c JOIN public.users u ON u.id=c.manager_id WHERE u.role<>'Manager' OR u.status<>'Active' OR NOT u.gmail_verify`,
      duplicate_tree_harvest_date: `SELECT count(*) FROM (SELECT tree_id,harvest_date FROM public.tree_harvests GROUP BY tree_id,harvest_date HAVING count(*)>1) q`,
      inconsistent_batch_zone_or_date: `SELECT count(*) FROM (SELECT h.batch_code FROM public.tree_harvests h JOIN public.trees t ON t.id=h.tree_id GROUP BY h.batch_code HAVING count(DISTINCT t.zone_id)>1 OR count(DISTINCT h.harvest_date)>1) q`,
      future_harvest: `SELECT count(*) FROM public.tree_harvests WHERE harvest_date>(now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`,
      harvest_before_planting: `SELECT count(*) FROM public.tree_harvests h JOIN public.trees t ON t.id=h.tree_id WHERE h.harvest_date<(t.plant_date AT TIME ZONE 'Asia/Ho_Chi_Minh')::date`,
      tree_coordinates_outside_farm_proximity: `SELECT count(*) FROM public.trees t JOIN public.zones z ON z.id=t.zone_id JOIN public.farms f ON f.id=z.farm_id WHERE abs(t.latitude-f.latitude)>0.1 OR abs(t.longitude-f.longitude)>0.1`,
      placeholder_business_labels: `SELECT count(*) FROM (SELECT cooperative_name AS label FROM public.cooperatives UNION ALL SELECT address FROM public.farms UNION ALL SELECT zone_name FROM public.zones UNION ALL SELECT name FROM public.sensors UNION ALL SELECT name FROM public.actuators) q WHERE label ~* '(demo|mock|placeholder|lorem ipsum)'`,
    };
    const findings = {};
    for (const [name, sql] of Object.entries(checks)) findings[name] = Number((await client.query(sql)).rows[0].count);
    const hardwareMatches = Number((await client.query('SELECT count(*) FROM public.devices WHERE station_id=$1', [process.env.DEMO_DEVICE_STATION_ID || ''])).rows[0].count);
    await client.query('COMMIT');
    const db = mongo.db();
    const collections = {};
    for (const name of ['IOT_TELEMETRIES', 'ACTUATOR_TASKS', 'CULTIVATION_EVENTS', 'AI_DISEASE_DIAGNOSTICS', 'CHATBOT_CONVERSATIONS', 'AI_RAG_DOCUMENTS']) collections[name] = await db.collection(name).countDocuments();
    const cultivation = await db.collection('CULTIVATION_EVENTS').aggregate([{ $group: { _id: { action: '$action_type', target: '$target_type' }, count: { $sum: 1 } } }]).toArray();
    require('reflect-metadata');
    const { MongoCultivationStore } = require('../apps/api/dist/persistence/mongo-cultivation.store');
    // read() verifies the full persisted ledger, contexts and hashes; it never locks due records.
    await new MongoCultivationStore(mongo, db).read(() => true);
    console.log(JSON.stringify({ read_only: true, checked_at: new Date().toISOString(), counts, collections, findings,
      hardware_identifier_matches: hardwareMatches, cultivation_hash_chain: 'valid', cultivation_distribution: cultivation,
      note: 'Historical synthetic initialization remains synthetic. MQTT receipts are not proof of physical work. No personal details or credentials included.' }, null, 2));
    if (Object.values(findings).some((value) => value > 0)) process.exitCode = 1;
  } finally {
    client?.release();
    await Promise.allSettled([pool.end(), mongo.close()]);
  }
}
main().catch(() => { console.error('DATA_AUDIT_FAILED: check database availability and build the API first; no raw errors logged.'); process.exitCode = 1; });
