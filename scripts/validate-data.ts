import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

/**
 * 데이터 스키마 검증 (PRD v0.4 §F9, §11 DoD).
 *
 * data/ 아래 모든 레코드를 §8 JSON Schema 로 검증한다. 하나라도 실패하면 exit 1 →
 * CI(.github/workflows/validate.yml)에서 빌드가 중단된다.
 *
 * 실행: npm run validate
 */

const SCHEMA_DIR = join(process.cwd(), 'schema');
const DATA_DIR = join(process.cwd(), 'data');

const SCHEMA_IDS = {
  member: 'https://sinan-council.local/schema/member.schema.json',
  agenda: 'https://sinan-council.local/schema/agenda.schema.json',
  meeting: 'https://sinan-council.local/schema/meeting.schema.json',
  statement: 'https://sinan-council.local/schema/statement.schema.json',
  executive: 'https://sinan-council.local/schema/executive.schema.json',
  glossary: 'https://sinan-council.local/schema/glossary.schema.json',
};

/** data/ 하위 디렉터리 ↔ 스키마 매핑. */
const DIR_SCHEMA: Array<{ dir: string; schema: keyof typeof SCHEMA_IDS }> = [
  { dir: 'members', schema: 'member' },
  { dir: 'agendas', schema: 'agenda' },
  { dir: 'meetings', schema: 'meeting' },
  { dir: 'statements', schema: 'statement' },
  { dir: 'executives', schema: 'executive' },
];

const SCHEMA_FILES = [
  '_meta.schema.json',
  'anchor.schema.json',
  'ai_content.schema.json',
  'member.schema.json',
  'agenda.schema.json',
  'meeting.schema.json',
  'statement.schema.json',
  'executive.schema.json',
  'glossary.schema.json',
];

async function buildAjv(): Promise<Ajv2020> {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const file of SCHEMA_FILES) {
    const schema = JSON.parse(await readFile(join(SCHEMA_DIR, file), 'utf8'));
    ajv.addSchema(schema);
  }
  return ajv;
}

async function listJson(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
}

/** BOM 을 제거하고 JSON 을 파싱한다. 파싱 실패는 던지지 않고 결과로 반환한다(한 파일이 전체 검증을 죽이지 않도록). */
async function readJson(path: string): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const text = (await readFile(path, 'utf8')).replace(/^﻿/, '');
    return { ok: true, data: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

async function main(): Promise<void> {
  const ajv = await buildAjv();
  let checked = 0;
  let errors = 0;

  const report = (file: string, validate: ValidateFunction, data: unknown): void => {
    checked++;
    if (!validate(data)) {
      errors++;
      console.error(`✗ ${file}`);
      for (const e of validate.errors ?? []) {
        console.error(`    ${e.instancePath || '(root)'} ${e.message}`);
      }
    }
  };

  const readAndReport = async (label: string, path: string, validate: ValidateFunction): Promise<void> => {
    const parsed = await readJson(path);
    if (!parsed.ok) {
      checked++;
      errors++;
      console.error(`✗ ${label} 파싱 실패: ${parsed.error}`);
      return;
    }
    report(label, validate, parsed.data);
  };

  // glossary.json (단일 파일, 배열)
  await readAndReport('data/glossary.json', join(DATA_DIR, 'glossary.json'), ajv.getSchema(SCHEMA_IDS.glossary)!);

  // 레코드 디렉터리
  for (const { dir, schema } of DIR_SCHEMA) {
    const validate = ajv.getSchema(SCHEMA_IDS[schema])!;
    const full = join(DATA_DIR, dir);
    for (const file of await listJson(full)) {
      await readAndReport(`data/${dir}/${file}`, join(full, file), validate);
    }
  }

  console.log(`\n검증 완료: ${checked}건 중 ${errors}건 실패`);
  if (errors > 0) {
    console.error('스키마 검증 실패 — 빌드를 중단합니다(§F9).');
    process.exit(1);
  }
  console.log('모든 데이터가 §8 스키마를 통과했습니다.');
}

main().catch((err) => {
  console.error('[검증 스크립트 오류]', err instanceof Error ? err.message : err);
  process.exit(1);
});
