import { ManualCollector } from '../pipeline/collectors/ManualCollector.js';
import { normalize } from '../pipeline/normalize.js';
import { buildAjv, getValidator, formatErrors, type SCHEMA_IDS } from './lib/schema.js';

/**
 * 수기 입력 검증 (PRD v0.5 §6 수기 주도형).
 *
 * data/manual-input/*.json 을 정규화한 뒤 §8 스키마로 검증한다. 입력자가 게시 전에
 * "이 입력이 스키마를 통과하는가"를 즉시 확인하는 용도. 실패 시 exit 1.
 *
 * 실행: npm run validate:input
 */

const KIND_TO_SCHEMA: Record<string, keyof typeof SCHEMA_IDS> = {
  agenda: 'agenda',
  meeting: 'meeting',
  member: 'member',
  executive: 'executive',
};

async function main(): Promise<void> {
  const ajv = await buildAjv();
  const collector = new ManualCollector();

  // ManualCollector 는 kind별 메서드를 제공한다. 전 종류를 모아 검증한다.
  const raws = [
    ...(await collector.collectBills()),
    ...(await collector.collectMinutes()),
    ...(await collector.collectMembers()),
    ...(await collector.collectExecutives()),
  ];

  if (raws.length === 0) {
    console.log('data/manual-input 에 수기 입력이 없습니다(템플릿 _*.json 은 제외). 통과.');
    return;
  }

  let errors = 0;
  for (const raw of raws) {
    const { record } = normalize(raw);
    const schemaKey = KIND_TO_SCHEMA[raw.kind];
    const validate = getValidator(ajv, schemaKey);
    const id = String((record as { id?: unknown }).id ?? '(id 없음)');
    if (!validate(record)) {
      errors++;
      console.error(`✗ [${raw.kind}] ${id}`);
      for (const line of formatErrors(validate)) console.error(`    ${line}`);
    } else {
      console.log(`✓ [${raw.kind}] ${id}`);
    }
  }

  console.log(`\n수기 입력 검증: ${raws.length}건 중 ${errors}건 실패`);
  if (errors > 0) {
    console.error('수기 입력이 §8 스키마를 통과하지 못했습니다. 위 항목을 수정하세요.');
    process.exit(1);
  }
  console.log('모든 수기 입력이 정규화 후 §8 스키마를 통과합니다. 파이프라인(npm run pipeline)으로 진행 가능.');
}

main().catch((err) => {
  console.error('[수기 입력 검증 오류]', err instanceof Error ? err.message : err);
  process.exit(1);
});
