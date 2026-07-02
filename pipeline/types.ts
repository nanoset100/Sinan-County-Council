/**
 * 파이프라인 공통 타입 (PRD v0.4 §6, §8).
 *
 * 수집기(Collector)는 RawRecord 를 방출하고, Normalizer 가 이를 §8 스키마 레코드로 변환한다.
 * 두 수집기(S1 / Manual)가 같은 RawRecord 계약을 공유하므로, G0 통과 시 어댑터만 교체하면 된다.
 */

export type RecordKind = 'agenda' | 'meeting' | 'member' | 'executive';
export type SourceSystem = 'CLIK' | 'SHINAN_COUNCIL' | 'ELIS' | 'SHINAN_GUN' | 'MANUAL';

/** 수집기가 방출하는 정규화 이전 원시 레코드. */
export interface RawRecord {
  kind: RecordKind;
  /** 이 원시 레코드가 유래한 소스 시스템. _meta.source_system 이 된다. */
  source: SourceSystem;
  /** 원문 문서 URL (정본). _meta.source_url 이 된다. */
  sourceUrl: string;
  /**
   * 수집 시점 원문 사본 경로 (§4 스냅샷). 없으면 null.
   */
  snapshotPath: string | null;
  /**
   * S1 어댑터: API 필드명(BI_SJ 등)을 담은 객체.
   * Manual 어댑터: 이미 §8 스키마에 가까운 객체(운영자 입력 폼 산출물).
   */
  data: Record<string, unknown>;
  /**
   * 근거 대조용 원문 텍스트 (Verifier grounding 에서 사용). 회의록 본문/의안요지 등.
   * 없으면 빈 문자열 — 이 경우 grounding 은 통과시키지 않는다.
   */
  sourceText: string;
}

/** 공통 앵커 (§8 인용문 폴백). */
export interface Anchor {
  url: string;
  fragment?: string;
  quote?: string;
}

/** AI 생성 블록 (§8, §14-4). */
export interface AiContent {
  generated_at: string;
  model: string;
  verifier_passed: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
  summary_one_line: string;
  what_changes?: Array<{ text: string; anchor: Anchor }>;
  who_affected?: { text: string; anchor: Anchor };
}

/** Verifier 결과. */
export interface VerifierResult {
  passed: boolean;
  /** 실패 사유(사람 검수·로깅용). 통과 시 빈 배열. */
  failures: VerifierFailure[];
}

export interface VerifierFailure {
  check: 'grounding' | 'forbidden-terms' | 'anchor-integrity';
  message: string;
  /** 문제된 토큰/어휘/문단 등 세부. */
  detail?: string;
}
