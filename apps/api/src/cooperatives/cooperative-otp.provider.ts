import { ServiceUnavailableException } from '@nestjs/common';
import { OtpProvider, OtpProof } from '../auth/sms/otp.provider';

export const COOPERATIVE_OTP_PROVIDER = Symbol('COOPERATIVE_OTP_PROVIDER');

// Không tự chuyển sang mock khi hệ thống đang dùng SMS thật nhưng thiếu cấu hình HTX.
export class DisabledCooperativeOtpProvider extends OtpProvider {
  readonly mode = 'twilio' as const;
  async issue(): Promise<OtpProof> {
    throw new ServiceUnavailableException('Cấu hình HTX_SMS_ALLOWED_PHONES để xác minh sửa HTX; SID HTX để trống sẽ dùng TWILIO_VERIFY_SERVICE_SID');
  }
  async verify(): Promise<boolean> { return false; }
  clear(): void {}
  messages(): [] { return []; }
}
