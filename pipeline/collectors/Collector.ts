import type { RawRecord } from '../types.js';

/**
 * 수집기 어댑터 인터페이스 (PRD v0.4 §6).
 *
 * S1 주도형(S1Collector)과 수기 주도형 폴백(ManualCollector)이 이 계약을 공유한다.
 * §12-G0 통과 여부와 무관하게 파이프라인 하류(정규화·검증·검수·게시)는 동일하게 동작하며,
 * 인증키가 열리면 수집기 구현만 교체한다.
 */
export interface Collector {
  /** 어댑터 이름 (로그·진단용). */
  readonly name: string;

  /** 의안(안건) 수집 → RawRecord[] (kind='agenda'). */
  collectBills(): Promise<RawRecord[]>;

  /** 회의록 수집 → RawRecord[] (kind='meeting'). */
  collectMinutes(): Promise<RawRecord[]>;

  /** 의원 정보 수집 → RawRecord[] (kind='member'). */
  collectMembers(): Promise<RawRecord[]>;

  /** 집행부 공보 수집 → RawRecord[] (kind='executive'). S1 은 해당 엔드포인트가 없어 빈 배열. */
  collectExecutives(): Promise<RawRecord[]>;
}

/** COLLECTOR 환경변수로 어댑터를 선택한다. 기본은 manual (G0 통과 전 폴백). */
export async function selectCollector(): Promise<Collector> {
  const which = (process.env.COLLECTOR ?? 'manual').toLowerCase();
  if (which === 's1') {
    const { S1Collector } = await import('./S1Collector.js');
    return new S1Collector();
  }
  if (which === 'manual') {
    const { ManualCollector } = await import('./ManualCollector.js');
    return new ManualCollector();
  }
  throw new Error(`알 수 없는 COLLECTOR=\"${which}\" (허용: s1 | manual)`);
}
