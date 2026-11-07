import { describe, expect, it } from 'vitest';
import rulesText from '../../../firestore.rules?raw';
import { FIRESTORE_RULES } from '../../../site/src/lib/firestoreRules';

// 紹介サイトのガイドに載せたルールの写しが、正本(firestore.rules)と食い違わないことを保証する
describe('紹介サイトの Firestore ルールの写し', () => {
	it('firestore.rules と完全に一致する', () => {
		expect(FIRESTORE_RULES).toBe(rulesText);
	});
});
