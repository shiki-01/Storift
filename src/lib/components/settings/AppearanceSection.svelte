<script lang="ts">
	// 設定「外観」: テーマの選択・作成・読み込み・書き出し
	import { toast, confirmDialog } from '$lib/stores/toast.svelte';
	import { themeStore, type Theme } from '$lib/stores/theme.svelte';
	import { parseThemeFile, serializeTheme } from '$lib/utils/themeTools';
	import ThemeEditor from '$lib/components/ui/ThemeEditor.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import SettingsCard from './SettingsCard.svelte';
	import SettingsRow from './SettingsRow.svelte';
	import type { SettingsForm } from './settingsForm.svelte';

	let { form }: { form: SettingsForm } = $props();

	// テーマ変更
	async function handleThemeChange(themeId: string) {
		// パックのテーマの ID は、同期やバックアップに入る設定には書かない(パックはこの端末だけのもの)
		if (!themeId.startsWith('pack:')) form.settings.theme = themeId as 'light' | 'dark' | 'auto';
		await themeStore.setTheme(themeId);
		await form.save();
	}

	// 自動テーマ切替
	const handleAutoThemeToggle = async () => {
		form.settings.autoTheme = !form.settings.autoTheme;
		await themeStore.setAutoTheme(form.settings.autoTheme);
		await form.save();
	};

	// テーマエディタ(新規作成・編集)
	let themeEditorOpen = $state(false);
	let themeEditorTarget = $state<Theme | null>(null);
	let themeFileInput: HTMLInputElement | undefined = $state();

	function openThemeEditor(target: Theme | null) {
		themeEditorTarget = target;
		themeEditorOpen = true;
	}

	async function handleThemeEditorSaved(theme: Theme) {
		form.settings.theme = theme.id;
		await form.save();
	}

	// テーマの書き出し(選択中のテーマを JSON ファイルとして保存)
	async function handleThemeExport() {
		const theme = themeStore.theme;
		const { saveAs } = await import('file-saver');
		const blob = new Blob([serializeTheme(theme)], { type: 'application/json' });
		const fileName = theme.name.replace(/[\\/:*?"<>|]/g, '_');
		saveAs(blob, `${fileName}.storift-theme.json`);
	}

	// テーマの読み込み(検証に通ったものを保存する。適用はしない)
	async function handleThemeFileChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		try {
			const theme = parseThemeFile(await file.text());
			await themeStore.saveCustomTheme(theme);
			toast.success(`「${theme.name}」を読み込みました`);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			toast.error(`テーマを読み込めませんでした: ${reason}`);
		}
	}

	// カスタムテーマの削除
	async function handleThemeDelete(theme: Theme) {
		const ok = await confirmDialog({
			title: 'テーマを削除',
			message: `「${theme.name}」を削除します。この操作は元に戻せません。`,
			confirmText: '削除',
			danger: true
		});
		if (!ok) return;
		await themeStore.deleteCustomTheme(theme.id);
		form.settings.theme = themeStore.theme.id;
		await form.save();
		toast.success(`「${theme.name}」を削除しました`);
	}
</script>

<SettingsCard
	data-tour="settings-theme"
	title="テーマ"
	description="画面の配色を選びます。自分の配色を作って、書き出し・読み込みもできます。"
>
	<SettingsRow
		label="システム設定に従う"
		description="端末のライト/ダークの設定に合わせて、テーマを自動で切り替えます。"
		labelFor="autoTheme"
	>
		<input
			id="autoTheme"
			type="checkbox"
			checked={form.settings.autoTheme}
			onchange={handleAutoThemeToggle}
		/>
	</SettingsRow>

	<!-- テーマの見本: 紙の色に、題字と本文の線、差し色の点を載せる -->
	<div class="theme-grid" role="radiogroup" aria-label="テーマ">
		{#each themeStore.allThemes as theme (theme.id)}
			{@const selected = themeStore.theme.id === theme.id && !form.settings.autoTheme}
			<div class="theme-item">
				<button
					class="theme-card"
					class:selected
					role="radio"
					aria-checked={selected}
					onclick={() => handleThemeChange(theme.id)}
					disabled={form.settings.autoTheme}
				>
					<span
						class="theme-swatch"
						style="background:{theme.editor.background};color:{theme.colors
							.text};border-color:{theme.colors.border}"
					>
						<span class="swatch-title">あ</span>
						<span class="swatch-lines">
							<span style="background:{theme.colors.text}"></span>
							<span style="background:{theme.colors.textSecondary}"></span>
							<span style="background:{theme.colors.textSecondary}"></span>
						</span>
						<span class="swatch-dots">
							<span style="background:{theme.colors.primary}"></span>
							<span style="background:{theme.colors.accent}"></span>
							<span style="background:{theme.colors.success}"></span>
						</span>
					</span>
					<span class="theme-name">
						{theme.name}
						{#if theme.id.startsWith('pack:')}<span class="theme-pack">パック</span>{/if}
						{#if selected}
							<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"
								><path
									d="M2.5 6.2l2.3 2.3 4.7-5"
									fill="none"
									stroke="currentColor"
									stroke-width="1.8"
									stroke-linecap="round"
									stroke-linejoin="round"
								/></svg
							>
						{/if}
					</span>
				</button>
				{#if theme.id.startsWith('custom-')}
					<div class="theme-actions">
						<button type="button" class="theme-action" onclick={() => openThemeEditor(theme)}>
							編集
						</button>
						<button type="button" class="theme-action" onclick={() => handleThemeDelete(theme)}>
							削除
						</button>
					</div>
				{/if}
			</div>
		{/each}
	</div>

	<div class="theme-tools">
		<Button variant="secondary" size="sm" onclick={() => openThemeEditor(null)}>
			＋ テーマを作る
		</Button>
		<Button variant="secondary" size="sm" onclick={() => themeFileInput?.click()}>
			テーマを読み込む(.json)
		</Button>
		<Button variant="secondary" size="sm" onclick={handleThemeExport}>書き出す</Button>
		<input
			bind:this={themeFileInput}
			type="file"
			accept=".json,application/json"
			hidden
			onchange={handleThemeFileChange}
		/>
	</div>
</SettingsCard>

<ThemeEditor
	bind:isOpen={themeEditorOpen}
	target={themeEditorTarget}
	onSaved={handleThemeEditorSaved}
/>

<style>
	.theme-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 12px;
		margin-top: 8px;
		padding-top: 16px;
		border-top: 1px solid var(--color-border);
	}

	.theme-card {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 0;
		border: none;
		background: none;
		color: var(--color-text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.theme-card:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.theme-swatch {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 10px;
		aspect-ratio: 4 / 3;
		padding: 12px 14px;
		border: 1px solid;
		border-radius: 10px;
		transition:
			box-shadow 0.15s,
			transform 0.2s ease;
	}

	.theme-card:hover:not(:disabled) .theme-swatch {
		transform: translateY(-2px);
	}

	.theme-card.selected .theme-swatch {
		box-shadow:
			0 0 0 2px var(--color-background),
			0 0 0 4px var(--color-primary);
	}

	.swatch-title {
		font-family: 'Noto Serif JP', serif;
		font-size: 18px;
		font-weight: 600;
		line-height: 1;
	}

	.swatch-lines {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.swatch-lines span {
		height: 3px;
		border-radius: 2px;
		opacity: 0.55;
	}

	.swatch-lines span:nth-child(1) {
		width: 80%;
	}

	.swatch-lines span:nth-child(2) {
		width: 92%;
	}

	.swatch-lines span:nth-child(3) {
		width: 60%;
	}

	.swatch-dots {
		position: absolute;
		right: 12px;
		bottom: 10px;
		display: flex;
		gap: 4px;
	}

	.swatch-dots span {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}

	.theme-item {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}

	.theme-actions {
		display: flex;
		gap: 12px;
		padding-left: 2px;
	}

	.theme-action {
		padding: 0;
		border: none;
		background: none;
		color: var(--color-text-secondary);
		font: inherit;
		font-size: 12px;
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}

	.theme-action:hover {
		color: var(--color-primary);
	}

	.theme-tools {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 16px;
	}

	.theme-name {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding-left: 2px;
		font-size: 13px;
	}

	.theme-pack {
		padding: 1px 6px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		font-size: 10.5px;
		font-weight: 400;
		line-height: 1.4;
		color: var(--color-text-secondary);
	}

	.theme-card.selected .theme-name {
		font-weight: 600;
		color: var(--color-primary);
	}

	@media (prefers-reduced-motion: reduce) {
		.theme-swatch {
			transition: none;
		}

		.theme-card:hover:not(:disabled) .theme-swatch {
			transform: none;
		}
	}

	@media (max-width: 768px) {
		.theme-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
