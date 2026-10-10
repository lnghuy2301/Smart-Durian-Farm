import { validateSync } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { CreateDeviceDto } from '../devices/devices.dto';
import { phoneIdentity } from '../auth/account-identity';
export { phoneIdentity } from '../auth/account-identity';

export interface SeedConfig {
  farmer: { phone: string; password: string };
  admin: { phone: string; password: string };
  device: { stationId: string; installedAt: string; cost: number };
}

export function readSeedConfig(env: NodeJS.ProcessEnv): SeedConfig {
  // Preflight không dùng readEnvironment/Auth providers: seed không cần gửi OTP,
  // không khởi tạo Nest/MQTT và không buộc có SMTP/Twilio credentials.
  if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') { throw new Error('Seed requires NODE_ENV=development or test'); }
  const account = (phoneKey: string, passwordKey: string) => {
    const phone = env[phoneKey] ?? '';
    const password = env[passwordKey] ?? '';
    if (!/^\+?\d{9,13}$/.test(phone) || phone.length > 13) { throw new Error(`Invalid ${phoneKey}`); }
    if (password.length < 8 || password.length > 128) { throw new Error(`Invalid ${passwordKey}`); }
    return { phone, password };
  };
  const farmer = account('AUTH_TEST_PHONE', 'AUTH_TEST_PASSWORD');
  const admin = account('AUTH_TEST_ADMIN_PHONE', 'AUTH_TEST_ADMIN_PASSWORD');
  const samplePhones = ['0990000011', '0990000012'];
  if (phoneIdentity(farmer.phone) === phoneIdentity(admin.phone) ||
      [farmer.phone, admin.phone].some((phone) => samplePhones.map(phoneIdentity).includes(phoneIdentity(phone)))) {
    throw new Error('Seed account identities collide');
  }
  const allowed = `${env.SMS_ALLOWED_PHONE ?? ''},${env.HTX_SMS_ALLOWED_PHONES ?? ''}`.split(',').filter(Boolean).map((phone) => phoneIdentity(phone.trim()));
  if (samplePhones.some((phone) => allowed.includes(phoneIdentity(phone)))) { throw new Error('Synthetic seed phone must not be SMS allowlisted'); }
  const stationId = env.DEMO_DEVICE_STATION_ID?.trim() ?? '';
  const installedAt = env.DEMO_DEVICE_INSTALLED_AT ?? '';
  const costText = env.DEMO_DEVICE_COST ?? '';
  if (!/^\d+(\.\d{1,2})?$/.test(costText)) { throw new Error('Invalid DEMO_DEVICE_COST'); }
  const dto = Object.assign(new CreateDeviceDto(), { zone_id: randomUUID(), station_id: stationId, installed_at: installedAt, cost: Number(costText) });
  const errors = validateSync(dto);
  if (errors.length) {
    const names: Record<string, string> = { station_id: 'DEMO_DEVICE_STATION_ID', installed_at: 'DEMO_DEVICE_INSTALLED_AT', cost: 'DEMO_DEVICE_COST' };
    throw new Error(`Invalid ${errors.map((error) => names[error.property] ?? error.property).join(', ')}`);
  }
  if (['SIM_DEMO_001', 'SIM_DEMO_002'].includes(stationId)) { throw new Error('Real station collides with synthetic namespace'); }
  return { farmer, admin, device: { stationId, installedAt: new Date(installedAt).toISOString(), cost: Number(costText) } };
}
