import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { selectCollector } from './collectors/Collector.js';
import { normalize, type NormalizedRecord } from './normalize.js';
import { selectDrafter } from './ai-drafter.js';
import { verify } from './verifier/index.js';
import { diffRecord, type DiffEntry } from './differ.js';
import type { RawRecord } from './types.js';

// .env 자동 로드(있으면). COLLECTOR=s1 등에서 키를 .env 로만 공급할 수 있게 한다.
try { process.loadEnvFile(); } catch { /* .env 없으면 무시 */ }

/**
 * 파이프라인 오케스트레이션 (PRD v0.4 §6).
 *   수집 → 정규화 → AI 초안(A1) → Verifier(스크리닝) → 변경 감지.
 *
 * 배치 1 범위: 흐름 검증. 정규화 결과와 초안을 .pipeline-out/ 스테이징에 쓰고 diff 요약을 출력한다.
 * 실제 게시는 사람 검수(원칙 6) → 머지 → CI 배포. 이 스크립트는 절대 data/ 를 직접 쓰지 않는다.
 *
 * 어댑터는 COLLECTOR 환경변수로 선택(기본 manual). 키가 없으면 s1 은 명확히 실패한다.
 */

const STAGING = join(process.cwd(), '.pipeline-out');

async function main(): Promise<void> {
  const collector = await selectCollector();
  console.log(`[수집기] ${collector.name}`);

  const drafter = selectDrafter();

  const raw: RawRecord[] = [
    ...(await collector.collectBills()),
    ...(await collector.collectMinutes()),
    ...(await collector.collectMembers()),
    ...(await collector.collectExecutives()),
  ];
  console.log(`[수집] 원시 레코드 ${raw.length}건`);

  const normalized: NormalizedRecord[] = raw.map(normalize);

  let drafted = 0;
  let verifierPassed = 0;
  let verifierFailed = 0;

  for (const n of normalized) {
    // A1 요약 초안은 안건(agenda)에만. 근거 원문이 있어야 시도한다.
    if (n.kind !== 'agenda') continue;
    const rec = n.record as { id?: string; title?: string; outline?: string; _meta?: { source_url?: string } };
    const sourceText = rec.outline ?? '';
    if (!sourceText) continue;

    drafted++;
    const ai = await drafter.draftAgendaSummary({
      title: rec.title ?? '',
      sourceText,
      sourceUrl: rec._meta?.source_url ?? '',
    });
    const result = verify(ai, sourceText);
    ai.verifier_passed = result.passed; // 검수는 여전히 사람 몫(reviewed_by=null 유지)

    if (result.passed) {
      verifierPassed++;
      n.record.ai_content = ai; // Verifier 통과분만 초안 첨부(검수 대기)
    } else {
      verifierFailed++;
      // 통과 실패 → ai_content 없이 원문만으로 검수 큐로(§6-④, §14-2)
      console.log(`  [Verifier 실패] ${rec.id}: ${result.failures.map((f) => f.message).join('; ')}`);
    }
  }

  // 변경 감지
  const diffs: DiffEntry[] = [];
  for (const n of normalized) diffs.push(await diffRecord(n));
  const summary = diffs.reduce<Record<string, number>>((acc, d) => {
    acc[d.status] = (acc[d.status] ?? 0) + 1;
    return acc;
  }, {});

  await writeStaging(normalized);

  console.log('\n=== 파이프라인 요약 ===');
  console.log(`정규화: ${normalized.length}건`);
  console.log(`A1 초안 시도: ${drafted} (Verifier 통과 ${verifierPassed} / 실패 ${verifierFailed})`);
  console.log(`변경 감지: 신규 ${summary.new ?? 0} · 변경 ${summary.changed ?? 0} · 무변경 ${summary.unchanged ?? 0}`);
  console.log(`스테이징 출력: ${STAGING} (검수·머지 전 자리표시, data/ 미기록)`);
  console.log('※ 게시는 사람 검수(원칙 6) 후 머지에서만 일어납니다.');
}

async function writeStaging(records: NormalizedRecord[]): Promise<void> {
  const kindDir: Record<string, string> = {
    agenda: 'agendas',
    meeting: 'meetings',
    member: 'members',
    executive: 'executives',
  };
  for (const n of records) {
    const dir = join(STAGING, kindDir[n.kind]);
    await mkdir(dir, { recursive: true });
    const id = String((n.record as { id?: unknown }).id ?? 'UNKNOWN');
    await writeFile(join(dir, `${id}.json`), JSON.stringify(n.record, null, 2), 'utf8');
  }
}

main().catch((err) => {
  console.error('[파이프라인 실패]', err instanceof Error ? err.message : err);
  process.exit(1);
});
