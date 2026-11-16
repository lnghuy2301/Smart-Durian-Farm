import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { createApplication } from './application';
import { readEnvironment } from './config/environment';

async function bootstrap() {
  config({ path: resolve(__dirname, '../../../.env') });
  const environment = readEnvironment(process.env);
  const app = await createApplication(environment);
  // Database mode may explicitly bind a container interface. Mock remains loopback-only.
  await app.listen(environment.port, environment.host ?? '127.0.0.1');
}

void bootstrap().catch(() => {
  console.error('API startup failed. Check configuration and dependencies.');
  // Startup may have constructed part of the database graph before failing.
  // Exit the owned process so partial pools and controller leases cannot linger.
  process.exit(1);
});
