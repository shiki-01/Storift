import { describe, expect, it } from 'vitest';
import { classifyHttpError, extractServerMessage, redact } from './errors';

const KEY = 'sk-test-1234567890abcdefghij';

describe('classifyHttpError', () => {
	it.each([
		[401, 'auth', '認証'],
		[403, 'auth', '認証'],
		[404, 'not-found', 'Base URL とモデル名'],
		[429, 'rate-limit', 'レート制限'],
		[400, 'bad-request', 'ツール呼び出し'],
		[500, 'server', 'エラーが起きました'],
		[503, 'server', 'エラーが起きました']
	])('%i は %s に分類し、日本語で説明する', (status, kind, word) => {
		const e = classifyHttpError(status, '', 'テスト API');
		expect(e.kind).toBe(kind);
		expect(e.status).toBe(status);
		expect(e.message).toContain('テスト API');
		expect(e.message).toContain(word);
	});

	it('サーバーが返した理由を添える', () => {
		const e = classifyHttpError(401, '{"error":{"message":"Incorrect API key provided"}}', 'X');
		expect(e.message).toContain('Incorrect API key provided');
	});

	it('API キーはメッセージに含めない', () => {
		const body = JSON.stringify({ error: { message: `Incorrect API key provided: ${KEY}.` } });
		const e = classifyHttpError(401, body, 'X', [KEY]);
		expect(e.message).not.toContain(KEY);
		expect(e.message).not.toContain('1234567890');
		// キーを渡していなくても、sk- 形式は伏せる
		expect(classifyHttpError(401, body, 'X').message).not.toContain(KEY);
	});

	it('長い本文は切り詰め、HTML のエラーページは出さない', () => {
		const long = classifyHttpError(500, 'x'.repeat(1000), 'X');
		expect(long.message.length).toBeLessThan(400);
		const html = classifyHttpError(502, '<html><body>Bad gateway</body></html>', 'X');
		expect(html.message).not.toContain('<html>');
	});
});

describe('extractServerMessage', () => {
	it('error.message / error 文字列 / message / 生の本文の順に取り出す', () => {
		expect(extractServerMessage('{"error":{"message":"a"}}')).toBe('a');
		expect(extractServerMessage('{"error":"b"}')).toBe('b');
		expect(extractServerMessage('{"message":"c"}')).toBe('c');
		expect(extractServerMessage('plain')).toBe('plain');
		expect(extractServerMessage('')).toBe('');
	});
});

describe('redact', () => {
	it('指定したキーと Bearer トークンを伏せる', () => {
		expect(redact(`key=${KEY}`, [KEY])).toBe('key=***');
		expect(redact('Authorization: Bearer abcdefghijklmnop')).toContain('Bearer ***');
	});

	it('短すぎる文字列は伏せない(通常の語を壊さない)', () => {
		expect(redact('abc def', ['abc'])).toBe('abc def');
	});
});
