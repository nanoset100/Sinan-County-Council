import type { Collector } from './Collector.js';
import type { RawRecord, RecordKind } from '../types.js';

/**
 * S1 수집기 — 국회도서관 지방의정포털 Open API (clik.nanet.go.kr) (PRD v0.4 §4 S1, §6-①).
 *
 * 2026-07-02 리소스센터 실제 명세로 확정(회의록·의안). 응답은 JSON 최상위 배열:
 *   [{ "SERVICE":"bill", "RESULT_CODE":"SUCCESS", "TOTAL_COUNT":40378, "LIST_COUNT":5,
 *      "LIST":[ { "ROW": { ...필드... } }, ... ] }]
 *   목록: json[0].LIST[].ROW   /   상세: json[0] 에 필드 직접(SERVICE/RESULT_* 메타 동거).
 *
 * 제약(확인됨): 호출당 최대 100건(listCount), 인증키당 일 1,000회. 주 2회 증분 수집(§9).
 *
 * ⚠️ 남은 미확정: 신안군 rasmblyId 코드값(리소스센터 rasmblyId '목록 보기'에서 확인),
 *    assemblyinfo.do(의원) 명세, 사용자 대면 정본 URL 패턴 → §12-G0 실호출 시 최종 확정.
 */

const BASE_URL = process.env.S1_BASE_URL ?? 'https://clik.nanet.go.kr/openapi';
const PAGE_SIZE = 100; // listCount 상한
const DAILY_CALL_LIMIT = 1000; // 인증키당 상한
const EPOCH_PLACEHOLDER = new Set(['', '19700101', '00000000']); // "없음"을 뜻하는 날짜 값

interface Envelope {
  SERVICE?: string;
  RESULT_CODE?: string;
  RESULT_MESSAGE?: string;
  TOTAL_COUNT?: number;
  LIST_COUNT?: number;
  LIST?: Array<{ ROW: Record<string, unknown> }>;
  [key: string]: unknown;
}

export class S1Collector implements Collector {
  readonly name = 'S1Collector(clik.nanet.go.kr)';

  private readonly apiKey: string;
  private readonly rasmblyId: string;
  private readonly fetchDetail: boolean;
  private callCount = 0;

  constructor() {
    const apiKey = process.env.S1_API_KEY;
    const rasmblyId = process.env.S1_RASMBLY_ID;
    if (!apiKey) {
      throw new Error(
        'S1_API_KEY 미설정 — S1 수집기를 쓰려면 인증키가 필요합니다. ' +
          'docs/G0-api-key-request.md 참조. 인증키 확보 전에는 COLLECTOR=manual 을 사용하세요.',
      );
    }
    if (!rasmblyId) {
      throw new Error(
        'S1_RASMBLY_ID 미설정 — 신안군의회 rasmblyId 코드를 리소스센터의 rasmblyId "목록 보기"에서 확인해 .env 에 넣으세요.',
      );
    }
    this.apiKey = apiKey;
    this.rasmblyId = rasmblyId;
    this.fetchDetail = (process.env.S1_FETCH_DETAIL ?? 'true') !== 'false';
  }

  /** 의안(안건) — bill.do. 목록 + (옵션) 상세 병합. */
  async collectBills(): Promise<RawRecord[]> {
    return this.collectListWithDetail('bill.do', 'agenda', (row) => String(row.BI_OUTLINE ?? row.BI_SJ ?? ''));
  }

  /** 회의록 — minutes.do. 목록 + (옵션) 상세(MINTS_HTML) 병합. */
  async collectMinutes(): Promise<RawRecord[]> {
    return this.collectListWithDetail('minutes.do', 'meeting', (row) => stripHtml(String(row.MINTS_HTML ?? '')));
  }

  /** 의원 — assemblyinfo.do. ⚠️ 명세 미확인(목록만, 상세 없음). G0 후 필드 확정. */
  async collectMembers(): Promise<RawRecord[]> {
    const rows = await this.fetchList('assemblyinfo.do');
    return rows.map((row) => this.toRaw('member', row, ''));
  }

  private async collectListWithDetail(
    endpoint: string,
    kind: RecordKind,
    sourceTextOf: (row: Record<string, unknown>) => string,
  ): Promise<RawRecord[]> {
    const rows = await this.fetchList(endpoint);
    const out: RawRecord[] = [];
    for (const row of rows) {
      let merged = row;
      const docid = String(row.DOCID ?? '');
      if (this.fetchDetail && docid) {
        const detail = await this.fetchDetailRow(endpoint, docid);
        if (detail) merged = { ...row, ...detail };
      }
      out.push(this.toRaw(kind, merged, sourceTextOf(merged)));
    }
    return out;
  }

  private toRaw(kind: RecordKind, row: Record<string, unknown>, sourceText: string): RawRecord {
    const collection = kind === 'meeting' ? 'minutes' : kind === 'agenda' ? 'bill' : 'member';
    const docid = String(row.DOCID ?? '');
    return {
      kind,
      source: 'CLIK',
      // 사용자 대면 정본 URL. ⚠️ 정확한 공개 상세 URL 패턴은 G0 실호출 시 확정(현재 best-effort).
      sourceUrl:
        pickUrl(row) ?? `https://clik.nanet.go.kr/potal/search/searchDetail.do?collection=${collection}&docId=${docid}`,
      snapshotPath: null, // 스냅샷 저장은 별도 단계(§4)에서 채운다
      data: row,
      sourceText,
    };
  }

  /** 목록(displayType=list) 전체를 페이지네이션으로 수집. */
  private async fetchList(endpoint: string): Promise<Array<Record<string, unknown>>> {
    const out: Array<Record<string, unknown>> = [];
    let startCount = 0;

    while (true) {
      const env = await this.request(endpoint, {
        displayType: 'list',
        startCount: String(startCount),
        listCount: String(PAGE_SIZE),
        searchType: 'ALL',
      });
      const rows = (env.LIST ?? []).map((x) => x.ROW);
      out.push(...rows);

      const total = typeof env.TOTAL_COUNT === 'number' ? env.TOTAL_COUNT : out.length;
      if (rows.length < PAGE_SIZE || out.length >= total) break;
      startCount += PAGE_SIZE;
    }
    return out;
  }

  /** 상세(displayType=detail) 단건. 필드는 json[0] 에 직접 존재. */
  private async fetchDetailRow(endpoint: string, docid: string): Promise<Record<string, unknown> | null> {
    const env = await this.request(endpoint, { displayType: 'detail', docid });
    // 메타 키를 제외한 나머지를 상세 필드로 사용한다.
    const { SERVICE, RESULT_CODE, RESULT_MESSAGE, TOTAL_COUNT, LIST_COUNT, LIST, ...fields } = env;
    return Object.keys(fields).length > 0 ? fields : null;
  }

  private async request(endpoint: string, params: Record<string, string>): Promise<Envelope> {
    this.guardRateLimit();
    const url = new URL(`${BASE_URL}/${endpoint}`);
    url.searchParams.set('key', this.apiKey);
    url.searchParams.set('type', 'json');
    url.searchParams.set('rasmblyId', this.rasmblyId);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    this.callCount++;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`S1 ${endpoint} 호출 실패: HTTP ${res.status}`);

    const json = (await res.json()) as Envelope[];
    const env = Array.isArray(json) ? json[0] : (json as Envelope);
    if (!env) throw new Error(`S1 ${endpoint} 응답이 비었습니다.`);
    if (env.RESULT_CODE && env.RESULT_CODE !== 'SUCCESS') {
      throw new Error(`S1 ${endpoint} 오류: ${env.RESULT_CODE} ${env.RESULT_MESSAGE ?? ''}`);
    }
    return env;
  }

  private guardRateLimit(): void {
    if (this.callCount >= DAILY_CALL_LIMIT) {
      throw new Error(
        `S1 일일 호출 상한(${DAILY_CALL_LIMIT}) 도달 — 증분 수집으로 분할하세요(§9). ` +
          '(상세 조회를 끄려면 S1_FETCH_DETAIL=false)',
      );
    }
  }
}

/** "없음" 플레이스홀더 날짜인지. (19700101/빈값 등) */
export function isPlaceholderDate(yyyymmdd: string | undefined | null): boolean {
  if (!yyyymmdd) return true;
  const v = String(yyyymmdd).trim();
  return EPOCH_PLACEHOLDER.has(v) || v.startsWith('1900');
}

function pickUrl(row: Record<string, unknown>): string | null {
  const u = row.ORGINL_FILE_URL;
  return typeof u === 'string' && /^https?:\/\//.test(u) ? u : null;
}

/** MINTS_HTML 근거 대조용 평문화(태그·엔티티 제거). 표시용 정제는 별도(F6). */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
