import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { selectDrafter, ClaudeAiDrafter } from '../pipeline/ai-drafter.js';
import { verify } from '../pipeline/verifier/index.js';
import type { AiContent } from '../pipeline/types.js';

// .env 자동 로드(있으면). 키를 셸/전사에 노출하지 않도록 .env 저장만으로 실행되게 한다.
try { process.loadEnvFile(); } catch { /* .env 없으면 무시 */ }

/**
 * §12-3 A1 품질 파일럿 (PRD v0.5).
 *
 * A1 근거 원문(의안요지)은 두 경로로 공급한다:
 *   1) --input=<파일>: [{ "title","sourceText","sourceUrl" }] 배열. **권장** — S2(의회 홈페이지)에서
 *      실제 의안요지를 옮겨 넣어 품질을 측정한다(fixtures/pilot/_template.json 참고).
 *   2) S1_API_KEY: 이웃 군의회(기본 영광 061015)에서 수집. ⚠️ **S1 bill.do 는 의안요지 본문을
 *      제공하지 않아**(제목·메타만) A1 품질 측정에는 부적합 — 플러밍 확인용으로만.
 *
 * 측정: ⓐ Verifier 통과율 ⓑ 건당 생성 시간 ⓒ 토큰 사용량/비용(추정) ⓓ 사람 오탐/미탐 라벨링용 산출.
 * 산출물: .pipeline-out/pilot/ 에 건별 JSON + report.json. (게시 아님 → §5 위반 아님)
 *
 * 실행: ANTHROPIC_API_KEY=... npm run pilot -- --input=fixtures/pilot/mine.json
 *   (ANTHROPIC_API_KEY 없으면 MockAiDrafter 로 플러밍만 검증 — 품질 측정 아님)
 */

const BASE = process.env.S1_BASE_URL ?? 'https://clik.nanet.go.kr/openapi';
const OUT = join(process.cwd(), '.pipeline-out', 'pilot');

function arg(name: string, def: string): string {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? def;
}

interface Bill { docid: string; title: string; sourceText: string; sourceUrl: string; usedOutline: boolean }

async function s1(endpoint: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`${BASE}/${endpoint}`);
  url.searchParams.set('key', process.env.S1_API_KEY!);
  url.searchParams.set('type', 'json');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  const json = (await res.json()) as any[];
  return Array.isArray(json) ? json[0] : json;
}

/** 영광군 의안 목록→상세에서 BI_OUTLINE 이 있는 건을 n개 모은다. */
async function fetchBills(rasmblyId: string, n: number): Promise<Bill[]> {
  const list = await s1('bill.do', {
    displayType: 'list', startCount: '0', listCount: '60',
    searchType: 'BI_SJ', searchKeyword: '', rasmblyId, sort: 'ITNC_DE/DESC',
  });
  const rows: any[] = (list.LIST ?? []).map((x: any) => x.ROW);
  const out: Bill[] = [];
  for (const row of rows) {
    if (out.length >= n) break;
    const docid = String(row.DOCID ?? '');
    if (!docid) continue;
    const detail = await s1('bill.do', { displayType: 'detail', docid });
    const outline = String(detail.BI_OUTLINE ?? '').trim();
    const title = String(detail.BI_SJ ?? row.BI_SJ ?? '');
    out.push({
      docid,
      title,
      sourceText: outline || title,
      usedOutline: outline.length > 0,
      sourceUrl: `https://clik.nanet.go.kr/potal/search/searchDetail.do?collection=bill&docId=${docid}`,
    });
  }
  return out;
}

async function loadInput(file: string): Promise<Bill[]> {
  const arr = JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, '')) as Array<{ title: string; sourceText: string; sourceUrl: string }>;
  return arr.map((x, i) => ({
    docid: `input-${String(i + 1).padStart(3, '0')}`,
    title: x.title, sourceText: x.sourceText, sourceUrl: x.sourceUrl, usedOutline: true,
  }));
}

async function main(): Promise<void> {
  const n = parseInt(arg('n', '10'), 10);
  const rasmblyId = arg('rasmbly', process.env.S1_RASMBLY_ID ?? '061015');
  const inputFile = process.argv.find((a) => a.startsWith('--input='))?.split('=')[1];

  const drafter = selectDrafter();
  const isMock = !(drafter instanceof ClaudeAiDrafter);
  if (isMock) console.warn('⚠️ ANTHROPIC_API_KEY 미설정 → MockAiDrafter. 플러밍만 검증(품질 측정 아님).');

  let bills: Bill[];
  if (inputFile) {
    bills = (await loadInput(inputFile)).slice(0, n);
    console.log(`[파일럿] 입력 파일에서 원문 ${bills.length}건 로드: ${inputFile}`);
  } else if (process.env.S1_API_KEY) {
    console.warn('⚠️ S1 bill.do 는 의안요지 본문을 제공하지 않습니다(제목만). 품질 측정엔 --input 파일 사용 권장.');
    console.log(`[파일럿] 대상 의회 rasmblyId=${rasmblyId}, 목표 ${n}건 수집 중...`);
    bills = await fetchBills(rasmblyId, n);
    console.log(`[파일럿] 원문 확보 ${bills.length}건 (BI_OUTLINE 사용 ${bills.filter((b) => b.usedOutline).length}건)`);
  } else {
    console.error('원문 공급원이 없습니다. --input=<파일> 또는 S1_API_KEY 중 하나가 필요합니다.');
    process.exit(2);
  }

  await rm(OUT, { recursive: true, force: true }); // 이전 실행의 산출물 제거(결과 혼선 방지)
  await mkdir(OUT, { recursive: true });
  let passed = 0;
  let totalMs = 0;
  let inTok = 0;
  let outTok = 0;
  const items: any[] = [];

  for (const [i, bill] of bills.entries()) {
    const t0 = Date.now();
    let ai: AiContent | null = null;
    let genError: string | null = null;
    try {
      ai = await drafter.draftAgendaSummary(bill);
    } catch (e) {
      genError = (e as Error).message;
    }
    const ms = Date.now() - t0;
    totalMs += ms;
    if (drafter instanceof ClaudeAiDrafter && drafter.lastUsage) {
      inTok += drafter.lastUsage.input_tokens;
      outTok += drafter.lastUsage.output_tokens;
    }

    const result = ai ? verify(ai, bill.sourceText) : { passed: false, failures: [{ check: 'grounding', message: genError ?? '생성 실패' }] };
    if (result.passed) passed++;

    const record = {
      docid: bill.docid, title: bill.title, usedOutline: bill.usedOutline,
      sourceText: bill.sourceText, sourceUrl: bill.sourceUrl,
      generated: ai, verifier: result, ms,
      // 사람 검수용 — 나중에 채운다(오탐/미탐 판정):
      human_label: { verifier_correct: null, summary_accurate: null, note: '' },
    };
    items.push({ docid: bill.docid, title: bill.title, verifierPassed: result.passed, ms });
    await writeFile(join(OUT, `${String(i + 1).padStart(2, '0')}-${bill.docid}.json`), JSON.stringify(record, null, 2), 'utf8');
  }

  const priceIn = parseFloat(process.env.ANTHROPIC_PRICE_IN ?? '0'); // $/1M input tokens
  const priceOut = parseFloat(process.env.ANTHROPIC_PRICE_OUT ?? '0');
  const cost = (inTok / 1e6) * priceIn + (outTok / 1e6) * priceOut;

  const report = {
    ran_at: new Date().toISOString(),
    model: drafter instanceof ClaudeAiDrafter ? drafter.model : 'mock',
    rasmblyId,
    count: bills.length,
    verifier_pass_rate: bills.length ? +(passed / bills.length).toFixed(3) : 0,
    avg_ms: bills.length ? Math.round(totalMs / bills.length) : 0,
    tokens: { input: inTok, output: outTok },
    cost_estimate_usd: priceIn || priceOut ? +cost.toFixed(4) : null,
    items,
  };
  await writeFile(join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8');

  console.log('\n=== §12-3 파일럿 결과 ===');
  console.log(`모델: ${report.model} · 건수: ${report.count}`);
  console.log(`Verifier 통과율: ${(report.verifier_pass_rate * 100).toFixed(1)}%  (통과 ${passed}/${bills.length})`);
  console.log(`건당 평균 생성시간: ${report.avg_ms}ms`);
  console.log(`토큰: 입력 ${inTok} · 출력 ${outTok}${report.cost_estimate_usd !== null ? ` · 추정비용 $${report.cost_estimate_usd}` : ' (비용은 ANTHROPIC_PRICE_IN/OUT 로 산출)'}`);
  console.log(`\n산출물: ${OUT}`);
  console.log('→ 각 파일의 human_label 을 채워 오탐/미탐을 판정하세요(§12-3 ⓑ). Verifier·프롬프트 확정 후 본 가동.');
  if (isMock) console.log('※ Mock 실행이므로 통과율/시간은 품질 지표가 아닙니다. 실측은 ANTHROPIC_API_KEY 로.');
}

main().catch((err) => {
  console.error('[파일럿 오류]', err instanceof Error ? err.message : err);
  process.exit(1);
});
