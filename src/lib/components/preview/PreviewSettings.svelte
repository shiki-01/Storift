<script lang="ts">
	import type { PreviewSettings, WritingMode, TextOrientation } from '$lib/types';
	import Button from '$lib/components/ui/Button.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';

	interface Props {
		settings: PreviewSettings;
		onSettingsChange: (settings: PreviewSettings) => void;
		onClose?: () => void;
		showHeader?: boolean;
	}

	let { settings, onSettingsChange, onClose, showHeader = false }: Props = $props();

	// ローカル設定（編集用）
	let localSettings = $state({ ...settings });

	// 設定変更を親に通知
	function updateSettings() {
		onSettingsChange({ ...localSettings });
	}

	// 設定をリセット
	function resetSettings() {
		localSettings = {
			writingMode: 'vertical',
			textOrientation: 'mixed',
			fontSize: 16,
			lineHeight: 1.8,
			letterSpacing: 0.05,
			fontFamily: 'noto-serif',
			lineLength: 40,
			linesPerPage: 20,
			manuscriptMode: false,
			manuscriptColumns: 20,
			manuscriptRows: 20,
			showRuby: true,
			showBouten: true,
			showLineNumbers: false,
			showPageNumbers: true,
		};
		updateSettings();
	}

	// 書字方向の選択肢
	const writingModes: { value: WritingMode; label: string }[] = [
		{ value: 'vertical', label: '縦書き' },
		{ value: 'horizontal', label: '横書き' },
	];

	// 文字の向きの選択肢
	const textOrientations: { value: TextOrientation; label: string }[] = [
		{ value: 'mixed', label: '混合' },
		{ value: 'upright', label: '正立' },
		{ value: 'sideways', label: '横倒し' },
	];

	// フォントの選択肢
	const fonts = [
		{ value: 'noto-serif', label: 'Noto Serif JP' },
		{ value: 'noto-sans', label: 'Noto Sans JP' },
		{ value: 'yu-gothic', label: '游ゴシック' },
		{ value: 'hiragino-mincho', label: 'ヒラギノ明朝' },
		{ value: 'sawarabi-mincho', label: 'さわらび明朝' },
		{ value: 'sawarabi-gothic', label: 'さわらびゴシック' },
	];

	// 原稿用紙の列数選択肢
	const manuscriptColumnsOptions = [20, 25, 30] as const;
	const manuscriptRowsOptions = [10, 20] as const;
</script>

<div class="settings-panel">
	{#if showHeader}
		<div class="settings-header">
			<h3 class="settings-title">プレビュー設定</h3>
			{#if onClose}
				<button class="close-button" onclick={onClose}>
					<Icon name="x" />
				</button>
			{/if}
		</div>
	{/if}

	<div class="settings-content">
		<!-- 表示モード -->
		<section class="settings-section">
			<h4 class="section-title">表示モード</h4>
			
			<div class="setting-group">
				<span class="setting-label">書字方向</span>
				<div class="toggle-group" role="radiogroup" aria-label="書字方向">
					{#each writingModes as mode}
						<button
							class="toggle-button"
							class:active={localSettings.writingMode === mode.value}
							onclick={() => {
								localSettings.writingMode = mode.value;
								updateSettings();
							}}
						>
							{mode.label}
						</button>
					{/each}
				</div>
			</div>

			{#if localSettings.writingMode === 'vertical'}
				<div class="setting-group">
					<span class="setting-label">英数字の向き</span>
					<div class="toggle-group" role="radiogroup" aria-label="英数字の向き">
						{#each textOrientations as orientation}
							<button
								class="toggle-button"
								class:active={localSettings.textOrientation === orientation.value}
								onclick={() => {
									localSettings.textOrientation = orientation.value;
									updateSettings();
								}}
							>
								{orientation.label}
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</section>

		<!-- フォント設定 -->
		<section class="settings-section">
			<h4 class="section-title">フォント設定</h4>
			
			<div class="setting-group">
				<label class="setting-label" for="font-select">フォント</label>
				<select
					id="font-select"
					class="setting-select"
					bind:value={localSettings.fontFamily}
					onchange={updateSettings}
				>
					{#each fonts as font}
						<option value={font.value}>{font.label}</option>
					{/each}
				</select>
			</div>

			<div class="setting-group">
				<label class="setting-label" for="font-size-range">
					フォントサイズ: {localSettings.fontSize}px
				</label>
				<input
					id="font-size-range"
					type="range"
					class="setting-range"
					min="12"
					max="28"
					step="1"
					bind:value={localSettings.fontSize}
					oninput={updateSettings}
				/>
			</div>

			<div class="setting-group">
				<label class="setting-label" for="line-height-range">
					行間: {localSettings.lineHeight.toFixed(1)}
				</label>
				<input
					id="line-height-range"
					type="range"
					class="setting-range"
					min="1.2"
					max="3.0"
					step="0.1"
					bind:value={localSettings.lineHeight}
					oninput={updateSettings}
				/>
			</div>

			<div class="setting-group">
				<label class="setting-label" for="letter-spacing-range">
					字間: {localSettings.letterSpacing.toFixed(2)}em
				</label>
				<input
					id="letter-spacing-range"
					type="range"
					class="setting-range"
					min="-0.05"
					max="0.2"
					step="0.01"
					bind:value={localSettings.letterSpacing}
					oninput={updateSettings}
				/>
			</div>
		</section>

		<!-- レイアウト -->
		<section class="settings-section">
			<h4 class="section-title">レイアウト</h4>
			
			<div class="setting-group">
				<label class="setting-label" for="line-length-range">
					1行の文字数: {localSettings.lineLength}文字
				</label>
				<input
					id="line-length-range"
					type="range"
					class="setting-range"
					min="20"
					max="60"
					step="5"
					bind:value={localSettings.lineLength}
					oninput={updateSettings}
				/>
			</div>

			<div class="setting-group">
				<label class="setting-label" for="lines-per-page-range">
					1ページの行数: {localSettings.linesPerPage}行
				</label>
				<input
					id="lines-per-page-range"
					type="range"
					class="setting-range"
					min="10"
					max="40"
					step="5"
					bind:value={localSettings.linesPerPage}
					oninput={updateSettings}
				/>
			</div>
		</section>

		<!-- 原稿用紙モード -->
		<section class="settings-section">
			<h4 class="section-title">原稿用紙モード</h4>
			
			<div class="setting-group">
				<label class="setting-checkbox">
					<input
						type="checkbox"
						bind:checked={localSettings.manuscriptMode}
						onchange={updateSettings}
					/>
					<span>原稿用紙モードを有効にする</span>
				</label>
			</div>

			{#if localSettings.manuscriptMode}
				<div class="setting-group">
					<span class="setting-label">1行の文字数</span>
					<div class="toggle-group" role="radiogroup" aria-label="1行の文字数">
						{#each manuscriptColumnsOptions as cols}
							<button
								class="toggle-button"
								class:active={localSettings.manuscriptColumns === cols}
								onclick={() => {
									localSettings.manuscriptColumns = cols;
									updateSettings();
								}}
							>
								{cols}字
							</button>
						{/each}
					</div>
				</div>

				<div class="setting-group">
					<span class="setting-label">行数</span>
					<div class="toggle-group" role="radiogroup" aria-label="行数">
						{#each manuscriptRowsOptions as rowCount}
							<button
								class="toggle-button"
								class:active={localSettings.manuscriptRows === rowCount}
								onclick={() => {
									localSettings.manuscriptRows = rowCount;
									updateSettings();
								}}
							>
								{rowCount}行
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</section>

		<!-- 表示オプション -->
		<section class="settings-section">
			<h4 class="section-title">表示オプション</h4>
			
			<div class="setting-group">
				<label class="setting-checkbox">
					<input
						type="checkbox"
						bind:checked={localSettings.showRuby}
						onchange={updateSettings}
					/>
					<span>ルビを表示</span>
				</label>
			</div>

			<div class="setting-group">
				<label class="setting-checkbox">
					<input
						type="checkbox"
						bind:checked={localSettings.showBouten}
						onchange={updateSettings}
					/>
					<span>圏点を表示</span>
				</label>
			</div>

			<div class="setting-group">
				<label class="setting-checkbox">
					<input
						type="checkbox"
						bind:checked={localSettings.showLineNumbers}
						onchange={updateSettings}
					/>
					<span>行番号を表示</span>
				</label>
			</div>

			<div class="setting-group">
				<label class="setting-checkbox">
					<input
						type="checkbox"
						bind:checked={localSettings.showPageNumbers}
						onchange={updateSettings}
					/>
					<span>ページ番号を表示</span>
				</label>
			</div>
		</section>
	</div>

	<div class="settings-footer">
		<Button variant="secondary" onclick={resetSettings}>
			初期設定に戻す
		</Button>
	</div>
</div>

<style>
	.settings-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--color-background, #fff);
	}

	.settings-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem;
		border-bottom: 1px solid var(--color-border, #e0e0e0);
	}

	.settings-title {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: var(--color-text, #333);
	}

	.close-button {
		padding: 0.25rem;
		background: transparent;
		border: none;
		cursor: pointer;
		color: var(--color-text-secondary, #666);
		border-radius: 4px;
	}

	.close-button:hover {
		background: var(--color-hover, #f0f0f0);
	}

	.settings-content {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
	}

	.settings-section {
		margin-bottom: 1.5rem;
	}

	.section-title {
		margin: 0 0 0.75rem 0;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--color-text, #333);
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--color-border, #e0e0e0);
	}

	.setting-group {
		margin-bottom: 1rem;
	}

	.setting-label {
		display: block;
		margin-bottom: 0.5rem;
		font-size: 0.8125rem;
		color: var(--color-text-secondary, #666);
	}

	.toggle-group {
		display: flex;
		gap: 0.25rem;
		background: var(--color-surface, #f5f5f5);
		padding: 0.25rem;
		border-radius: 6px;
	}

	.toggle-button {
		flex: 1;
		padding: 0.5rem 0.75rem;
		font-size: 0.8125rem;
		background: transparent;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		color: var(--color-text-secondary, #666);
		transition: all 0.2s;
	}

	.toggle-button:hover {
		background: var(--color-hover, #e0e0e0);
	}

	.toggle-button.active {
		background: var(--color-primary, #4a90d9);
		color: white;
	}

	.setting-select {
		width: 100%;
		padding: 0.5rem;
		font-size: 0.875rem;
		border: 1px solid var(--color-border, #e0e0e0);
		border-radius: 6px;
		background: var(--color-background, #fff);
		color: var(--color-text, #333);
	}

	.setting-range {
		width: 100%;
		accent-color: var(--color-primary, #4a90d9);
	}

	.setting-checkbox {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
		color: var(--color-text, #333);
		cursor: pointer;
	}

	.setting-checkbox input {
		width: 1rem;
		height: 1rem;
		accent-color: var(--color-primary, #4a90d9);
	}

	.settings-footer {
		padding: 1rem;
		border-top: 1px solid var(--color-border, #e0e0e0);
	}
</style>
