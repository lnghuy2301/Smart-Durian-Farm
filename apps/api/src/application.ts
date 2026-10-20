import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { Environment } from './config/environment';

export async function createApplication(config: Environment, logger: false | undefined = undefined) {
  const app = await NestFactory.create(AppModule.register(config), { logger });
  configureApplication(app, config);
  return app;
}

export function configureApplication(app: INestApplication, config: Environment): void {
  // Từ chối field ngoài DTO để client không tự truyền các thuộc tính nhạy cảm vào nghiệp vụ.
  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.corsOrigins });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableShutdownHooks();
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Smart Durian Farm API')
    .setDescription((config.storage === 'database'
      ? 'Database runtime: shared PostgreSQL accounts/catalogs/metadata/workflows and MongoDB telemetry, actuator task journal and cultivation chain. Restart retains business data; unfinished OTP requires verification again. '
      : 'Isolated memory runtime for tests: business data is lost on restart. ')
      + 'Private APIs require JWT and current resource scope. Owner/admin approvals, assignment intervals and original correction authority remain enforced. MQTT uses registered station IDs, six sensor streams and taskId/action-correlated ACK receipts only; physical state remains Unknown. Commands use valve-before-pump ON, pump-before-valves OFF,10s per step, pre-start reset, preemption and recovery. Public QR exposes only whitelisted metadata, Locked correction lineages and approved harvest contents. Startup never migrates, seeds or publishes commands automatically; readiness checks database connectivity.')
    // Trạng thái quản trị của trạm tách biệt connectivity suy ra từ MQTT last_seen_at.
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);
}
