import { BadRequestException } from '@nestjs/common';

export const CANDIDATE_LIMIT = 20;
export interface AssignmentCandidate {
  id: string;
  user_name: string;
  phone_number: string;
  previously_assigned: boolean;
}
export interface AssignmentCandidates {
  items: AssignmentCandidate[];
  has_more: boolean;
}
export function candidateName(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');
}
export function candidateSearch(value = ''): { name: string; phone: string | null } {
  const q = value.trim().normalize('NFC');
  if (q.length > 100 || (q.length > 0 && [...q].length < 2)) {
    throw new BadRequestException('Nhập ít nhất 2 ký tự tên, tối đa 100 ký tự');
  }
  if (/^\+?\d[\d\s().-]*$/.test(q)) {
    const digits = q.replace(/\D/g, '');
    if (digits.length < 4) throw new BadRequestException('Nhập ít nhất 4 chữ số điện thoại');
    return { name: q.toLowerCase(), phone: digits.replace(/^0/, '84') };
  }
  return { name: candidateName(q), phone: null };
}
