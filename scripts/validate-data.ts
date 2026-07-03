import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ValidateFunction } from 'ajv/dist/2020.js';
import { buildAjv, getValidator, formatErrors, SCHEMA_IDS } from './lib/schema.js';

/**
 * 데이터 스키마 검증 (PRD v0.5 §F9, §11 DoD).
 *
 * data/ 아래 모든 게시 레코드를 §8 JSON Schema 로 검증한다. 하나라도 실패하면 exit 1 →
 * CI(.github/workflows/validate.yml)에서 빌드가 중단된다.
 *
 * 실행: npm run validate
 */

const DATA_DIR = join(process.cwd(), 'data');

/** data/ 하위 디렉터리 ↔ 스키마 매핑. */
const DIR_SCHEMA: Array<{ dir: string; schema: keyof typeof SCHEMA_IDS }> = [
  { dir: 'members', schema: 'member' },
  { dir: 'agendas', schema: 'agenda' },
  { dir: 'meetings', schema: 'meeting' },
  { dir: 'statements', schema: 'statement' },
  { dir: 'executives', schema: 'executive' },
];

async function listJson(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
}

/** BOM 제거 후 JSON 파싱. 파싱 실패는 던지지 않고 결과로 반환. */
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
      for (const line of formatErrors(validate)) console.error(`    ${line}`);
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
  await readAndReport('data/glossary.json', join(DATA_DIR, 'glossary.json'), getValidator(ajv, 'glossary'));

  // 레코드 디렉터리
  for (const { dir, schema } of DIR_SCHEMA) {
    const validate = getValidator(ajv, schema);
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
