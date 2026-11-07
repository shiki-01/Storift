import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import Select from './Select.svelte';
import type { SelectOption } from './selectLogic';

const options: SelectOption[] = [
	{ value: 'suggest', label: '提案のみ', description: '本文には触れない' },
	{ value: 'confirm', label: '差分を確認して反映' },
	{ value: 'locked', label: '使えない', disabled: true },
	{ value: 'auto', label: '自動で反映' }
];

function setup(props: Record<string, unknown> = {}) {
	const onchange = vi.fn();
	const view = render(Select, {
		options,
		value: 'suggest',
		'aria-label': '本文の編集',
		onchange,
		...props
	});
	const trigger = screen.getByRole('combobox', { name: '本文の編集' });
	return { ...view, trigger, onchange };
}

const key = async (el: Element, k: string) => {
	await fireEvent.keyDown(el, { key: k });
	await tick();
};

afterEach(() => cleanup());

describe('Select', () => {
	it('現在の値のラベルを表示し、閉じている間は listbox がない', () => {
		const { trigger } = setup();
		expect(trigger.textContent).toContain('提案のみ');
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
		expect(trigger.getAttribute('type')).toBe('button');
		expect(screen.queryByRole('listbox')).toBeNull();
	});

	it('値が一覧になければ placeholder を出す', () => {
		const { trigger } = setup({ value: 'nothing', placeholder: '選んでください' });
		expect(trigger.textContent).toContain('選んでください');
	});

	it('クリックで開き、選択中の項目に aria-selected が付く', async () => {
		const { trigger } = setup();
		await fireEvent.click(trigger);
		await tick();
		expect(trigger.getAttribute('aria-expanded')).toBe('true');
		const items = screen.getAllByRole('option');
		expect(items).toHaveLength(4);
		expect(items[0].getAttribute('aria-selected')).toBe('true');
		expect(items[1].getAttribute('aria-selected')).toBe('false');
		expect(trigger.getAttribute('aria-activedescendant')).toBe(items[0].id);
		expect(screen.getByText('本文には触れない')).toBeTruthy();
	});

	it('↓ で無効な項目を飛ばして移動し、Enter で確定して閉じる', async () => {
		const { trigger, onchange } = setup();
		await key(trigger, 'ArrowDown'); // 開く
		await key(trigger, 'ArrowDown');
		expect(trigger.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1].id);
		await key(trigger, 'ArrowDown'); // locked を飛ばす
		expect(trigger.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[3].id);
		await key(trigger, 'Enter');
		expect(onchange).toHaveBeenCalledWith('auto');
		expect(screen.queryByRole('listbox')).toBeNull();
		expect(trigger.textContent).toContain('自動で反映');
	});

	it('Home / End で端の選べる項目へ、Space で確定する', async () => {
		const { trigger, onchange } = setup({ value: 'confirm' });
		await key(trigger, 'Enter');
		await key(trigger, 'End');
		expect(trigger.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[3].id);
		await key(trigger, 'Home');
		expect(trigger.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0].id);
		await key(trigger, ' ');
		expect(onchange).toHaveBeenCalledWith('suggest');
	});

	it('Esc は選ばずに閉じ、イベントを外へ伝えない', async () => {
		const { trigger, onchange } = setup();
		const outer = vi.fn();
		window.addEventListener('keydown', outer);
		await key(trigger, 'Enter');
		await key(trigger, 'ArrowDown');
		await key(trigger, 'Escape');
		window.removeEventListener('keydown', outer);
		expect(screen.queryByRole('listbox')).toBeNull();
		expect(onchange).not.toHaveBeenCalled();
		expect(outer).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }));
	});

	it('無効な項目はクリックしても選べない', async () => {
		const { trigger, onchange } = setup();
		await fireEvent.click(trigger);
		await tick();
		await fireEvent.click(screen.getByText('使えない'));
		expect(onchange).not.toHaveBeenCalled();
		expect(screen.queryByRole('listbox')).not.toBeNull();
	});

	it('項目のクリックで選択して閉じる', async () => {
		const { trigger, onchange } = setup();
		await fireEvent.click(trigger);
		await tick();
		await fireEvent.click(screen.getByText('自動で反映'));
		await tick();
		expect(onchange).toHaveBeenCalledWith('auto');
		expect(screen.queryByRole('listbox')).toBeNull();
	});

	it('開いたまま文字を入力すると、先頭一致の項目へ移る', async () => {
		const { trigger, onchange } = setup();
		await key(trigger, 'Enter');
		await key(trigger, '自');
		expect(trigger.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[3].id);
		await key(trigger, 'Enter');
		expect(onchange).toHaveBeenCalledWith('auto');
	});

	it('閉じたまま文字を入力すると、先頭一致の値に変わる', async () => {
		const { trigger, onchange } = setup();
		await key(trigger, '差');
		expect(onchange).toHaveBeenCalledWith('confirm');
		expect(screen.queryByRole('listbox')).toBeNull();
	});

	it('外側を押すと閉じる', async () => {
		const { trigger } = setup();
		await fireEvent.click(trigger);
		await tick();
		await fireEvent.pointerDown(document.body);
		await tick();
		expect(screen.queryByRole('listbox')).toBeNull();
	});

	it('フォーカスを失うと閉じる', async () => {
		const { trigger } = setup();
		await fireEvent.click(trigger);
		await tick();
		await fireEvent.blur(trigger);
		await tick();
		expect(screen.queryByRole('listbox')).toBeNull();
	});

	it('disabled のときは開かない', async () => {
		const { trigger } = setup({ disabled: true });
		await fireEvent.click(trigger);
		await key(trigger, 'Enter');
		expect(screen.queryByRole('listbox')).toBeNull();
	});

	it('form の中でも submit しない', async () => {
		const submit = vi.fn((e: Event) => e.preventDefault());
		const form = document.createElement('form');
		form.addEventListener('submit', submit);
		document.body.appendChild(form);
		render(Select, { target: form, props: { options, value: 'suggest', 'aria-label': 'x' } });
		await fireEvent.click(form.querySelector('button')!);
		expect(submit).not.toHaveBeenCalled();
		form.remove();
	});
});
