import { describe, expect, it } from 'vitest';
import { measureJson, narrowEventPayload, parseRequest } from './protocol';

describe('measureJson', () => {
	it('JSON で表せる値を受け付ける', () => {
		expect(measureJson({ a: [1, 'x', null, true, { b: 2 }], c: undefined }).ok).toBe(true);
	});

	it('Map・Date・バイナリ・関数・NaN・クラスのインスタンスを拒否する', () => {
		for (const v of [
			new Map(),
			new Date(),
			new Uint8Array(2),
			() => 1,
			NaN,
			Infinity,
			new (class A {})()
		])
			expect(measureJson({ v }).ok, String(v)).toBe(false);
	});

	it('大きさ・深さ・個数の上限を超えると拒否する', () => {
		expect(measureJson('x'.repeat(200_000))).toEqual({ ok: false, reason: 'size' });
		let deep: unknown = 1;
		for (let i = 0; i < 20; i++) deep = [deep];
		expect(measureJson(deep)).toEqual({ ok: false, reason: 'depth' });
		expect(measureJson(Array.from({ length: 5000 }, () => 1))).toEqual({
			ok: false,
			reason: 'nodes'
		});
		// 巨大な疎配列でも、走査せずに拒否する
		expect(measureJson(new Array(1e9)).ok).toBe(false);
	});
});

describe('parseRequest', () => {
	const ok = { t: 'req', id: 1, m: 'notify', a: { message: 'x' } };

	it('正しいリクエストを受け付ける', () => {
		expect(parseRequest(ok).ok).toBe(true);
	});

	it('形の違うものは protocol、大きいものは oversize', () => {
		for (const bad of [
			null,
			'x',
			[],
			{ ...ok, t: 'res' },
			{ ...ok, id: 0 },
			{ ...ok, id: 1.5 },
			{ ...ok, id: '1' },
			{ ...ok, m: 'host.eval' },
			{ ...ok, m: 'constructor' },
			{ ...ok, a: () => 1 }
		])
			expect(parseRequest(bad), JSON.stringify(bad)).toEqual({ ok: false, reason: 'protocol' });
		expect(parseRequest({ ...ok, a: { v: 'x'.repeat(300_000) } })).toEqual({
			ok: false,
			reason: 'oversize'
		});
	});
});

describe('narrowEventPayload(ペイロードの絞り込み)', () => {
	const session = {
		sessionId: 's1',
		startedAt: 1,
		lastEditAt: 2,
		endedAt: 3,
		netChars: 10,
		projectId: 'p1',
		projectTitle: '秘密の作品',
		reason: 'idle' as const
	};

	it('作品名は権限(project:title)が無ければ渡らない。ID も渡らない', () => {
		const without = narrowEventPayload('session:end', session, { canTitle: false });
		expect(JSON.stringify(without)).not.toContain('秘密の作品');
		expect(without).not.toHaveProperty('projectTitle');
		expect(without).not.toHaveProperty('projectId');
		expect(without).not.toHaveProperty('sessionId');
		expect(without).toMatchObject({ netChars: 10, reason: 'idle' });
		expect(narrowEventPayload('session:start', session, { canTitle: true })).toMatchObject({
			projectTitle: '秘密の作品'
		});
	});

	it('総文字数・本文・ID は、ペイロードに含まれない', () => {
		const scene = narrowEventPayload(
			'scene:updated',
			{
				sceneId: 'a',
				chapterId: 'b',
				projectId: 'c',
				characterCount: 5,
				previousCharacterCount: 3,
				delta: 2,
				origin: 'user',
				content: '本文'
			} as never,
			{ canTitle: true }
		);
		expect(scene).toEqual({
			characterCount: 5,
			previousCharacterCount: 3,
			delta: 2,
			origin: 'user'
		});
		expect(
			narrowEventPayload('page:change', { page: 'write', projectId: 'p' } as never, {
				canTitle: true
			})
		).toEqual({ page: 'write' });
		expect(
			narrowEventPayload('scene:created', { sceneId: 'a' } as never, { canTitle: true })
		).toEqual({});
	});
});
