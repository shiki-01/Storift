/**
 * ツールの JSON Schema を、Gemini API の関数宣言(OpenAPI のサブセット)に変換する純粋関数。
 *
 * Gemini は `$schema`・`additionalProperties`・`default`・`examples` などを受け付けない。
 * 受け付ける項目だけを残す方式(許可リスト)で再帰的に変換する。
 * - `type` が配列(例: ["string", "number"])のときは、`null` を除いた先頭の型にする(`null` があれば nullable)
 * - `enum` 以外の `oneOf` / `anyOf` は、`null` を除いた先頭の候補に単純化する
 * - properties を持たない object は Gemini が拒否するので、JSON 文字列を受ける string に置き換える
 *   (モデルが返した文字列は `restoreGeminiArgs` で元のオブジェクトに戻す)
 */
import type { ToolSpec } from '../http/agent';

type Json = Record<string, unknown>;

const asRecord = (v: unknown): Json | undefined =>
	v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined;

/** そのまま残してよい項目 */
const KEEP = ['description', 'format', 'minimum', 'maximum', 'minItems', 'maxItems'] as const;

/** 文字列に置き換えた object であることを、description の末尾で伝える */
const JSON_STRING_HINT = '(JSON オブジェクトを文字列で指定)';

const TYPES = ['string', 'number', 'integer', 'boolean', 'array', 'object'];

/** type(文字列または配列)から、使う型と nullable を決める */
function pickType(type: unknown): { type?: string; nullable: boolean } {
	const list = (Array.isArray(type) ? type : [type]).filter(
		(t): t is string => typeof t === 'string'
	);
	const nullable = list.includes('null');
	const first = list.find((t) => TYPES.includes(t));
	return { type: first, nullable };
}

/** oneOf / anyOf を、null を除いた先頭の候補に単純化して、元のスキーマへ重ねる */
function flattenUnion(schema: Json): Json {
	const union = (Array.isArray(schema.anyOf) ? schema.anyOf : schema.oneOf) as unknown;
	if (!Array.isArray(union)) return schema;
	const variants = union.map(asRecord).filter((v): v is Json => !!v);
	const nonNull = variants.filter((v) => v.type !== 'null');
	const merged: Json = { ...schema };
	delete merged.anyOf;
	delete merged.oneOf;
	if (nonNull.length < variants.length) merged.nullable = true;
	return nonNull.length ? { ...nonNull[0], ...merged } : merged;
}

/** スキーマ 1 つを変換する */
export function toGeminiSchema(input: unknown): Json {
	const raw = asRecord(input);
	if (!raw) return { type: 'string' };
	const schema = flattenUnion(raw);

	const { type: pickedType, nullable } = pickType(schema.type);
	const out: Json = {};
	for (const k of KEEP) if (schema[k] !== undefined) out[k] = schema[k];
	if (nullable || schema.nullable === true) out.nullable = true;

	// enum は文字列の列挙だけを受け付ける
	if (Array.isArray(schema.enum) && schema.enum.length) {
		out.type = 'string';
		out.enum = schema.enum.map(String);
		return out;
	}

	const properties = asRecord(schema.properties);
	if (pickedType === 'object' || (!pickedType && properties)) {
		const entries = Object.entries(properties ?? {});
		if (!entries.length) {
			// 自由形式の object(additionalProperties のみ)は、JSON 文字列として受ける
			const description = typeof out.description === 'string' ? out.description : '';
			return { ...out, type: 'string', description: `${description}${JSON_STRING_HINT}`.trim() };
		}
		out.type = 'object';
		out.properties = Object.fromEntries(entries.map(([k, v]) => [k, toGeminiSchema(v)]));
		if (Array.isArray(schema.required)) {
			const required = schema.required.filter(
				(r): r is string => typeof r === 'string' && r in (out.properties as Json)
			);
			if (required.length) out.required = required;
		}
		return out;
	}

	if (pickedType === 'array') {
		out.type = 'array';
		out.items = toGeminiSchema(schema.items);
		return out;
	}

	out.type = pickedType ?? 'string';
	return out;
}

export interface GeminiFunctionDeclaration {
	name: string;
	description: string;
	/** 引数を持たないツールでは省略する(空の properties は拒否されるため) */
	parameters?: Json;
}

/** ツール定義を `functionDeclarations` の要素にする */
export function toGeminiFunctionDeclarations(tools: ToolSpec[]): GeminiFunctionDeclaration[] {
	return tools.map((t) => {
		const parameters = toGeminiSchema({ type: 'object', ...t.inputSchema });
		const hasParams =
			parameters.type === 'object' && Object.keys(asRecord(parameters.properties) ?? {}).length > 0;
		return {
			name: t.name,
			description: t.description,
			...(hasParams ? { parameters } : {})
		};
	});
}

/**
 * モデルが返した引数を、元のスキーマに合わせて戻す。
 * 自由形式の object を文字列に置き換えた項目が JSON 文字列で届いたら、オブジェクトにする。
 */
export function restoreGeminiArgs(args: Json, schema: Json): Json {
	const props = asRecord(schema.properties);
	if (!props) return args;
	const out: Json = { ...args };
	for (const [key, sub] of Object.entries(props)) {
		const spec = asRecord(sub);
		const value = out[key];
		if (!spec || value === undefined) continue;
		const isFreeObject =
			pickType(spec.type).type === 'object' && !Object.keys(asRecord(spec.properties) ?? {}).length;
		if (isFreeObject) {
			if (typeof value === 'string') {
				try {
					const parsed = asRecord(JSON.parse(value));
					if (parsed) out[key] = parsed;
				} catch {
					// 読めなければ、そのまま渡してツール側のエラーにする
				}
			}
		} else if (pickType(spec.type).type === 'object' && asRecord(value)) {
			out[key] = restoreGeminiArgs(value as Json, spec);
		}
	}
	return out;
}
