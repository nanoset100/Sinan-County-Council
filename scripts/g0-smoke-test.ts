/**
 * G0 스모크 테스트 (PRD v0.4 §12-G0) — 인증키 도착 즉시 신안군 커버리지 실증용.
 *
 * 하는 일:
 *   1) S1_API_KEY 로 지방의정포털 Open API 에 실호출.
 *   2) 신안군 rasmblyId(S1_RASMBLY_ID 또는 --rasmbly=<값>)로 bill.do / minutes.do 조회.
 *   3) HTTP 상태·응답 래핑 구조·반환 건수·주요 필드를 리포트로 출력.
 *   4) 신안군 의안/회의록이 실제로 반환되면 G0 통과 → 결과를 PRD v0.5 확정에 반영.
 *
 * ⚠️ 엔드포인트/파라미터 이름은 PRD 기재값 기반의 추정이다. 응답이 비거나 404 면,
 *    리소스센터의 실제 명세로 BASE_URL/파라미터를 교정한 뒤 다시 실행하라.
 *
 * 실행: S1_API_KEY=... S1_RASMBLY_ID=... npm run g0
 *   또는: npm run g0 -- --rasmbly=<후보값>
 */

const BASE_URL = process.env.S1_BASE_URL ?? 'https://clik.nanet.go.kr/openapi';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split('=')[1];
}

async function probe(endpoint: string, key: string, rasmblyId: string): Promise<void> {
  const url = new URL(`${BASE_URL}/${endpoint}`);
  url.searchParams.set('key', key);
  url.searchParams.set('type', 'json');
  url.searchParams.set('displayType', 'list');
  url.searchParams.set('startCount', '0');
  url.searchParams.set('listCount', '5');
  url.searchParams.set('searchType', 'ALL');
  url.searchParams.set('rasmblyId', rasmblyId);
  const safe = url.toString().replace(key, '***');

  console.log(`\n── ${endpoint} ──`);
  console.log(`GET ${safe}`);
  try {
    const res = await fetch(url);
    console.log(`HTTP ${res.status} ${res.statusText}`);
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      const env = Array.isArray(json) ? json[0] : json;
      console.log(`RESULT: ${env?.RESULT_CODE} ${env?.RESULT_MESSAGE ?? ''} · TOTAL_COUNT=${env?.TOTAL_COUNT ?? '?'}`);
      const rows: any[] = Array.isArray(env?.LIST) ? env.LIST.map((x: any) => x.ROW) : [];
      console.log(`반환 건수: ${rows.length}`);
      if (rows.length > 0) {
        console.log(`첫 레코드 필드: ${Object.keys(rows[0]).join(', ')}`);
        // 신안군 확인 핵심 필드
        for (const r of rows.slice(0, 5)) {
          console.log(`  · RASMBLY_NM=${r.RASMBLY_NM ?? '?'} / 대수=${r.RASMBLY_NUMPR ?? '?'} / 일자=${r.MTG_DE ?? r.ITNC_DE ?? '?'} / 제목=${(r.BI_SJ ?? r.MTGNM ?? '').toString().slice(0, 30)}`);
        }
      }
    } catch {
      console.log('JSON 파싱 실패(키 오류 시 XML <SERVICE>ERROR01 가능). 앞부분:');
      console.log(text.slice(0, 500));
    }
  } catch (err) {
    console.log(`네트워크 오류: ${(err as Error).message}`);
  }
}

async function main(): Promise<void> {
  const key = process.env.S1_API_KEY;
  const rasmblyId = arg('rasmbly') ?? process.env.S1_RASMBLY_ID;

  console.log('=== G0 스모크 테스트 (S1 신안군 커버리지) ===');
  console.log(`BASE_URL: ${BASE_URL}`);

  if (!key) {
    console.error(
      '\n✗ S1_API_KEY 가 없습니다. 인증키 발급 절차는 docs/G0-api-key-request.md 참조.\n' +
        '  발급 전에는 G0 를 완료할 수 없습니다(파이프라인은 COLLECTOR=manual 폴백으로 진행).',
    );
    process.exit(2);
  }
  if (!rasmblyId) {
    console.error(
      '\n✗ 신안군 rasmblyId 가 없습니다. S1_RASMBLY_ID 를 넣거나 --rasmbly=<후보값> 을 주세요.\n' +
        '  값을 모르면 리소스센터의 의회코드 목록에서 "신안군의회"를 찾으세요.',
    );
    process.exit(2);
  }

  await probe('bill.do', key, rasmblyId);
  await probe('minutes.do', key, rasmblyId);
  await probe('assemblyinfo.do', key, rasmblyId);

  console.log('\n=== 판정 안내 ===');
  console.log('· RESULT_CODE=SUCCESS 이고 RASMBLY_NM 에 "신안군"이 보이면 → G0 통과.');
  console.log('  → §6 을 "S1 주도형"으로 확정하고 PRD 를 v0.5 "확정"으로 갱신.');
  console.log('· 제10대(대수=10)는 이번달 개원이라 0건일 수 있음 — 9대 데이터로 파이프라인/AI 검증(§12-2).');
  console.log('· ERROR01(인증키 무효) → 승인 대기(대기→승인) 후 재실행.');
  console.log('· SUCCESS 인데 신안군 0건 → 지방의회 미승인 가능(§4 주의) → 폴백(수기 주도형) 검토.');
}

main().catch((err) => {
  console.error('[G0 스모크 테스트 오류]', err instanceof Error ? err.message : err);
  process.exit(1);
});
