// @vitest-environment node
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRegistry } from './build-registry';
import { validateExtensions } from './validate-extensions';
import { parseBundleText } from '../src/lib/extensions/packBundle';
import { sha256Hex, validateRegistryIndex } from '../src/lib/extensions/registryIndex';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let root: string;

/** 実際のリポジトリの extensions と、アイコンの一覧だけをコピーした作業用のリポジトリ */
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), 'storift-ext-'));
	await cp(join(repo, 'extensions'), join(root, 'extensions'), { recursive: true });
	await mkdir(join(root, 'src/lib/components/editor'), { recursive: true });
	await cp(
		join(repo, 'src/lib/components/editor/icons'),
		join(root, 'src/lib/components/editor/icons'),
		{ recursive: true }
	);
});
afterEach(() => rm(root, { recursive: true, force: true }));

const manifestOf = async (dir: string) =>
	JSON.parse(await readFile(join(root, 'extensions', dir, 'manifest.json'), 'utf8'));
const writeManifest = (dir: string, m: unknown) =>
	writeFile(join(root, 'extensions', dir, 'manifest.json'), JSON.stringify(m));

describe('validateExtensions', () => {
	it('リポジトリの extensions は、すべて検証に通る', async () => {
		expect(await validateExtensions(repo)).toEqual([]);
	});

	it('id とディレクトリ名が違うとエラー(ファイル:メッセージ の形)', async () => {
		const m = await manifestOf('dialogue-keys');
		await writeManifest('dialogue-keys', { ...m, id: 'other-keys' });
		const errors = await validateExtensions(root);
		expect(errors).toContainEqual(
			expect.stringMatching(/^extensions\/dialogue-keys\/manifest\.json:.*一致しません/)
		);
	});

	it('予約済みの id・公式を名乗る kind を拒否する', async () => {
		await cp(join(root, 'extensions/dialogue-keys'), join(root, 'extensions/official-foo'), {
			recursive: true
		});
		const m = await manifestOf('official-foo');
		await writeManifest('official-foo', { ...m, id: 'official-foo' });
		expect((await validateExtensions(root)).join()).toContain('予約');

		await rm(join(root, 'extensions/official-foo'), { recursive: true });
		const k = await manifestOf('dialogue-keys');
		const rest = { ...k };
		delete rest.contributions;
		await writeManifest('dialogue-keys', { ...rest, kind: 'official' });
		expect((await validateExtensions(root)).join()).toContain('kind: official');
	});

	it('許可リスト外のライセンス・license 無しを拒否する', async () => {
		const m = await manifestOf('dialogue-keys');
		await writeManifest('dialogue-keys', { ...m, license: 'GPL-3.0-only' });
		expect((await validateExtensions(root)).join()).toContain('license');
		const rest = { ...m };
		delete rest.license;
		await writeManifest('dialogue-keys', rest);
		expect((await validateExtensions(root)).length).toBeGreaterThan(0);
	});

	it('privacy・author が無いとエラー', async () => {
		const m = await manifestOf('dialogue-keys');
		const noPrivacy = { ...m };
		delete noPrivacy.privacy;
		await writeManifest('dialogue-keys', noPrivacy);
		expect((await validateExtensions(root)).join()).toContain('privacy');
		await writeManifest('dialogue-keys', { ...m, author: '' });
		expect((await validateExtensions(root)).join()).toContain('author');
	});

	it('参照ファイルが無い・余計な JSON・許可外の拡張子・隠しファイル・リンクを拒否する', async () => {
		const dir = join(root, 'extensions/dialogue-keys');
		await rm(join(dir, 'contents/keys.json'));
		expect((await validateExtensions(root)).join()).toContain('contents/keys.json:ありません');

		await cp(join(repo, 'extensions/dialogue-keys'), dir, { recursive: true });
		await writeFile(join(dir, 'contents/extra.json'), '{}');
		await writeFile(join(dir, 'run.js'), 'alert(1)');
		await writeFile(join(dir, '.secret'), 'x');
		await symlink(join(root, 'extensions/common-notation/manifest.json'), join(dir, 'link.md'));
		const joined = (await validateExtensions(root)).join('\n');
		expect(joined).toContain('extra.json:contributions に書かれていない');
		expect(joined).toContain('run.js:置けないファイルです');
		expect(joined).toContain('.secret:隠しファイル');
		expect(joined).toContain('link.md:シンボリックリンク');
	});

	it('画像の大きさの上限・許可された拡張子', async () => {
		const dir = join(root, 'extensions/dialogue-keys');
		await writeFile(join(dir, 'icon.png'), Buffer.alloc(10));
		await writeFile(join(dir, 'README.md'), '# x');
		expect(await validateExtensions(root)).toEqual([]);
		await writeFile(join(dir, 'big.png'), Buffer.alloc(300 * 1024));
		expect((await validateExtensions(root)).join()).toContain('big.png:画像は');
	});

	it('コンテンツの中身の検証(固定文字列でない規則・制御文字)', async () => {
		const file = join(root, 'extensions/common-notation/contents/rules.json');
		const rules = JSON.parse(await readFile(file, 'utf8'));
		rules.rules.push({ pattern: '(a+)+$', to: 'x' });
		await writeFile(file, JSON.stringify(rules));
		const errors = await validateExtensions(root);
		expect(errors.join()).toContain('extensions/common-notation/contents/rules.json:');
		expect(errors.join()).toContain('正規表現は使えません');
	});

	it('マニフェストが壊れている・直下に余計なファイルがある', async () => {
		await writeFile(join(root, 'extensions/dialogue-keys/manifest.json'), '{');
		await writeFile(join(root, 'extensions/stray.txt'), 'x');
		const joined = (await validateExtensions(root)).join('\n');
		expect(joined).toContain('JSON として読み込めません');
		expect(joined).toContain('extensions/stray.txt');
	});

	it('パック以外の kind(script)は、まだ受け付けない', async () => {
		const m = await manifestOf('dialogue-keys');
		const rest = { ...m };
		delete rest.contributions;
		await writeManifest('dialogue-keys', { ...rest, kind: 'script' });
		expect((await validateExtensions(root)).join()).toContain('まだ受け付けていません');
	});
});

describe('buildRegistry', () => {
	it('一覧とバンドルを生成する。バンドルの SHA-256 は一覧と一致し、アプリの検証を通る', async () => {
		const out = join(root, 'out');
		const { index } = await buildRegistry(repo, out);
		const read = JSON.parse(await readFile(join(out, 'index.json'), 'utf8'));
		const validated = validateRegistryIndex(read);
		expect(validated.ok).toBe(true);
		const ids = index.extensions.map((e) => e.id);
		expect(ids).toEqual([...ids].sort());
		expect(ids).toEqual(
			expect.arrayContaining([
				'monolog',
				'discord',
				'common-notation',
				'dialogue-keys',
				'wakakusa-themes'
			])
		);
		expect(ids).not.toContain('my-pack');
		const monolog = index.extensions.find((e) => e.id === 'monolog')!;
		expect(monolog).toMatchObject({ source: 'official', bundle: null, sha256: null, size: null });

		for (const entry of index.extensions.filter((e) => e.bundle)) {
			expect(entry.source).toBe('community');
			const path = new URL(entry.bundle!).pathname.replace('/extensions-registry/', '');
			const text = await readFile(join(out, path), 'utf8');
			expect(await sha256Hex(text)).toBe(entry.sha256);
			expect(new TextEncoder().encode(text).length).toBe(entry.size);
			const parsed = parseBundleText(text);
			expect(parsed.ok, entry.id).toBe(true);
		}
	});

	it('何度作っても同じバイト列になる(コミット日時・実行時刻を使わない)', async () => {
		const a = join(root, 'a');
		const b = join(root, 'b');
		await buildRegistry(repo, a);
		await new Promise((r) => setTimeout(r, 20));
		await buildRegistry(repo, b);
		for (const file of ['index.json', 'common-notation/1.0.0.storiftext.json']) {
			expect(await readFile(join(a, file), 'utf8')).toBe(await readFile(join(b, file), 'utf8'));
		}
	});

	it('検証に通らない拡張があるときは、生成しない', async () => {
		await writeFile(join(root, 'extensions/dialogue-keys/manifest.json'), '{');
		await expect(buildRegistry(root, join(root, 'out'))).rejects.toThrow('レジストリを作れません');
	});
});
