// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STORIFT_TOOLS } from '../tool-fixtures';
import { restoreGeminiArgs, toGeminiFunctionDeclarations, toGeminiSchema } from './geminiSchema';

/** Gemini が受け付けない項目(これが残っていたら 400 になる) */
const FORBIDDEN = [
	'$schema',
	'additionalProperties',
	'default',
	'examples',
	'oneOf',
	'allOf',
	'const',
	'$ref',
	'definitions',
	'$defs'
];

/** 変換結果のどこにも、禁止された項目・配列の type・空の properties が無いことを確かめる */
function assertGeminiSafe(node: unknown, path = '$'): void {
	if (Array.isArray(node)) return node.forEach((n, i) => assertGeminiSafe(n, `${path}[${i}]`));
	if (!node || typeof node !== 'object') return;
	const rec = node as Record<string, unknown>;
	for (const k of FORBIDDEN) expect(rec, `${path} に ${k}`).not.toHaveProperty(k);
	if ('type' in rec) {
		expect(typeof rec.type, `${path}.type は文字列`).toBe('string');
		expect(rec.type, `${path}.type は小文字`).toBe(String(rec.type).toLowerCase());
	}
	if (rec.type === 'object')
		expect(
			Object.keys((rec.properties as object) ?? {}).length,
			`${path} の properties`
		).toBeGreaterThan(0);
	if (rec.type === 'array') expect(rec, `${path}.items`).toHaveProperty('items');
	for (const [k, v] of Object.entries(rec)) {
		// properties の中身は項目名をキーにしたスキーマの集まり
		if (k === 'properties') {
			for (const [name, sub] of Object.entries(v as object))
				assertGeminiSafe(sub, `${path}.${name}`);
		} else assertGeminiSafe(v, `${path}.${k}`);
	}
	if (Array.isArray(rec.required))
		for (const r of rec.required)
			expect(rec.properties, `${path}.required の ${r}`).toHaveProperty(r);
}

describe('Storift のツール定義(テスト用の写し)', () => {
	it('mcp.rs の tool_definitions と同じツール名が同じ順に並ぶ', () => {
		const rust = readFileSync(new URL('../../../../src-tauri/src/mcp.rs', import.meta.url), 'utf8');
		const names = [...rust.matchAll(/json!\(\{\s*"name": "(\w+)",\s*"description"/g)].map(
			(m) => m[1]
		);
		expect(names).toHaveLength(10);
		expect(STORIFT_TOOLS.map((t) => t.name)).toEqual(names);
	});
});

describe('Gemini のスキーマ変換: Storift の 10 ツール', () => {
	const declarations = toGeminiFunctionDeclarations(STORIFT_TOOLS);

	it('10 ツールすべてが、禁止された項目を含まない関数宣言になる', () => {
		expect(declarations).toHaveLength(10);
		for (const d of declarations) {
			expect(d.name, d.name).toBeTruthy();
			expect(d.description, d.name).toBeTruthy();
			if (d.parameters) {
				expect(d.parameters.type).toBe('object');
				assertGeminiSafe(d.parameters, d.name);
			}
		}
	});

	it('名前と説明はそのまま、引数のないツールは parameters を省く', () => {
		const byName = Object.fromEntries(declarations.map((d) => [d.name, d]));
		expect(byName.list_projects).toEqual({
			name: 'list_projects',
			description: '作品の一覧(id, title)を返す'
		});
		expect(byName.get_scene.description).toBe(STORIFT_TOOLS[3].description);
		expect(byName.get_scene.parameters).toEqual({
			type: 'object',
			properties: {
				sceneId: { type: 'string' },
				offset: { type: 'integer', minimum: 0 },
				limit: { type: 'integer', minimum: 1 }
			},
			required: ['sceneId']
		});
	});

	it('enum・配列(items)・description・required を保つ', () => {
		const byName = Object.fromEntries(declarations.map((d) => [d.name, d]));
		const listItems = byName.list_items.parameters as { properties: Record<string, unknown> };
		expect(listItems.properties.kind).toEqual({
			type: 'string',
			enum: [
				'characters',
				'plots',
				'worldbuilding',
				'memos',
				'progressLogs',
				'relationMaps',
				'history'
			]
		});
		expect(listItems.properties.cursor).toEqual({
			type: 'string',
			description: '前回の nextCursor'
		});
		const search = byName.search.parameters as {
			properties: Record<string, unknown>;
			required: string[];
		};
		expect(search.properties.kinds).toEqual({ type: 'array', items: { type: 'string' } });
		expect(search.required).toEqual(['query']);
		expect(byName.propose_edit.parameters).toMatchObject({
			required: ['kind', 'id', 'old', 'new']
		});
	});

	it('自由形式の object(propose_create の fields)は JSON 文字列を受ける string にする', () => {
		const create = declarations.find((d) => d.name === 'propose_create')!;
		const fields = (create.parameters as { properties: Record<string, Record<string, unknown>> })
			.properties.fields;
		expect(fields.type).toBe('string');
		expect(String(fields.description)).toContain('JSON');
		expect(String(fields.description)).toContain('項目名');
	});

	it('入力のスキーマを書き換えない', () => {
		const before = JSON.stringify(STORIFT_TOOLS);
		toGeminiFunctionDeclarations(STORIFT_TOOLS);
		expect(JSON.stringify(STORIFT_TOOLS)).toBe(before);
	});
});

describe('toGeminiSchema', () => {
	it('未対応の項目を再帰的に除く', () => {
		const out = toGeminiSchema({
			$schema: 'http://json-schema.org/draft-07/schema#',
			type: 'object',
			additionalProperties: false,
			properties: {
				a: { type: 'string', default: 'x', examples: ['y'] },
				b: {
					type: 'array',
					items: {
						type: 'object',
						additionalProperties: true,
						properties: { c: { type: 'number' } }
					}
				}
			}
		});
		expect(out).toEqual({
			type: 'object',
			properties: {
				a: { type: 'string' },
				b: { type: 'array', items: { type: 'object', properties: { c: { type: 'number' } } } }
			}
		});
	});

	it('type の配列は null を除いた先頭にし、null があれば nullable にする', () => {
		expect(toGeminiSchema({ type: ['string', 'number'] })).toEqual({ type: 'string' });
		expect(toGeminiSchema({ type: ['integer', 'null'] })).toEqual({
			type: 'integer',
			nullable: true
		});
	});

	it('enum 以外の anyOf / oneOf は、null を除いた先頭の候補に単純化する', () => {
		expect(
			toGeminiSchema({ anyOf: [{ type: 'null' }, { type: 'string' }, { type: 'number' }] })
		).toEqual({ type: 'string', nullable: true });
		expect(toGeminiSchema({ oneOf: [{ type: 'integer', minimum: 1 }], description: 'n' })).toEqual({
			type: 'integer',
			minimum: 1,
			description: 'n'
		});
	});

	it('enum は文字列の列挙にする', () => {
		expect(toGeminiSchema({ enum: [1, 'b'] })).toEqual({ type: 'string', enum: ['1', 'b'] });
	});

	it('存在しない項目を指す required は除き、空になれば省く', () => {
		const out = toGeminiSchema({
			type: 'object',
			properties: { a: { type: 'string' } },
			required: ['a', 'ghost']
		});
		expect(out.required).toEqual(['a']);
		expect(
			toGeminiSchema({ type: 'object', properties: { a: { type: 'string' } }, required: ['x'] })
		).not.toHaveProperty('required');
	});

	it('items の無い array には string の items を補う', () => {
		expect(toGeminiSchema({ type: 'array' })).toEqual({ type: 'array', items: { type: 'string' } });
	});

	it('スキーマでない入力は string にする', () => {
		expect(toGeminiSchema(null)).toEqual({ type: 'string' });
		expect(toGeminiSchema({})).toEqual({ type: 'string' });
	});
});

describe('restoreGeminiArgs', () => {
	const schema = STORIFT_TOOLS.find((t) => t.name === 'propose_create')!.inputSchema;

	it('文字列にした自由形式の object を、JSON から元のオブジェクトに戻す', () => {
		const args = { kind: 'characters', fields: '{"名前":"月","年齢":17}' };
		expect(restoreGeminiArgs(args, schema)).toEqual({
			kind: 'characters',
			fields: { 名前: '月', 年齢: 17 }
		});
	});

	it('既にオブジェクトならそのまま、読めない文字列もそのまま(ツール側のエラーにする)', () => {
		expect(restoreGeminiArgs({ fields: { a: 1 } }, schema)).toEqual({ fields: { a: 1 } });
		expect(restoreGeminiArgs({ fields: 'not json' }, schema)).toEqual({ fields: 'not json' });
	});

	it('他の項目には触れない', () => {
		const args = { query: '{"a":1}' };
		const search = STORIFT_TOOLS.find((t) => t.name === 'search')!.inputSchema;
		expect(restoreGeminiArgs(args, search)).toEqual(args);
	});
});
