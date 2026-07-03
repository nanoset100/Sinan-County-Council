import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Ajv2020, { type ValidateFunction } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

/**
 * §8 JSON Schema 로더 (공용). validate-data / validate-input 이 함께 쓴다.
 */

const SCHEMA_DIR = join(process.cwd(), 'schema');

export const SCHEMA_IDS = {
  member: 'https://sinan-council.local/schema/member.schema.json',
  agenda: 'https://sinan-council.local/schema/agenda.schema.json',
  meeting: 'https://sinan-council.local/schema/meeting.schema.json',
  statement: 'https://sinan-council.local/schema/statement.schema.json',
  executive: 'https://sinan-council.local/schema/executive.schema.json',
  glossary: 'https://sinan-council.local/schema/glossary.schema.json',
} as const;

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

export async function buildAjv(): Promise<Ajv2020> {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const file of SCHEMA_FILES) {
    const schema = JSON.parse(await readFile(join(SCHEMA_DIR, file), 'utf8'));
    ajv.addSchema(schema);
  }
  return ajv;
}

export function getValidator(ajv: Ajv2020, kind: keyof typeof SCHEMA_IDS): ValidateFunction {
  const v = ajv.getSchema(SCHEMA_IDS[kind]);
  if (!v) throw new Error(`스키마를 찾을 수 없음: ${kind}`);
  return v;
}

/** ajv 오류를 사람이 읽는 문자열 배열로. */
export function formatErrors(validate: ValidateFunction): string[] {
  return (validate.errors ?? []).map((e) => `${e.instancePath || '(root)'} ${e.message}`);
}
