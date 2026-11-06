/**
 * Server-Sent Events のパーサー。
 * 行は LF / CRLF / CR のどれでも区切れ、`:` で始まる行はコメント、空行で 1 イベントが確定する。
 * 複数の `data:` 行は改行でつなぐ。ストリームが終わったとき、未確定の分があればそれも流す。
 */

export interface SseEvent {
	event?: string;
	data: string;
}

/** バイト列のストリームを SSE のイベントに変える */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let event: string | undefined;
	let data: string[] = [];

	const flush = (): SseEvent | null => {
		if (!data.length) {
			event = undefined;
			return null;
		}
		const out: SseEvent = { event, data: data.join('\n') };
		event = undefined;
		data = [];
		return out;
	};

	const handleLine = (line: string): SseEvent | null => {
		if (line === '') return flush();
		if (line.startsWith(':')) return null;
		const colon = line.indexOf(':');
		const field = colon === -1 ? line : line.slice(0, colon);
		let value = colon === -1 ? '' : line.slice(colon + 1);
		if (value.startsWith(' ')) value = value.slice(1);
		if (field === 'data') data.push(value);
		else if (field === 'event') event = value;
		return null;
	};

	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (value) buffer += decoder.decode(value, { stream: true });
			if (done) buffer += decoder.decode();

			// 改行で区切って完成した行だけを処理する。末尾が CR だけなら、次の LF と対かもしれないので持ち越す
			for (;;) {
				const m = /\r\n|\n|\r/.exec(buffer);
				if (!m) break;
				if (m[0] === '\r' && m.index === buffer.length - 1 && !done) break;
				const out = handleLine(buffer.slice(0, m.index));
				buffer = buffer.slice(m.index + m[0].length);
				if (out) yield out;
			}
			if (done) break;
		}
		if (buffer) {
			const out = handleLine(buffer);
			if (out) yield out;
		}
		const rest = flush();
		if (rest) yield rest;
	} finally {
		reader.releaseLock();
	}
}
