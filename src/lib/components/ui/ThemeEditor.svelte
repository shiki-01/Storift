<script lang="ts">
	import { untrack } from 'svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { themeStore, themes, type Theme } from '$lib/stores/theme.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import {
		contrastRatio,
		deriveTheme,
		isDarkColor,
		isHexColor,
		newCustomThemeId,
		normalizeHex
	} from '$lib/utils/themeTools';

	interface ThemeEditorProps {
		isOpen?: boolean;
		/** 編集するカスタムテーマ。null のときは新規作成 */
		target?: Theme | null;
		onSaved?: (theme: Theme) => void;
	}

	let { isOpen = $bindable(false), target = null, onSaved }: ThemeEditorProps = $props();

	type Group = 'colors' | 'editor';

	const UI_FIELDS: { key: keyof Theme['colors']; label: string }[] = [
		{ key: 'primary', label: 'メイン' },
		{ key: 'secondary', label: '補助' },
		{ key: 'background', label: '背景' },
		{ key: 'surface', label: '面' },
		{ key: 'text', label: '文字' },
		{ key: 'textSecondary', label: '薄い文字' },
		{ key: 'border', label: '枠線' },
		{ key: 'accent', label: '差し色' },
		{ key: 'success', label: '成功' },
		{ key: 'warning', label: '注意' },
		{ key: 'error', label: 'エラー' },
		{ key: 'info', label: '情報' }
	];

	const EDITOR_FIELDS: { key: keyof Theme['editor']; label: string }[] = [
		{ key: 'background', label: '原稿の背景' },
		{ key: 'text', label: '原稿の文字' },
		{ key: 'selection', label: '選択範囲' },
		{ key: 'lineHighlight', label: '行の強調' },
		{ key: 'cursor', label: 'カーソル' }
	];

	const MIN_CONTRAST = 4.5;

	function cloneTheme(theme: Theme): Theme {
		return JSON.parse(JSON.stringify(theme)) as Theme;
	}

	let draft = $state<Theme>(cloneTheme(themes.light));
	let tab = $state<'simple' | 'detail'>('simple');
	let baseId = $state('');
	/** 入力中の不正な hex 色。キーは「group.key」 */
	let invalid = $state<Record<string, boolean>>({});

	// かんたんモードの入力値。変更すると全色を deriveTheme で決め直す
	let simple = $state({
		background: '#ffffff',
		text: '#000000',
		primary: '#000000',
		accent: '#000000',
		dark: false
	});

	let nameValid = $derived(draft.name.trim().length > 0);

	let warnings = $derived.by(() => {
		const list: string[] = [];
		const ui = contrastRatio(draft.colors.text, draft.colors.background);
		if (ui < MIN_CONTRAST) {
			list.push(`画面の文字と背景の対比が ${ui.toFixed(2)} : 1 です(4.5 以上を推奨)`);
		}
		const editor = contrastRatio(draft.editor.text, draft.editor.background);
		if (editor < MIN_CONTRAST) {
			list.push(`原稿の文字と背景の対比が ${editor.toFixed(2)} : 1 です(4.5 以上を推奨)`);
		}
		return list;
	});

	/** プレビュー枠に色とフォントを変数として載せる(編集中の色をそのまま見せる) */
	let previewStyle = $derived.by(() => {
		const vars: string[] = [];
		const toVar = (name: string) => name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
		for (const [key, value] of Object.entries(draft.colors)) {
			vars.push(`--color-${toVar(key)}: ${value}`);
		}
		for (const [key, value] of Object.entries(draft.editor)) {
			vars.push(`--editor-${toVar(key)}: ${value}`);
		}
		for (const [key, value] of Object.entries(draft.fonts)) {
			vars.push(`--font-${toVar(key)}: ${value}`);
		}
		return vars.join('; ');
	});

	function colorValue(group: Group, key: string): string {
		return (draft[group] as Record<string, string>)[key];
	}

	function setColor(group: Group, key: string, value: string) {
		const field = `${group}.${key}`;
		if (!isHexColor(value)) {
			invalid = { ...invalid, [field]: true };
			return;
		}
		invalid = { ...invalid, [field]: false };
		(draft[group] as Record<string, string>)[key] = normalizeHex(value);
	}

	function syncSimpleFromDraft() {
		simple = {
			background: draft.colors.background,
			text: draft.colors.text,
			primary: draft.colors.primary,
			accent: draft.colors.accent,
			dark: isDarkColor(draft.colors.background)
		};
	}

	function applySimple() {
		const derived = deriveTheme({ name: draft.name, ...simple });
		draft.colors = derived.colors;
		draft.editor = derived.editor;
	}

	function setSimple(key: 'background' | 'text' | 'primary' | 'accent', value: string) {
		simple[key] = value;
		applySimple();
	}

	function applyBase(id: string) {
		const base = themeStore.allThemes.find((t) => t.id === id);
		if (!base) return;
		baseId = id;
		draft.colors = cloneTheme(base).colors;
		draft.editor = cloneTheme(base).editor;
		draft.fonts = cloneTheme(base).fonts;
		invalid = {};
		syncSimpleFromDraft();
	}

	function openWith(source: Theme | null) {
		tab = 'simple';
		invalid = {};
		if (source) {
			draft = cloneTheme(source);
			baseId = source.id;
		} else {
			const current = themeStore.theme;
			draft = { ...cloneTheme(current), id: newCustomThemeId(), name: '新しいテーマ' };
			baseId = current.id;
		}
		syncSimpleFromDraft();
	}

	// 開いたときに、編集対象(または現在のテーマ)から下書きを作る
	$effect(() => {
		if (!isOpen) return;
		untrack(() => openWith(target));
	});

	// 編集中の下書きを、アプリ全体に一時適用する
	$effect(() => {
		if (!isOpen) return;
		const snapshot = $state.snapshot(draft) as Theme;
		themeStore.previewTheme(snapshot);
	});

	function handleClose() {
		themeStore.previewTheme(null);
		isOpen = false;
	}

	async function handleSave() {
		if (!nameValid) return;
		const snapshot = $state.snapshot(draft) as Theme;
		const theme: Theme = { ...snapshot, name: snapshot.name.trim() };
		try {
			await themeStore.saveCustomTheme(theme);
			await themeStore.setTheme(theme.id);
			toast.success(`「${theme.name}」を保存しました`);
			isOpen = false;
			onSaved?.(theme);
		} catch (error) {
			console.error('Failed to save theme:', error);
			toast.error('テーマを保存できませんでした');
		}
	}
</script>

{#snippet colorRow(group: Group, key: string, label: string)}
	{@const id = `theme-color-${group}-${key}`}
	{@const value = colorValue(group, key)}
	<div class="color-row">
		<label for={id} class="color-label">{label}</label>
		<input {id} type="color" {value} oninput={(e) => setColor(group, key, e.currentTarget.value)} />
		<input
			type="text"
			class="hex"
			class:invalid={invalid[`${group}.${key}`]}
			aria-label={`${label}の色コード`}
			aria-invalid={invalid[`${group}.${key}`] ? 'true' : undefined}
			{value}
			maxlength="7"
			spellcheck="false"
			oninput={(e) => setColor(group, key, e.currentTarget.value)}
		/>
	</div>
{/snippet}

<Modal
	bind:isOpen
	title={target ? 'テーマを編集' : 'テーマを作る'}
	size="large"
	onClose={handleClose}
>
	<div class="editor-layout">
		<div class="editor-form">
			<div class="field">
				<label for="theme-name">テーマ名</label>
				<input id="theme-name" type="text" bind:value={draft.name} maxlength="40" />
			</div>

			<div class="field">
				<label for="theme-base">元にするテーマ</label>
				<select id="theme-base" value={baseId} onchange={(e) => applyBase(e.currentTarget.value)}>
					{#each themeStore.allThemes as theme (theme.id)}
						<option value={theme.id}>{theme.name}</option>
					{/each}
				</select>
			</div>

			<div class="tabs" role="tablist">
				<button
					type="button"
					role="tab"
					class="tab"
					class:active={tab === 'simple'}
					aria-selected={tab === 'simple'}
					onclick={() => {
						tab = 'simple';
						syncSimpleFromDraft();
					}}>かんたん</button
				>
				<button
					type="button"
					role="tab"
					class="tab"
					class:active={tab === 'detail'}
					aria-selected={tab === 'detail'}
					onclick={() => (tab = 'detail')}>詳細</button
				>
			</div>

			{#if tab === 'simple'}
				<div class="simple-panel">
					<div class="color-row">
						<label for="simple-background" class="color-label">背景</label>
						<input
							id="simple-background"
							type="color"
							value={simple.background}
							oninput={(e) => setSimple('background', e.currentTarget.value)}
						/>
					</div>
					<div class="color-row">
						<label for="simple-text" class="color-label">文字</label>
						<input
							id="simple-text"
							type="color"
							value={simple.text}
							oninput={(e) => setSimple('text', e.currentTarget.value)}
						/>
					</div>
					<div class="color-row">
						<label for="simple-primary" class="color-label">メイン</label>
						<input
							id="simple-primary"
							type="color"
							value={simple.primary}
							oninput={(e) => setSimple('primary', e.currentTarget.value)}
						/>
					</div>
					<div class="color-row">
						<label for="simple-accent" class="color-label">差し色</label>
						<input
							id="simple-accent"
							type="color"
							value={simple.accent}
							oninput={(e) => setSimple('accent', e.currentTarget.value)}
						/>
					</div>
					<label class="check">
						<input
							type="checkbox"
							checked={simple.dark}
							onchange={(e) => {
								simple.dark = e.currentTarget.checked;
								applySimple();
							}}
						/>
						<span>暗いテーマ</span>
					</label>
					<p class="note">色を変えると、ほかの色も自動で決め直します。</p>
				</div>
			{:else}
				<div class="detail-panel">
					<div class="group-title">画面</div>
					{#each UI_FIELDS as field (field.key)}
						{@render colorRow('colors', field.key, field.label)}
					{/each}
					<div class="group-title">原稿</div>
					{#each EDITOR_FIELDS as field (field.key)}
						{@render colorRow('editor', field.key, field.label)}
					{/each}
				</div>
			{/if}
		</div>

		<div class="editor-side">
			<p class="side-title">プレビュー</p>
			<div class="theme-preview" style={previewStyle}>
				<div class="preview-card">
					<p class="preview-heading">見出しの例</p>
					<p class="preview-body">画面の文字と薄い文字の見え方を確かめます。</p>
					<p class="preview-muted">補足の文字</p>
					<div class="preview-actions">
						<Button size="sm">保存</Button>
						<Button size="sm" variant="secondary">キャンセル</Button>
					</div>
					<div class="preview-status">
						<span style="color: var(--color-success)">成功</span>
						<span style="color: var(--color-warning)">注意</span>
						<span style="color: var(--color-error)">エラー</span>
						<span style="color: var(--color-info)">情報</span>
					</div>
				</div>
				<div class="preview-manuscript">
					<p>原稿の<span class="sel">選択された文字</span>と、<span class="caret"></span></p>
					<p class="line-hl">行の強調の例です。</p>
				</div>
			</div>

			{#if warnings.length > 0}
				<ul class="warnings" role="status">
					{#each warnings as message (message)}
						<li>{message}</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>

	{#snippet footer()}
		<div class="footer">
			<Button variant="secondary" onclick={handleClose}>キャンセル</Button>
			<Button onclick={handleSave} disabled={!nameValid}>保存</Button>
		</div>
	{/snippet}
</Modal>

<style>
	.editor-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 24px;
	}

	.editor-form,
	.editor-side {
		display: flex;
		flex-direction: column;
		gap: 14px;
		min-width: 0;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 14px;
	}

	.field label,
	.side-title,
	.note,
	.group-title {
		color: var(--color-text-secondary);
		font-size: 13px;
	}

	.field input,
	.field select,
	.hex {
		height: 34px;
		padding: 0 10px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		color: var(--color-text);
		font: inherit;
		font-size: 14px;
	}

	.hex {
		width: 100%;
		min-width: 0;
		font-family: monospace;
	}

	.hex.invalid {
		border-color: var(--color-error);
		color: var(--color-error);
	}

	.tabs {
		display: flex;
		gap: 4px;
		border-bottom: 1px solid var(--color-border);
	}

	.tab {
		padding: 8px 14px;
		border: none;
		border-bottom: 2px solid transparent;
		background: none;
		color: var(--color-text-secondary);
		font: inherit;
		font-size: 14px;
		cursor: pointer;
	}

	.tab.active {
		border-bottom-color: var(--color-primary);
		color: var(--color-primary);
		font-weight: 600;
	}

	.simple-panel,
	.detail-panel {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.group-title {
		margin-top: 6px;
		font-weight: 600;
	}

	.color-row {
		display: grid;
		grid-template-columns: 96px 44px minmax(0, 1fr);
		align-items: center;
		gap: 10px;
		font-size: 14px;
	}

	.color-row input[type='color'] {
		width: 44px;
		height: 32px;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: none;
		cursor: pointer;
	}

	.simple-panel .color-row {
		grid-template-columns: 96px 44px;
	}

	.check {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 14px;
		cursor: pointer;
	}

	.theme-preview {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 14px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-background);
		color: var(--color-text);
		font-family: var(--font-body);
	}

	.preview-card {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-surface);
	}

	.preview-heading {
		margin: 0;
		font-family: var(--font-heading);
		font-size: 17px;
		font-weight: 600;
	}

	.preview-body,
	.preview-muted {
		margin: 0;
		font-size: 13px;
	}

	.preview-muted {
		color: var(--color-text-secondary);
	}

	.preview-actions,
	.preview-status {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		font-size: 13px;
	}

	.preview-manuscript {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 12px;
		border-radius: 8px;
		background: var(--editor-background);
		color: var(--editor-text);
		font-family: var(--font-editor);
		font-size: 15px;
		line-height: 1.9;
	}

	.preview-manuscript p {
		margin: 0;
	}

	.sel {
		background: var(--editor-selection);
	}

	.line-hl {
		background: var(--editor-line-highlight);
	}

	.caret {
		display: inline-block;
		width: 2px;
		height: 1em;
		background: var(--editor-cursor);
		vertical-align: text-bottom;
	}

	.warnings {
		margin: 0;
		padding: 10px 12px 10px 28px;
		border: 1px solid var(--color-warning);
		border-radius: 8px;
		color: var(--color-warning);
		font-size: 13px;
	}

	.footer {
		display: flex;
		justify-content: flex-end;
		gap: 12px;
	}

	@media (max-width: 768px) {
		.editor-layout {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
