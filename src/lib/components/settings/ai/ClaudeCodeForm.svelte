<script lang="ts">
	// 設定「AI」: Claude Code の項目
	import { onMount } from 'svelte';
	import { aiStore } from '$lib/stores/ai.svelte';

	const MODELS = [
		{ value: '', label: '既定' },
		{ value: 'sonnet', label: 'Sonnet' },
		{ value: 'opus', label: 'Opus' },
		{ value: 'haiku', label: 'Haiku' }
	];

	let s = $derived(aiStore.settings.claudeCode);
	let status = $derived(aiStore.status);
	let isPreset = $derived(MODELS.some((m) => m.value === s.model));
	let loginError = $state('');

	async function openLogin() {
		loginError = '';
		try {
			await aiStore.openLogin();
		} catch (error) {
			loginError = String(error);
		}
	}

	onMount(() => {
		if (!aiStore.status) void aiStore.checkStatus();
	});
</script>

<div class="status">
	<span
		class="dot"
		class:ok={status?.found && status.loggedIn !== false}
		class:ng={status !== null && (!status.found || status.loggedIn === false)}
	></span>
	<div class="status-body">
		{#if status?.found}
			<span class="status-main">
				{status.version}
				・ログイン{status.loggedIn === true
					? '済み'
					: status.loggedIn === false
						? 'していません'
						: '状態は不明'}
			</span>
			<code>{status.path}</code>
		{:else if status}
			<span class="status-main">Claude Code が見つかりません</span>
			<span class="hint">{status.error}</span>
		{:else}
			<span class="status-main">確認中…</span>
		{/if}
	</div>
	<div class="status-actions">
		<button class="ghost" onclick={() => aiStore.checkStatus()}>再確認</button>
		<button class="ghost" onclick={openLogin}>ログイン</button>
	</div>
</div>
{#if loginError}<p class="hint error">{loginError}</p>{/if}

<div class="field">
	<label for="claude-model">モデル</label>
	<div class="field-body">
		<select
			id="claude-model"
			value={isPreset ? s.model : '__custom'}
			onchange={(e) => {
				const v = e.currentTarget.value;
				if (v !== '__custom') aiStore.updateProviderSettings('claudeCode', { model: v });
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
				value={s.model}
				onchange={(e) =>
					aiStore.updateProviderSettings('claudeCode', { model: e.currentTarget.value.trim() })}
			/>
		{/if}
	</div>
</div>

<div class="field">
	<label for="claude-path">claude の場所</label>
	<div class="field-body">
		<input
			id="claude-path"
			type="text"
			placeholder="空なら自動で探します"
			value={s.claudePath}
			onchange={(e) =>
				aiStore.updateProviderSettings('claudeCode', { claudePath: e.currentTarget.value.trim() })}
		/>
	</div>
</div>

<label class="check">
	<input
		type="checkbox"
		checked={s.allowWeb}
		onchange={(e) =>
			aiStore.updateProviderSettings('claudeCode', { allowWeb: e.currentTarget.checked })}
	/>
	Web 検索を許可する
</label>
