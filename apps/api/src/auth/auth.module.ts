import { DynamicModule, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MockAuthConfig } from '../config/environment';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { MockUserStore } from './mock-user.store';
import { UserAccounts } from './user-accounts';
import { DisabledSmsGateway, MockSmsGateway, SmsGateway } from './sms/sms.gateway';
import { SpeedSmsGateway } from './sms/speedsms.gateway';
import { LocalOtpProvider, OtpProvider } from './sms/otp.provider';
import { TwilioVerifyGateway } from './sms/twilio-verify.gateway';
import { PostgresUsersRepository } from '../persistence/postgres-users.repository';

@Module({})
export class AuthModule {
  static forDatabase(config: MockAuthConfig, persistenceModule: DynamicModule): DynamicModule {
    const module = this.register(config);
    module.imports!.push(persistenceModule);
    module.providers = module.providers!.filter((provider) => typeof provider !== 'object'
      || !('provide' in provider) || ![MockUserStore, UserAccounts].includes(provider.provide as typeof MockUserStore));
    module.providers.push({ provide: UserAccounts, useExisting: PostgresUsersRepository });
    module.exports = [UserAccounts, AuthGuard, AuthService];
    return module;
  }
  static forMock(config: MockAuthConfig): DynamicModule {
    if (config.mode !== 'mock') throw new Error('Memory Auth cannot use database account mode');
    return this.register(config);
  }
  private static register(config: MockAuthConfig): DynamicModule {
    return {
      module: AuthModule,
      imports: [JwtModule.register({
        secret: config.jwtSecret,
        signOptions: { algorithm: 'HS256', issuer: config.mode === 'database' ? 'smart-durian' : 'smart-durian-local-test', audience: 'smart-durian-client' },
        verifyOptions: { algorithms: ['HS256'], issuer: config.mode === 'database' ? 'smart-durian' : 'smart-durian-local-test', audience: 'smart-durian-client' },
      })],
      controllers: [AuthController],
      exports: [MockUserStore, UserAccounts, AuthGuard, AuthService],
      providers: [
        { provide: MockUserStore, useFactory: () => MockUserStore.create(config) },
        // Alias cùng instance; không tạo store thứ hai cho Auth.
        { provide: UserAccounts, useExisting: MockUserStore },
        { provide: SmsGateway, useFactory: () => config.sms.provider === 'speedsms' ? new SpeedSmsGateway(config.sms)
          : config.sms.provider === 'mock' ? new MockSmsGateway() : new DisabledSmsGateway() },
        { provide: OtpProvider, inject: [SmsGateway], useFactory: (sms: SmsGateway) =>
          config.sms.provider === 'twilio' ? new TwilioVerifyGateway(config.sms) : new LocalOtpProvider(sms) },
        AuthService, AuthGuard,
      ],
    };
  }
}
