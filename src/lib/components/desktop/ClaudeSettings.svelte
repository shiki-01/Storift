<script lang="ts">
	// 設定画面の「Claude Code」の項目(デスクトップ版のみ)
	import { onMount } from 'svelte';
	import { claudeStore, EDIT_MODE_LABELS, type EditMode } from '$lib/stores/claude.svelte';
	import { getWorkspacePath, openWorkspace } from '$lib/desktop/claude';

	const MODELS = [
		{ value: '', label: '既定' },
		{ value: 'sonnet', label: 'Sonnet' },
		{ value: 'opus', label: 'Opus' },
		{ value: 'haiku', label: 'Haiku' }
	];

	const EDIT_MODE_HINTS: Record<EditMode, string> = {
		suggest: '修正案を文章で示すだけで、本文は書き換えません。',
		confirm: '編集案を差分で確認し、1 件ずつ(または「すべて反映」で)反映します。',
		auto: '回答が終わると本文を書き換えます。変更は本文上に色付きで残り、後から保持・元に戻すを選べます。'
	};

	let workspacePath = $state('');
	let loginError = $state('');

	let isPreset = $derived(MODELS.some((m) => m.value === claudeStore.settings.model));

	async function openLogin() {
		loginError = '';
		try {
			await claudeStore.openLogin();
		} catch (error) {
			loginError = String(error);
		}
	}

	onMount(async () => {
		if (!claudeStore.status) void claudeStore.checkStatus();
		workspacePath = (await getWorkspacePath()).path;
	});
</script>

<div class="claude-settings">
	<div class="status">
		<span
			class="dot"
			class:ok={claudeStore.status?.found && claudeStore.status.loggedIn !== false}
			class:ng={claudeStore.status !== null &&
				(!claudeStore.status.found || claudeStore.status.loggedIn === false)}
		></span>
		<div class="status-body">
			{#if claudeStore.status?.found}
				<span class="status-main">
					{claudeStore.status.version}
					・ログイン{claudeStore.status.loggedIn === true
						? '済み'
						: claudeStore.status.loggedIn === false
							? 'していません'
							: '状態は不明'}
				</span>
				<code>{claudeStore.status.path}</code>
			{:else if claudeStore.status}
				<span class="status-main">Claude Code が見つかりません</span>
				<span class="hint">{claudeStore.status.error}</span>
			{:else}
				<span class="status-main">確認中…</span>
			{/if}
		</div>
		<div class="status-actions">
			<button class="ghost" onclick={() => claudeStore.checkStatus()}>再確認</button>
			<button class="ghost" onclick={openLogin}>ログイン</button>
		</div>
	</div>
	{#if loginError}<p class="hint error">{loginError}</p>{/if}

	<div class="field">
		<label for="claude-model">モデル</label>
		<div class="field-body">
			<select
				id="claude-model"
				value={isPreset ? claudeStore.settings.model : '__custom'}
				onchange={(e) => {
					const v = e.currentTarget.value;
					if (v !== '__custom') claudeStore.updateSettings({ model: v });
				}}
			>
				{#each MODELS as m (m.value)}
					<option value={m.value}>{m.label}</option>
				{/each}
				<option value="__custom">その他(モデル名を入力)</option>
			</select>
			{#if !isPreset}
				<input
					type="text"
					aria-label="モデル名"
					placeholder="例: claude-sonnet-5-5"
					value={claudeStore.settings.model}
					onchange={(e) => claudeStore.updateSettings({ model: e.currentTarget.value.trim() })}
				/>
			{/if}
		</div>
	</div>

	<div class="field">
		<span class="field-label">本文の編集</span>
		<div class="field-body">
			<div class="modes" role="radiogroup" aria-label="本文の編集">
				{#each Object.entries(EDIT_MODE_LABELS) as [value, label] (value)}
					<label class="mode" class:on={claudeStore.settings.editMode === value}>
						<input
							type="radio"
							name="claude-edit-mode"
							{value}
							checked={claudeStore.settings.editMode === value}
							onchange={() => claudeStore.updateSettings({ editMode: value as EditMode })}
						/>
						<span class="mode-label">{label}</span>
						<span class="mode-hint">{EDIT_MODE_HINTS[value as EditMode]}</span>
					</label>
				{/each}
			</div>
		</div>
	</div>

	<div class="field">
		<label for="claude-path">claude の場所</label>
		<div class="field-body">
			<input
				id="claude-path"
				type="text"
				placeholder="空なら自動で探します"
				value={claudeStore.settings.claudePath}
				onchange={(e) => claudeStore.updateSettings({ claudePath: e.currentTarget.value.trim() })}
			/>
		</div>
	</div>

	<label class="check">
		<input
			type="checkbox"
			checked={claudeStore.settings.allowWeb}
			onchange={(e) => claudeStore.updateSettings({ allowWeb: e.currentTarget.checked })}
		/>
		Web 検索を許可する
	</label>

	<div class="workspace">
		<p class="hint">
			原稿は送信のたびに <code>{workspacePath || 'workspace'}</code> へ Markdown で書き出され(未保存の本文も含む)、Claude
			Code はそこを読み取り専用で参照します。本文の書き換えは「本文の編集」の設定に従い、アプリが行います。
		</p>
		<button class="ghost" onclick={() => openWorkspace()}>ワークスペースを開く</button>
	</div>
</div>

<style>
	.claude-settings {
		display: flex;
		flex-direction: column;
		gap: 18px;
		font-size: 14px;
	}

	.status {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 14px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--color-surface);
	}

	.dot {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--color-text-secondary);
	}

	.dot.ok {
		background: var(--color-success);
	}

	.dot.ng {
		background: var(--color-error);
	}

	.status-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.status-main {
		font-weight: 600;
	}

	.status-actions {
		display: flex;
		gap: 6px;
	}

	.field {
		display: grid;
		grid-template-columns: 8rem 1fr;
		gap: 12px;
		align-items: start;
	}

	.field > label,
	.field-label {
		padding-top: 7px;
		color: var(--color-text-secondary);
		font-size: 13px;
	}

	.field-body {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}

	select,
	input[type='text'] {
		width: 100%;
		height: 36px;
		padding: 0 10px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background-color: var(--color-background);
		color: var(--color-text);
		font: inherit;
		font-size: 14px;
	}

	.modes {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.mode {
		display: grid;
		grid-template-columns: auto 1fr;
		column-gap: 10px;
		row-gap: 2px;
		padding: 10px 12px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		cursor: pointer;
		transition:
			border-color 0.15s,
			background-color 0.15s;
	}

	.mode:hover {
		background: var(--hover);
	}

	.mode.on {
		border-color: color-mix(in srgb, var(--color-primary) 55%, var(--color-border));
		background: var(--selected);
	}

	.mode input {
		grid-row: span 2;
		margin-top: 3px;
		accent-color: var(--color-primary);
	}

	.mode-label {
		font-weight: 600;
	}

	.mode-hint {
		font-size: 12px;
		line-height: 1.6;
		color: var(--color-text-secondary);
	}

	.check {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
	}

	.check input {
		accent-color: var(--color-primary);
	}

	.workspace {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
	}

	.hint {
		margin: 0;
		font-size: 12px;
		line-height: 1.7;
		color: var(--color-text-secondary);
		word-break: break-all;
	}

	.hint.error {
		color: var(--color-error);
	}

	code {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 12px;
		color: var(--color-text-secondary);
		word-break: break-all;
	}

	.ghost {
		height: 30px;
		padding: 0 12px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		color: var(--color-text);
		font: inherit;
		font-size: 12.5px;
		white-space: nowrap;
		cursor: pointer;
	}

	.ghost:hover {
		background: var(--hover);
	}

	@media (max-width: 768px) {
		.field {
			grid-template-columns: 1fr;
			gap: 6px;
		}

		.status {
			flex-wrap: wrap;
		}
	}
</style>
