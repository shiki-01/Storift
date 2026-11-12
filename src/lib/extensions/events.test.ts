import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from './events';

const payload = {
	sceneId: 's',
	chapterId: 'c',
	projectId: 'p',
	characterCount: 10,
	previousCharacterCount: 4
};

describe('EventEmitter', () => {
	it('購読者に payload を渡し、解除すると呼ばれなくなる', () => {
		const emitter = new EventEmitter();
		const handler = vi.fn();
		const off = emitter.on('scene:updated', handler);
		emitter.emit('scene:updated', payload);
		expect(handler).toHaveBeenCalledWith(payload);
		off();
		emitter.emit('scene:updated', payload);
		expect(handler).toHaveBeenCalledTimes(1);
		expect(emitter.hasListeners('scene:updated')).toBe(false);
	});

	it('イベントごとに独立している', () => {
		const emitter = new EventEmitter();
		const handler = vi.fn();
		emitter.on('scene:created', handler);
		emitter.emit('scene:updated', payload);
		expect(handler).not.toHaveBeenCalled();
	});

	it('購読者の例外・失敗した Promise は、他の購読者と発行元に影響しない', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const emitter = new EventEmitter();
		const ok = vi.fn();
		emitter.on('scene:updated', () => {
			throw new Error('boom');
		});
		emitter.on('scene:updated', () => Promise.reject(new Error('async boom')));
		emitter.on('scene:updated', ok);
		expect(() => emitter.emit('scene:updated', payload)).not.toThrow();
		await Promise.resolve();
		expect(ok).toHaveBeenCalled();
		spy.mockRestore();
	});
});
