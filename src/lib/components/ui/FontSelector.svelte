<script lang="ts">
	import type { EditorFont } from '$lib/types';
	import { isDesktop } from '$lib/desktop/platform';
	import Select from './Select.svelte';
	import {
		getSystemFontName,
		listSystemFonts,
		systemFontToCss,
		toSystemFontValue
	} from '$lib/utils/fonts';

	interface Props {
		value: EditorFont;
		onchange?: (font: EditorFont) => void;
	}

	let { value = $bindable('yu-gothic'), onchange }: Props = $props();

	const fonts: { value: EditorFont; label: string; fontFamily: string }[] = [
		{
			value: 'yu-gothic',
			label: '游ゴシック体',
			fontFamily: '"Yu Gothic", "YuGothic", sans-serif'
		},
		{
			value: 'gen-shin-mincho',
			label: '源ノ明朝',
			fontFamily: '"Gen Shin Mincho", "源ノ明朝", serif'
		},
		{
			value: 'hiragino-mincho',
			label: 'ヒラギノ明朝',
			fontFamily: '"Hiragino Mincho ProN", "ヒラギノ明朝 ProN", serif'
		},
		{ value: 'noto-sans', label: 'Noto Sans JP', fontFamily: '"Noto Sans JP", sans-serif' },
		{ value: 'noto-serif', label: 'Noto Serif JP', fontFamily: '"Noto Serif JP", serif' },
		{
			value: 'hannari-mincho',
			label: 'はんなり明朝',
			fontFamily: '"Hannari", "はんなり明朝", serif'
		},
		{
			value: 'sawarabi-mincho',
			label: 'さわらび明朝',
			fontFamily: '"Sawarabi Mincho", "さわらび明朝", serif'
		},
		{
			value: 'sawarabi-gothic',
			label: 'さわらびゴシック',
			fontFamily: '"Sawarabi Gothic", "さわらびゴシック", sans-serif'
		}
	];

	const SYSTEM_OPTION = '__system__';

	// デスクトップ版のみ、インストール済みフォントを選べる
	const desktop = isDesktop();
	let systemMode = $state(false);
	let systemName = $state('');
	let systemFonts = $state<string[]>([]);

	$effect(() => {
		const name = getSystemFontName(value);
		if (name !== null) {
			systemMode = true;
			systemName = name;
		}
	});

	async function enableSystemMode() {
		systemMode = true;
		if (systemFonts.length === 0) systemFonts = await listSystemFonts();
	}

	$effect(() => {
		if (desktop && systemMode && systemFonts.length === 0) {
			listSystemFonts().then((list) => (systemFonts = list));
		}
	});

	function handleChange(selected: string) {
		if (selected === SYSTEM_OPTION) {
			enableSystemMode();
			return;
		}
		systemMode = false;
		const newFont = selected as EditorFont;
		value = newFont;
		if (onchange) {
			onchange(newFont);
		}
	}

	function commitSystemFont() {
		const name = systemName.trim();
		if (!name) return;
		const newFont = toSystemFontValue(name);
		if (newFont === value) return;
		value = newFont;
		onchange?.(newFont);
	}
</script>

<div class="font-selector">
	<Select
		aria-label="エディタのフォント"
		value={systemMode ? SYSTEM_OPTION : value}
		onchange={handleChange}
		options={[
			...fonts.map((f) => ({ value: f.value as string, label: f.label })),
			...(desktop ? [{ value: SYSTEM_OPTION, label: 'システムフォント…' }] : [])
		]}
	/>
	{#if desktop && systemMode}
		<input
			type="text"
			list="system-font-list"
			bind:value={systemName}
			onchange={commitSystemFont}
			onkeydown={(e) => e.key === 'Enter' && commitSystemFont()}
			placeholder="フォント名(例: 游明朝)"
			style="font-family: {systemFontToCss(systemName)};"
			class="mt:6 w:full p:8|12 r:6 border:1|solid|theme-border font:13 outline:none focus:border:theme-primary"
		/>
		<datalist id="system-font-list">
			{#each systemFonts as family (family)}
				<option value={family}></option>
			{/each}
		</datalist>
	{/if}
</div>
