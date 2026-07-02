import type { RawRecord } from './types.js';

/**
 * 정규화 (PRD v0.4 §6-②) — 수집기 RawRecord → §8 스키마 JSON 초안.
 *
 * - source='MANUAL': data 가 이미 §8 스키마에 가까운 형태(입력 폼 산출물). _meta 만 채워 통과.
 * - source='CLIK'(S1): API 필드명(BI_SJ 등)을 §8 필드로 매핑. ⚠️ G0 통과 후 실 응답 구조로 보정.
 *
 * 출력은 스키마 검증(scripts/validate-data.ts, CI)에서 최종 확인된다. 여기서는 형태만 만든다.
 * reviewed_by/at 은 항상 null 로 둔다 — 검수는 사람이 하는 실질 게이트(원칙 6).
 */

const today = (): string => new Date().toISOString().slice(0, 10);

export interface NormalizedRecord {
  kind: RawRecord['kind'];
  /** §8 스키마에 맞는 레코드 객체. */
  record: Record<string, unknown>;
}

export function normalize(raw: RawRecord): NormalizedRecord {
  const meta = buildMeta(raw);

  if (raw.source === 'MANUAL') {
    // 이미 스키마 형태 — _meta 를 덮어써 출처/수집일을 일관되게 채운다.
    return {
      kind: raw.kind,
      record: { ...raw.data, _meta: { ...(raw.data._meta as object), ...meta } },
    };
  }

  // S1(CLIK) 매핑
  switch (raw.kind) {
    case 'agenda':
      return { kind: 'agenda', record: mapAgendaFromS1(raw.data, meta) };
    case 'meeting':
      return { kind: 'meeting', record: mapMeetingFromS1(raw.data, meta) };
    case 'member':
      return { kind: 'member', record: mapMemberFromS1(raw.data, meta) };
    default:
      throw new Error(`정규화 미지원 kind: ${raw.kind}`);
  }
}

function buildMeta(raw: RawRecord): Record<string, unknown> {
  return {
    source_url: raw.sourceUrl,
    source_system: raw.source,
    snapshot_path: raw.snapshotPath,
    source_alive: true,
    collected_at: today(),
    reviewed_by: null,
    reviewed_at: null,
  };
}

// --- S1 필드 매핑 (2026-07-02 리소스센터 실제 명세 기준) ---

import { isPlaceholderDate } from './collectors/S1Collector.js';

function s(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

/** YYYYMMDD → YYYY-MM-DD. 플레이스홀더(19700101 등)/비정상은 null. */
function fmtDate(v: unknown): string | null {
  const raw = s(v).trim();
  if (isPlaceholderDate(raw) || !/^\d{8}$/.test(raw)) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

/** 대수(RASMBLY_NUMPR, 숫자) → "제10대". */
function fmtTerm(v: unknown): string {
  const n = s(v).trim();
  return n ? `제${n}대` : '제10대';
}

function mapAgendaFromS1(d: Record<string, unknown>, meta: object): Record<string, unknown> {
  const docid = s(d.DOCID);
  return {
    id: docid || `s1-bill-${s(d.BI_NO)}`,
    clik_docid: docid || null,
    title: s(d.BI_SJ),
    bill_no: s(d.BI_NO) || null,
    type: s(d.BI_KND_NM),
    proposer: { type: guessProposerType(s(d.PROPSR)), raw: s(d.PROPSR) },
    outline: s(d.BI_OUTLINE), // 상세 응답에만 존재할 수 있음
    timeline: buildTimelineFromS1(d),
    votes: { recorded: false, records: [] }, // API 기명표결 미제공(§3)
    related_members: [],
    related_dept: null,
    related_meetings: [],
    region_tags: [],
    files: splitFiles(d.BI_FILE_NM),
    _meta: meta,
  };
}

function guessProposerType(raw: string): '집행부' | '의원' | '위원장' {
  if (raw.includes('군수') || raw.includes('집행') || raw.includes('장(')) return '집행부';
  if (raw.includes('위원장')) return '위원장';
  return '의원';
}

/**
 * §8 타임라인 구성. 실제 상세 필드: ITNC_DE(제안), CMIT_PROCESS_DE/CMIT_RESULT(위원회),
 * PLNMT_PROCESS_DE/PLNMT_RESULT(본회의), TRNSF_DE(이송), PRMLGT_DE/PRMLGT_NO(공포).
 * 날짜가 플레이스홀더(19700101)인 단계는 넣지 않는다.
 */
function buildTimelineFromS1(d: Record<string, unknown>): unknown[] {
  const t: unknown[] = [];
  const push = (stage: string, dateRaw: unknown, extra?: Record<string, unknown>) => {
    const date = fmtDate(dateRaw);
    if (date) t.push({ stage, date, ...extra });
  };
  push('제안', d.ITNC_DE);
  push('위원회 심사', d.CMIT_PROCESS_DE, { result: s(d.CMIT_RESULT) || null });
  push('본회의 의결', d.PLNMT_PROCESS_DE ?? d.PLNMT_SBMISN_DE, { result: s(d.PLNMT_RESULT) || null });
  push('이송', d.TRNSF_DE);
  push('공포', d.PRMLGT_DE, { no: s(d.PRMLGT_NO) || null });
  return t;
}

/** BI_FILE_NM 은 개행(\n)으로 구분된 파일명 목록. */
function splitFiles(v: unknown): string[] {
  return s(v)
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function mapMeetingFromS1(d: Record<string, unknown>, meta: object): Record<string, unknown> {
  const docid = s(d.DOCID);
  const sesn = s(d.RASMBLY_SESN);
  return {
    id: docid || `s1-meeting-${s(d.MTG_DE)}`,
    clik_docid: docid || null,
    date: fmtDate(d.MTG_DE) ?? s(d.MTG_DE),
    type: s(d.MTGNM) || '본회의', // 회의명(본회의·상임위 등)
    session: sesn ? `제${sesn}회` : null,
    agendas: [],
    minutes_html: s(d.MINTS_HTML) || null, // 상세 응답에서 채워짐
    minutes_url: (meta as { source_url?: string }).source_url ?? '',
    _meta: meta,
  };
}

/** ⚠️ assemblyinfo.do 명세 미확인 — G0 실호출로 필드 확정 후 보정. */
function mapMemberFromS1(d: Record<string, unknown>, meta: object): Record<string, unknown> {
  return {
    id: `member-${s(d.MEMB_NO ?? d.SEQ ?? '0000').padStart(4, '0')}`,
    clik_docid: s(d.DOCID ?? d.MEMB_ID) || null,
    name: s(d.MEMB_NM ?? d.NM),
    photo_url: s(d.PHOTO_URL) || null,
    district: s(d.ELEC_DISTRICT ?? d.ELECT_DISTRICT) || null,
    party: s(d.PLPT_NM ?? d.PARTY_NM) || null,
    term: fmtTerm(d.RASMBLY_NUMPR),
    committees: [],
    links: [],
    _meta: meta,
  };
}
