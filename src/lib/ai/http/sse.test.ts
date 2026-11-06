// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseSse, type SseEvent } from './sse';
import { streamOf } from '../test-helpers';

async function collect(chunks: string[]): Promise<SseEvent[]> {
	const out: SseEvent[] = [];
	for await (const e of parseSse(streamOf(chunks))) out.push(e);
	return out;
}

describe('parseSse', () => {
	it('空行で区切られたイベントを順に返す', async () => {
		expect(await collect(['data: a\n\ndata: b\n\n'])).toEqual([
			{ event: undefined, data: 'a' },
			{ event: undefined, data: 'b' }
		]);
	});

	it('どこで分割されて届いても同じ結果になる', async () => {
		const wire = 'event: x\ndata: {"a":1}\n\ndata: [DONE]\n\n';
		const expected = await collect([wire]);
		for (let i = 1; i < wire.length; i++) {
			expect(await collect([wire.slice(0, i), wire.slice(i)]), `split ${i}`).toEqual(expected);
		}
	});

	it('CRLF と CR の改行を扱い、CRLF が分割されても 1 つの改行とみなす', async () => {
		expect(await collect(['data: a\r\n\r\ndata: b\r\r'])).toEqual([
			{ event: undefined, data: 'a' },
			{ event: undefined, data: 'b' }
		]);
		expect(await collect(['data: a\r', '\n\r', '\ndata: b\n\n'])).toEqual([
			{ event: undefined, data: 'a' },
			{ event: undefined, data: 'b' }
		]);
	});

	it('コメント行は無視し、複数の data 行は改行でつなぐ', async () => {
		expect(await collect([': ping\ndata: l1\ndata: l2\n\n'])).toEqual([
			{ event: undefined, data: 'l1\nl2' }
		]);
	});

	it('data の先頭の空白 1 つだけを除く', async () => {
		expect(await collect(['data:  two\n\ndata:none\n\n'])).toEqual([
			{ event: undefined, data: ' two' },
			{ event: undefined, data: 'none' }
		]);
	});

	it('終端の空行が無くても、残りのイベントを返す', async () => {
		expect(await collect(['data: last'])).toEqual([{ event: undefined, data: 'last' }]);
	});

	it('マルチバイト文字がバイト列の途中で分かれても壊れない', async () => {
		const bytes = new TextEncoder().encode('data: こんにちは\n\n');
		const stream = new ReadableStream<Uint8Array>({
			start(c) {
				c.enqueue(bytes.slice(0, 8));
				c.enqueue(bytes.slice(8));
				c.close();
			}
		});
		const out: SseEvent[] = [];
		for await (const e of parseSse(stream)) out.push(e);
		expect(out).toEqual([{ event: undefined, data: 'こんにちは' }]);
	});

	it('data の無いイベント(event だけ)は返さない', async () => {
		expect(await collect(['event: ping\n\ndata: x\n\n'])).toEqual([
			{ event: undefined, data: 'x' }
		]);
	});
});
