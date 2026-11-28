import { describe, expect, it } from 'vitest';
import { compareVersions, parseChangelog, parseInline, releasesSince } from './releaseNotes';

const SAMPLE = `# 変更履歴

前置き。

## 旧ルールのまま使っている方へ

- 読み飛ばす項目

## v0.2.0

- **新機能**: 一つ目の文です。二つ目の文です。
- 見出しのない項目で、[説明](docs/A.md) と \`code\` を含む。
  続きの行。

## v0.1.0

- **最初**: はじめての版です。
`;

describe('parseChangelog', () => {
	const releases = parseChangelog(SAMPLE);

	it('版の見出しだけを版として読む', () => {
		expect(releases.map((r) => r.version)).toEqual(['0.2.0', '0.1.0']);
	});

	it('太字の見出しと要約を分ける', () => {
		const item = releases[0].items[0];
		expect(item.title).toBe('新機能');
		expect(item.summary).toBe('一つ目の文です。');
	});

	it('続きの行を同じ項目にまとめ、相対リンクは GitHub へ向ける', () => {
		const item = releases[0].items[1];
		expect(item.title).toBe('');
		expect(item.body).toContainEqual({ kind: 'code', text: 'code' });
		expect(item.body).toContainEqual({
			kind: 'link',
			text: '説明',
			href: 'https://github.com/shiki-01/Storift/blob/main/docs/A.md'
		});
		expect(item.body.at(-1)).toEqual({ kind: 'text', text: ' を含む。 続きの行。' });
	});
});

describe('parseInline', () => {
	it('http(s) 以外のスキームのリンクは使わない', () => {
		const parts = parseInline('[x](javascript:alert(1))');
		expect(parts[0]).toMatchObject({ kind: 'link', href: 'https://github.com/shiki-01/Storift' });
	});
});

describe('compareVersions / releasesSince', () => {
	const releases = parseChangelog(SAMPLE);

	it('数値として比較する', () => {
		expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
		expect(compareVersions('0.9.0', '0.9.0')).toBe(0);
	});

	it('前回見た版より新しい版を返す', () => {
		expect(releasesSince(releases, '0.2.0', '0.1.0').map((r) => r.version)).toEqual(['0.2.0']);
		expect(releasesSince(releases, '0.2.0', '0.2.0')).toEqual([]);
	});

	it('前回が分からなければ今の版だけ', () => {
		expect(releasesSince(releases, '0.2.0', null).map((r) => r.version)).toEqual(['0.2.0']);
	});
});
