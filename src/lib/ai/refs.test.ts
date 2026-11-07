import { describe, it, expect } from 'vitest';
import { linkifyRefs, REFERENCE_INSTRUCTIONS, type RefLookup } from './refs';

const ID = '8f677717-1a2b-4c3d-8e9f-0123456789ab';
const lookup: RefLookup = (id) =>
	id === ID
		? { kind: 'character', name: '日野 夕理' }
		: id === 'w1'
			? { kind: 'worldbuilding', name: '星<環>' }
			: undefined;

describe('linkifyRefs', () => {
	it('参照記法をリンクにする(表示名は索引の名前を優先)', () => {
		const html = linkifyRefs(`[[character:${ID}|ひの]]が登場する`, lookup);
		expect(html).toContain('data-ref-kind="character"');
		expect(html).toContain(`data-ref-id="${ID}"`);
		expect(html).toContain('>日野 夕理</button>');
		expect(html.endsWith('が登場する')).toBe(true);
	});

	it('表示名は HTML エスケープする', () => {
		expect(linkifyRefs('[[worldbuilding:w1|x]]', lookup)).toContain('>星&lt;環&gt;</button>');
	});

	it('存在しない id は無効表示(押せない)', () => {
		const html = linkifyRefs('[[plot:nope|第八章]]', lookup);
		expect(html).toContain('class="ref-link missing"');
		expect(html).not.toContain('<button');
		expect(html).toContain('第八章');
	});

	it('種別を間違えていても索引の種別を使う', () => {
		expect(linkifyRefs('[[plot:w1|x]]', lookup)).toContain('data-ref-kind="worldbuilding"');
	});

	it('生の (id: uuid) は既知ならリンクにして id を隠す', () => {
		const html = linkifyRefs(`キャラクター資料「日野 夕理」(id: ${ID})を参照`, lookup);
		expect(html).not.toContain(ID + ')');
		expect(html).toContain('>日野 夕理</button>');
		expect(html).toContain('キャラクター資料「');
		expect(html.endsWith('を参照')).toBe(true);
	});

	it('名前の括弧が無い (id: uuid) と全角括弧もリンクにする', () => {
		const html = linkifyRefs(`人物(sceneId：${ID})と（id: ${ID}）`, lookup);
		expect(html.match(/<button/g)).toHaveLength(2);
		expect(html).not.toMatch(/id\s*[:：]/i);
	});

	it('未知の生の id はそのまま', () => {
		const text = `資料(id: 11111111-1111-1111-1111-111111111111)`;
		expect(linkifyRefs(text, lookup)).toBe(text);
	});

	it('コードの中は変えない', () => {
		const text = '`[[character:x|y]]`\n```\n[[character:x|y]]\n```';
		expect(linkifyRefs(text, lookup)).toBe(text);
	});

	it('参照記法が無ければそのまま返す', () => {
		expect(linkifyRefs('ふつうの文章', lookup)).toBe('ふつうの文章');
	});
});

describe('REFERENCE_INSTRUCTIONS', () => {
	it('記法と種別を案内している', () => {
		expect(REFERENCE_INSTRUCTIONS).toContain('[[種別:id|表示名]]');
		expect(REFERENCE_INSTRUCTIONS).toContain('worldbuilding');
	});
});
