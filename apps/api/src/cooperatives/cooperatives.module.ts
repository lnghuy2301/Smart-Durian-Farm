import { DynamicModule, Module, Provider } from '@nestjs/common';
import { MockAuthConfig } from '../config/environment';
import { LocalOtpProvider } from '../auth/sms/otp.provider';
import { MockSmsGateway } from '../auth/sms/sms.gateway';
import { TwilioVerifyGateway } from '../auth/sms/twilio-verify.gateway';
import { COOPERATIVE_OTP_PROVIDER, DisabledCooperativeOtpProvider } from './cooperative-otp.provider';
import { CooperativesController, CooperativeNotificationsController, CooperativeUpdateRequestsController } from './cooperatives.controller';
import { CooperativesService } from './cooperatives.service';
import { CooperativeRecords } from './cooperative-records';
import { MemoryCooperativeRecords } from './memory-cooperative-records';
import { MockUserStore } from '../auth/mock-user.store';
import { MockCooperativeStore } from '../users/mock-cooperative.store';
import { FarmsService } from '../farms/farms.service';

@Module({})
export class CooperativesModule {
  static forMock(config: MockAuthConfig, authModule: DynamicModule, usersModule: DynamicModule, farmsModule: DynamicModule): DynamicModule {
    return this.forRecords(config, authModule, usersModule,
      { provide: CooperativeRecords, inject: [MockUserStore, MockCooperativeStore, FarmsService],
        useFactory: (users: MockUserStore, store: MockCooperativeStore, farms: FarmsService) => new MemoryCooperativeRecords(users, store, farms) }, [farmsModule]);
  }

  // Seam cho wiring database theo giai đoạn; provider phải dùng registry/pool
  // chung với USERS. AppModule hiện vẫn gọi forMock, không mở mixed runtime.
  static forRecords(config: MockAuthConfig, authModule: DynamicModule, usersModule: DynamicModule, records: Provider, imports: DynamicModule[] = []): DynamicModule {
    return {
      module: CooperativesModule, imports: [authModule, usersModule, ...imports],
      controllers: [CooperativesController, CooperativeNotificationsController, CooperativeUpdateRequestsController],
      providers: [CooperativesService, records, {
        provide: COOPERATIVE_OTP_PROVIDER,
        useFactory: () => config.sms.provider === 'mock' ? new LocalOtpProvider(new MockSmsGateway())
          : config.cooperativeSms ? new TwilioVerifyGateway(config.cooperativeSms) : new DisabledCooperativeOtpProvider(),
      }], exports: [CooperativesService, CooperativeRecords],
    };
  }
}
