import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import rulesText from '../../../firestore.rules?raw';

// サイトは別プロジェクトで、その tsconfig は site/.svelte-kit(サイトの依存を入れると作られる)に依存する。
// Vite を通して読み込むと、サイトの依存を入れていない環境(CI)で失敗するので、ファイルの文字列として直接読む
// vitest はリポジトリのルートで実行する(package.json の scripts と CI)
const siteSource = readFileSync(resolve(process.cwd(), 'site/src/lib/firestoreRules.ts'), 'utf8');

/** `export const FIRESTORE_RULES = \`...\`;` の、テンプレートリテラルの中身を取り出す */
function extractRules(source: string): string {
	const ticks = [...source].filter((c) => c === '`').length;
	// バッククォート・補間・エスケープがあると、取り出し方が変わるので禁止する
	expect(ticks, 'バッククォートはテンプレートリテラルの開始と終了の 2 つだけ').toBe(2);
	expect(source.includes('${'), '文字列補間は使わない').toBe(false);
	expect(source.includes('\\'), 'バックスラッシュ(エスケープ)は使わない').toBe(false);
	return source.slice(source.indexOf('`') + 1, source.lastIndexOf('`'));
}

// 紹介サイトのガイドに載せたルールの写しが、正本(firestore.rules)と食い違わないことを保証する
describe('紹介サイトの Firestore ルールの写し', () => {
	it('firestore.rules と完全に一致する', () => {
		expect(extractRules(siteSource)).toBe(rulesText);
	});
});
