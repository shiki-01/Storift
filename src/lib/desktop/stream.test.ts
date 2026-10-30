import { describe, expect, it } from 'vitest';
import { applyStreamLine, createTurnState, isAuthError, turnParts } from './stream';

const line = (value: unknown) => JSON.stringify(value);

describe('applyStreamLine', () => {
	it('差分で逐次表示し、完成したメッセージで置き換える', () => {
		const state = createTurnState();
		applyStreamLine(state, line({ type: 'system', subtype: 'init', session_id: 's1' }));
		applyStreamLine(
			state,
			line({ type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } })
		);
		applyStreamLine(
			state,
			line({
				type: 'stream_event',
				event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
			})
		);
		applyStreamLine(
			state,
			line({
				type: 'stream_event',
				event: {
					type: 'content_block_delta',
					index: 0,
					delta: { type: 'text_delta', text: '誤字' }
				}
			})
		);
		expect(turnParts(state)).toEqual([{ kind: 'text', text: '誤字' }]);
		expect(state.sessionId).toBe('s1');

		applyStreamLine(
			state,
			line({
				type: 'assistant',
				message: {
					id: 'm1',
					content: [
						{ type: 'text', text: '誤字があります。' },
						{ type: 'tool_use', name: 'Read', input: { file_path: '/ws/projects/作品/概要.md' } }
					]
				}
			})
		);
		expect(turnParts(state)).toEqual([
			{ kind: 'text', text: '誤字があります。' },
			{ kind: 'tool', name: 'Read', summary: '作品/概要.md' }
		]);
	});

	it('結果を記録し、本文が無ければ結果のテキストを出す', () => {
		const state = createTurnState();
		applyStreamLine(state, 'not json');
		applyStreamLine(
			state,
			line({
				type: 'result',
				subtype: 'success',
				is_error: false,
				result: '完了',
				session_id: 's2',
				total_cost_usd: 0.0123
			})
		);
		expect(state.done).toBe(true);
		expect(state.isError).toBe(false);
		expect(state.sessionId).toBe('s2');
		expect(state.costUsd).toBe(0.0123);
		expect(turnParts(state)).toEqual([{ kind: 'text', text: '完了' }]);
	});

	it('複数のメッセージのテキストをつなげる', () => {
		const state = createTurnState();
		for (const [id, text] of [
			['a', '調べます。'],
			['b', '結果です。']
		]) {
			applyStreamLine(
				state,
				line({ type: 'assistant', message: { id, content: [{ type: 'text', text }] } })
			);
		}
		expect(turnParts(state)).toEqual([{ kind: 'text', text: '調べます。\n\n結果です。' }]);
	});
});

describe('エラーの result', () => {
	it('エラー文を本文として出さない', () => {
		const state = createTurnState();
		applyStreamLine(
			state,
			JSON.stringify({
				type: 'result',
				subtype: 'success',
				is_error: true,
				result: 'Failed to authenticate: OAuth session expired and could not be refreshed'
			})
		);
		expect(state.isError).toBe(true);
		expect(turnParts(state)).toEqual([]);
	});
});

describe('isAuthError', () => {
	it('ログイン切れのエラーを判定する', () => {
		expect(
			isAuthError('Failed to authenticate: OAuth session expired and could not be refreshed')
		).toBe(true);
		expect(isAuthError('Invalid API key · Please run /login')).toBe(true);
		expect(isAuthError('No conversation found with session ID: abc')).toBe(false);
		expect(isAuthError('終了コード 1')).toBe(false);
	});
});
