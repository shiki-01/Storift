<script lang="ts">
	// 設定「AI」: Ollama の項目
	import { onMount } from 'svelte';
	import { aiStore } from '$lib/stores/ai.svelte';
	import { DEFAULT_OLLAMA_URL } from '$lib/ai/settings';

	let s = $derived(aiStore.settings.ollama);
	let status = $derived(aiStore.status);

	onMount(() => {
		if (!aiStore.status) void aiStore.checkStatus();
	});
</script>

<div class="status">
	<span class="dot" class:ok={status?.found} class:ng={status !== null && !status.found}></span>
	<div class="status-body">
		{#if status?.found}
			<span class="status-main">{status.version} に接続しました</span>
		{:else if status}
			<span class="status-main">Ollama に接続できません</span>
			<span class="hint">{status.error}</span>
		{:else}
			<span class="status-main">確認中…</span>
		{/if}
	</div>
	<div class="status-actions">
		<button class="ghost" onclick={() => aiStore.checkStatus()}>再確認</button>
	</div>
</div>

<div class="field">
	<label for="ollama-url">接続先</label>
	<div class="field-body">
		<input
			id="ollama-url"
			type="text"
			placeholder={DEFAULT_OLLAMA_URL}
			value={s.url}
			onchange={(e) =>
				aiStore.updateProviderSettings('ollama', { url: e.currentTarget.value.trim() })}
		/>
	</div>
</div>

<div class="field">
	<label for="ollama-model">モデル</label>
	<div class="field-body">
		<input
			id="ollama-model"
			type="text"
			list="ollama-models"
			placeholder="例: qwen3:8b"
			value={s.model}
			onchange={(e) =>
				aiStore.updateProviderSettings('ollama', { model: e.currentTarget.value.trim() })}
		/>
		<datalist id="ollama-models">
			{#each status?.models ?? [] as name (name)}
				<option value={name}></option>
			{/each}
		</datalist>
		<p class="hint">
			ツール呼び出しに対応したモデルを選んでください。対応していないモデルでは、原稿を読めません。
		</p>
	</div>
</div>
