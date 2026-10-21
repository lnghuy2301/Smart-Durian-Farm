import { Pool } from 'pg';
import { phoneIdentity } from '../auth/account-identity';
import { resolveControlRecipe } from '../actuator-tasks/task-rules';
import { PostgresUsersRepository } from './postgres-users.repository';

// Presence/configuration audit only. Never sends OTP/MQTT, creates accounts or
// prints phone/email/credential/hash/UUID. Verification still uses normal UI/API.
export async function demoReadiness(pool: Pool, env: NodeJS.ProcessEnv) {
  const users = new PostgresUsersRepository(pool);
  const primary = env.AUTH_TEST_PHONE ? (await users.loadByPhone(env.AUTH_TEST_PHONE))?.user : undefined;
  const admin = env.AUTH_TEST_ADMIN_PHONE ? (await users.loadByPhone(env.AUTH_TEST_ADMIN_PHONE))?.user : undefined;
  const hardware = (await pool.query(`SELECT d.id,d.status,f.owner_id,f.cooperative_id,c.manager_id
    FROM public.devices d JOIN public.zones z ON z.id=d.zone_id JOIN public.farms f ON f.id=z.farm_id
    LEFT JOIN public.cooperatives c ON c.id=f.cooperative_id WHERE d.station_id=$1`, [env.DEMO_DEVICE_STATION_ID ?? ''])).rows[0];
  const manager = hardware?.manager_id ? (await users.loadById(hardware.manager_id))?.user : undefined;
  const expected = [
    ['301', 'air_temperature', 'C'], ['302', 'air_humidity', '%'], ['303', 'soil_moisture', '%rH'],
    ['304', 'soil_temperature', 'C'], ['305', 'soil_ph', 'H+'], ['306', 'soil_ec', 'µS/cm'],
  ];
  const sensors = hardware ? (await pool.query('SELECT data_stream_id,sensor_type,unit,status FROM public.sensors WHERE device_id=$1', [hardware.id])).rows : [];
  const relays = hardware ? (await pool.query('SELECT capability_id::float8,purpose,status FROM public.actuators WHERE device_id=$1', [hardware.id])).rows : [];
  let controlReady = false;
  try { resolveControlRecipe(relays); controlReady = hardware.status === 'Active' && relays.every((relay) => relay.status === 'Active'); } catch { /* Missing/ambiguous metadata is reported, never guessed. */ }
  const mismatches = expected.filter(([stream, type, unit]) => !sensors.some((sensor) => sensor.data_stream_id === stream
    && sensor.sensor_type === type && sensor.unit === unit && sensor.status === 'Active')).map(([stream]) => stream);
  const allowed = (phone: string | undefined, list: string | undefined) => !!phone && (list ?? '').split(',').some((item) => phoneIdentity(item.trim()) === phoneIdentity(phone));
  const counts = (await pool.query(`SELECT COUNT(*) FILTER(WHERE role='Farmer' AND status='Active')::int AS active_farmers,
    COUNT(*) FILTER(WHERE role='Manager' AND status='Active' AND gmail_verify)::int AS active_verified_managers,
    COUNT(*) FILTER(WHERE role='Admin' AND status='Active')::int AS active_admins FROM public.users`)).rows[0];
  const twilioConfigured = env.SMS_PROVIDER === 'twilio' && env.LIVE_SMS_ENABLED === 'true'
    && !!env.TWILIO_ACCOUNT_SID && !!env.TWILIO_AUTH_TOKEN;
  return {
    primary_farmer_ready: primary?.role === 'Farmer' && primary.status === 'Active' && primary.is_owner,
    primary_admin_ready: admin?.role === 'Admin' && admin.status === 'Active',
    hardware_registered: !!hardware, hardware_owned_by_primary: !!primary && hardware?.owner_id === primary.id,
    hardware_farm_in_cooperative: !!hardware?.cooperative_id,
    hardware_manager_ready: manager?.role === 'Manager' && manager.status === 'Active' && manager.gmail_verify,
    sensor_streams_needing_metadata_review: mismatches, control_metadata_ready: controlReady,
    primary_sms_configuration_present: twilioConfigured
      && !!env.TWILIO_VERIFY_SERVICE_SID && allowed(primary?.phone_number, env.SMS_ALLOWED_PHONE),
    manager_email_sms_configuration_present: twilioConfigured && env.EMAIL_PROVIDER === 'smtp'
      && !!env.SMTP_USER && !!env.SMTP_PASSWORD && !!env.SMTP_FROM && !!env.TWILIO_HTX_VERIFY_SERVICE_SID
      && allowed(manager?.phone_number, env.HTX_SMS_ALLOWED_PHONES),
    accounts: counts,
  };
}
