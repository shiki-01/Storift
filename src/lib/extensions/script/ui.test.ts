import { describe, expect, it } from 'vitest';
import { SCRIPT_LIMITS } from './limits';
import { checkUiEvent, normalizeHttpsUrl, validateUi } from './ui';

const nodes = (list: unknown[], badge?: boolean) => validateUi({ nodes: list, badge });

describe('validateUi', () => {
	it('すべての要素を受け付け、知っている項目だけの新しいオブジェクトにする', () => {
		const r = nodes([
			{ type: 'heading', text: 'h' },
			{ type: 'text', text: 't', tone: 'muted', evil: '<script>' },
			{ type: 'button', id: 'b', label: 'B', variant: 'primary' },
			{ type: 'toggle', id: 't1', label: 'T', value: true },
			{ type: 'input', id: 'i', label: 'I', value: 'v', secret: true },
			{ type: 'select', id: 's', label: 'S', value: 'a', options: [{ value: 'a', label: 'A' }] },
			{ type: 'list', items: ['a', { text: 'b', detail: 'c' }] },
			{ type: 'progress', value: 3 },
			{ type: 'divider' },
			{ type: 'link', label: 'L', url: 'https://example.com/a' }
		]);
		expect(r.ok).toBe(true);
		if (!r.ok) return;
		expect(r.tree.nodes).toHaveLength(10);
		expect(r.tree.nodes[1]).not.toHaveProperty('evil');
		expect(r.tree.nodes[7]).toMatchObject({ type: 'progress', value: 1 });
	});

	it('HTML は文字としてそのまま保たれる(解釈しない)', () => {
		const r = nodes([{ type: 'text', text: '<img src=x onerror=alert(1)><script>1</script>' }]);
		expect(r.ok && r.tree.nodes[0]).toMatchObject({
			text: '<img src=x onerror=alert(1)><script>1</script>'
		});
	});

	it('https 以外のリンク(javascript: / data: / http: / 認証情報つき)を拒否する', () => {
		for (const url of [
			'javascript:alert(1)',
			'data:text/html,<script>1</script>',
			'http://example.com',
			'https://user:pw@example.com/',
			'//example.com',
			'file:///etc/passwd',
			'https://exa mple.com',
			'https://a.example.com/' + 'x'.repeat(400)
		])
			expect(nodes([{ type: 'link', label: 'L', url }]).ok, url).toBe(false);
		expect(normalizeHttpsUrl('https://example.com')).toBe('https://example.com/');
	});

	it('未知の種類・上限超過・id の重複・不正な値を拒否する', () => {
		expect(nodes([{ type: 'script', src: 'x' }]).ok).toBe(false);
		expect(nodes([{ type: 'iframe' }]).ok).toBe(false);
		expect(
			nodes(Array.from({ length: SCRIPT_LIMITS.uiNodes + 1 }, () => ({ type: 'divider' }))).ok
		).toBe(false);
		expect(nodes([{ type: 'text', text: 'あ'.repeat(SCRIPT_LIMITS.uiTextLength + 1) }]).ok).toBe(
			false
		);
		expect(
			nodes([
				{ type: 'button', id: 'a', label: 'x' },
				{ type: 'button', id: 'a', label: 'y' }
			]).ok
		).toBe(false);
		expect(nodes([{ type: 'button', id: 'bad id!', label: 'x' }]).ok).toBe(false);
		expect(nodes([{ type: 'text', text: 'a\u0000b' }]).ok).toBe(false);
		expect(nodes([{ type: 'select', id: 's', label: 'S', value: '', options: [] }]).ok).toBe(false);
		expect(validateUi({ nodes: 'x' }).ok).toBe(false);
		expect(validateUi(null).ok).toBe(false);
	});
});

describe('checkUiEvent', () => {
	const r = nodes([
		{ type: 'button', id: 'b', label: 'B' },
		{ type: 'toggle', id: 't', label: 'T', value: false },
		{ type: 'select', id: 's', label: 'S', value: 'a', options: [{ value: 'a', label: 'A' }] },
		{ type: 'input', id: 'i', label: 'I' }
	]);
	const tree = r.ok ? r.tree : null;

	it('記述にある要素の、正しい種類・値の操作だけを通す', () => {
		expect(checkUiEvent(tree, 'b', 'press', undefined)).toBe(true);
		expect(checkUiEvent(tree, 't', 'change', true)).toBe(true);
		expect(checkUiEvent(tree, 's', 'change', 'a')).toBe(true);
		expect(checkUiEvent(tree, 'i', 'change', 'text')).toBe(true);
		expect(checkUiEvent(tree, 'zzz', 'press')).toBe(false);
		expect(checkUiEvent(tree, 't', 'change', 'true')).toBe(false);
		expect(checkUiEvent(tree, 's', 'change', 'not-an-option')).toBe(false);
		expect(checkUiEvent(tree, 'b', 'change', 'x')).toBe(false);
		expect(checkUiEvent(null, 'b', 'press')).toBe(false);
	});
});
