<script lang="ts">
	// 設定「AI」: OpenAI 互換 API の項目(プリセット・Base URL・API キー・モデル・接続テスト)
	import { onMount } from 'svelte';
	import { aiStore } from '$lib/stores/ai.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import { registry } from '$lib/ai/registry';
	import { validateBaseUrl } from '$lib/ai/http/url';
	import { OPENAI_PRESETS, findPreset } from '$lib/ai/providers/openaiPresets';
	import {
		deleteSecret,
		getSecret,
		secretBackend,
		setSecret,
		type SecretBackend
	} from '$lib/ai/secrets';
	import type { AiSettings } from '$lib/ai/types';

	const PROVIDER_ID = 'openai-compatible';

	let s = $derived(aiStore.settings.openaiCompatible);
	let preset = $derived(findPreset(s.presetId));
	let urlCheck = $derived(validateBaseUrl(s.baseUrl));

	let backend = $state<SecretBackend | null>(null);
	let hasKey = $state(false);
	let keyInput = $state('');
	let showKey = $state(false);
	let keyMessage = $state('');
	let keyError = $state('');
	let busy = $state(false);

	let models = $state<string[]>([]);
	let modelsError = $state('');
	let loadingModels = $state(false);
	let testing = $state(false);
	let testResult = $state<{ ok: boolean; message: string } | null>(null);

	async function refreshKey() {
		keyError = '';
		try {
			backend = await secretBackend();
			hasKey = !!(await getSecret(PROVIDER_ID, s.presetId));
		} catch (error) {
			keyError = error instanceof Error ? error.message : String(error);
		}
	}

	// プリセットを切り替えたら、そのプリセットのキーの有無を読み直す
	$effect(() => {
		void s.presetId;
		void refreshKey();
	});

	onMount(() => {
		if (!aiStore.status) void aiStore.checkStatus();
	});

	const presetOptions = OPENAI_PRESETS.map((p) => ({ value: p.id, label: p.label }));

	function selectPreset(id: string) {
		if (id === s.presetId) return;
		const next = findPreset(id);
		aiStore.updateProviderSettings('openaiCompatible', {
			presetId: id,
			baseUrl: next.baseUrl,
			model: ''
		});
		models = [];
		modelsError = '';
		testResult = null;
		keyInput = '';
		keyMessage = '';
	}

	async function saveKey() {
		const value = keyInput.trim();
		if (!value) return;
		busy = true;
		keyError = '';
		keyMessage = '';
		try {
			await setSecret(PROVIDER_ID, s.presetId, value);
			keyInput = '';
			showKey = false;
			hasKey = true;
			keyMessage = 'API キーを保存しました。';
			void aiStore.checkStatus();
		} catch (error) {
			keyError = `API キーを保存できませんでした: ${error instanceof Error ? error.message : String(error)}`;
		} finally {
			busy = false;
		}
	}

	async function removeKey() {
		busy = true;
		keyError = '';
		keyMessage = '';
		try {
			await deleteSecret(PROVIDER_ID, s.presetId);
			hasKey = false;
			keyInput = '';
			keyMessage = 'API キーを削除しました。';
			void aiStore.checkStatus();
		} catch (error) {
			keyError = `API キーを削除できませんでした: ${error instanceof Error ? error.message : String(error)}`;
		} finally {
			busy = false;
		}
	}

	function snapshot(): AiSettings {
		return $state.snapshot(aiStore.settings) as AiSettings;
	}

	async function loadModels() {
		const provider = registry.get(PROVIDER_ID);
		if (!provider?.listModels) return;
		loadingModels = true;
		modelsError = '';
		try {
			models = await provider.listModels(snapshot());
			if (!models.length)
				modelsError = 'モデルが見つかりませんでした。モデル名を直接入力してください。';
		} catch (error) {
			modelsError = error instanceof Error ? error.message : String(error);
		} finally {
			loadingModels = false;
		}
	}

	async function testConnection() {
		const provider = registry.get(PROVIDER_ID);
		if (!provider?.testConnection) return;
		testing = true;
		testResult = null;
		try {
			const result = await provider.testConnection(snapshot());
			testResult = result;
			if (result.models) models = result.models;
		} finally {
			testing = false;
		}
	}
</script>

<div class="field">
	<label for="oa-preset">サービス</label>
	<div class="field-body">
		<Select
			id="oa-preset"
			options={presetOptions}
			value={s.presetId}
			onchange={(v) => selectPreset(v)}
		/>
		{#if preset.note}<p class="hint">{preset.note}</p>{/if}
	</div>
</div>

<div class="field">
	<label for="oa-url">Base URL</label>
	<div class="field-body">
		<input
			id="oa-url"
			type="text"
			placeholder="https://api.example.com/v1"
			value={s.baseUrl}
			onchange={(e) =>
				aiStore.updateProviderSettings('openaiCompatible', {
					baseUrl: e.currentTarget.value.trim()
				})}
		/>
		{#if !urlCheck.ok && s.baseUrl}<p class="hint error">{urlCheck.error}</p>{/if}
		<p class="hint">https:// か、この端末内(localhost など)の http:// だけ指定できます。</p>
	</div>
</div>

<div class="field">
	<label for="oa-key">API キー</label>
	<div class="field-body">
		<div class="inline">
			<input
				id="oa-key"
				type={showKey ? 'text' : 'password'}
				autocomplete="off"
				spellcheck="false"
				placeholder={hasKey
					? '保存済み(変更するときは新しいキーを入力)'
					: preset.keyRequired
						? 'API キーを入力'
						: '不要なサービスでは空のままで構いません'}
				bind:value={keyInput}
			/>
			<button
				class="ghost"
				type="button"
				onclick={() => (showKey = !showKey)}
				aria-pressed={showKey}
			>
				{showKey ? '隠す' : '表示'}
			</button>
		</div>
		<div class="inline">
			<button class="ghost" type="button" onclick={saveKey} disabled={busy || !keyInput.trim()}>
				キーを保存
			</button>
			<button class="ghost" type="button" onclick={removeKey} disabled={busy || !hasKey}>
				キーを削除
			</button>
			<span class="hint">{hasKey ? '保存済み' : '未設定'}</span>
		</div>
		{#if keyMessage}<p class="hint">{keyMessage}</p>{/if}
		{#if keyError}<p class="hint error">{keyError}</p>{/if}
		{#if backend === 'keychain'}
			<p class="hint">キーは OS のキーチェーンに保存され、上の Base URL にだけ送られます。</p>
		{:else if backend === 'local'}
			<p class="hint warn">
				この環境ではキーチェーンを使えないため、キーは端末内に平文で保存されます。キーは上の Base
				URL にだけ送られます。
			</p>
		{/if}
	</div>
</div>

<div class="field">
	<label for="oa-model">モデル</label>
	<div class="field-body">
		<div class="inline">
			<input
				id="oa-model"
				type="text"
				list="oa-models"
				placeholder={`例: ${preset.modelExample}`}
				value={s.model}
				onchange={(e) =>
					aiStore.updateProviderSettings('openaiCompatible', {
						model: e.currentTarget.value.trim()
					})}
			/>
			<button class="ghost" type="button" onclick={loadModels} disabled={loadingModels}>
				{loadingModels ? '取得中…' : '一覧を取得'}
			</button>
		</div>
		<datalist id="oa-models">
			{#each models as name (name)}
				<option value={name}></option>
			{/each}
		</datalist>
		{#if models.length}<p class="hint">
				{models.length} 件のモデルから選べます(入力欄をクリック)。
			</p>{/if}
		{#if modelsError}<p class="hint error">{modelsError}</p>{/if}
		<p class="hint">
			ツール呼び出しに対応したモデルを選んでください。対応していないモデルでは、原稿を読めません。
		</p>
	</div>
</div>

<div class="field">
	<span class="field-label">接続テスト</span>
	<div class="field-body">
		<div class="inline">
			<button class="ghost" type="button" onclick={testConnection} disabled={testing}>
				{testing ? '確認中…' : '接続テスト'}
			</button>
		</div>
		{#if testResult}
			<p class="hint" class:error={!testResult.ok} class:ok={testResult.ok} role="status">
				{testResult.message}
			</p>
		{/if}
	</div>
</div>

<style>
	.inline {
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}

	.inline input {
		flex: 1;
		min-width: 12rem;
	}

	.hint.warn {
		color: var(--color-warning, var(--color-error));
	}

	.hint.ok {
		color: var(--color-success);
	}
</style>
