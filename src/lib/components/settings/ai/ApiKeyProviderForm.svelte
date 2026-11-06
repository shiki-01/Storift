<script lang="ts">
	// 設定「AI」: API キーで使うプロバイダ(Anthropic・Gemini)に共通の項目
	// (Base URL・API キー・モデル・最大トークン数・接続テスト)。OpenAI 互換のフォームと同じ流儀。
	import { onMount } from 'svelte';
	import { aiStore } from '$lib/stores/ai.svelte';
	import { registry } from '$lib/ai/registry';
	import { validateBaseUrl } from '$lib/ai/http/url';
	import {
		deleteSecret,
		getSecret,
		secretBackend,
		setSecret,
		type SecretBackend
	} from '$lib/ai/secrets';
	import type { AiSettings } from '$lib/ai/types';

	interface Props {
		/** プロバイダの ID(キーの保管先の識別子にもなる) */
		providerId: 'anthropic' | 'gemini';
		/** キーチェーンでのキーの名前 */
		secretName: string;
		/** 既定の Base URL(入力欄の例にも使う) */
		defaultBaseUrl: string;
		/** モデル名の候補(入力欄の例。既定値ではない) */
		modelExamples: readonly string[];
		/** 最大トークン数の項目 */
		tokens: {
			key: 'maxTokens' | 'maxOutputTokens';
			label: string;
			hint: string;
			/** 空欄を許すか(許さないときは、空にすると既定値に戻す) */
			optional: boolean;
			defaultValue?: number;
		};
		/** キーの入手先の案内 */
		keyHint: string;
	}

	let { providerId, secretName, defaultBaseUrl, modelExamples, tokens, keyHint }: Props = $props();

	const settingsKey = $derived(providerId);
	let s = $derived(
		aiStore.settings[settingsKey] as {
			baseUrl: string;
			model: string;
			maxTokens?: number;
			maxOutputTokens?: number;
		}
	);
	let urlCheck = $derived(validateBaseUrl(s.baseUrl, defaultBaseUrl));
	let tokenValue = $derived(s[tokens.key]);
	let provider = $derived(registry.get(providerId));

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
	let tokenError = $state('');

	async function refreshKey() {
		keyError = '';
		try {
			backend = await secretBackend();
			hasKey = !!(await getSecret(providerId, secretName));
		} catch (error) {
			keyError = error instanceof Error ? error.message : String(error);
		}
	}

	onMount(() => {
		void refreshKey();
		if (!aiStore.status) void aiStore.checkStatus();
	});

	async function saveKey() {
		const value = keyInput.trim();
		if (!value) return;
		busy = true;
		keyError = '';
		keyMessage = '';
		try {
			await setSecret(providerId, secretName, value);
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
			await deleteSecret(providerId, secretName);
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

	function saveTokens(raw: string) {
		tokenError = '';
		const text = raw.trim();
		if (!text) {
			aiStore.updateProviderSettings(settingsKey, {
				[tokens.key]: tokens.optional ? undefined : tokens.defaultValue
			});
			return;
		}
		const n = Number(text);
		if (!Number.isInteger(n) || n <= 0) {
			tokenError = '1 以上の整数を入力してください。';
			return;
		}
		aiStore.updateProviderSettings(settingsKey, { [tokens.key]: n });
	}

	async function loadModels() {
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

	// 候補(一覧を取得できていればその一覧、なければ例)
	let candidates = $derived(models.length ? models : [...modelExamples]);
</script>

<div class="field">
	<label for="{providerId}-url">Base URL</label>
	<div class="field-body">
		<input
			id="{providerId}-url"
			type="text"
			placeholder={defaultBaseUrl}
			value={s.baseUrl}
			onchange={(e) =>
				aiStore.updateProviderSettings(settingsKey, {
					baseUrl: e.currentTarget.value.trim()
				})}
		/>
		{#if !urlCheck.ok && s.baseUrl}<p class="hint error">{urlCheck.error}</p>{/if}
		<p class="hint">
			通常は変更不要です(既定: <code>{defaultBaseUrl}</code
			>)。プロキシなどを経由する場合だけ変更します。
		</p>
	</div>
</div>

<div class="field">
	<label for="{providerId}-key">API キー</label>
	<div class="field-body">
		<div class="inline">
			<input
				id="{providerId}-key"
				type={showKey ? 'text' : 'password'}
				autocomplete="off"
				spellcheck="false"
				placeholder={hasKey ? '保存済み(変更するときは新しいキーを入力)' : 'API キーを入力'}
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
		<p class="hint">{keyHint}</p>
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
	<label for="{providerId}-model">モデル</label>
	<div class="field-body">
		<div class="inline">
			<input
				id="{providerId}-model"
				type="text"
				list="{providerId}-models"
				placeholder={`例: ${modelExamples[0]}`}
				value={s.model}
				onchange={(e) =>
					aiStore.updateProviderSettings(settingsKey, {
						model: e.currentTarget.value.trim()
					})}
			/>
			<button class="ghost" type="button" onclick={loadModels} disabled={loadingModels}>
				{loadingModels ? '取得中…' : '一覧を取得'}
			</button>
		</div>
		<datalist id="{providerId}-models">
			{#each candidates as name (name)}
				<option value={name}></option>
			{/each}
		</datalist>
		{#if models.length}<p class="hint">
				{models.length} 件のモデルから選べます(入力欄をクリック)。
			</p>{/if}
		{#if modelsError}<p class="hint error">{modelsError}</p>{/if}
		{#if !s.model.trim()}<p class="hint">
				モデルが未選択です。一覧を取得するか、モデル名を入力してください(例: {modelExamples.join(
					'、'
				)})。
			</p>{/if}
	</div>
</div>

<div class="field">
	<label for="{providerId}-tokens">{tokens.label}</label>
	<div class="field-body">
		<input
			id="{providerId}-tokens"
			type="text"
			inputmode="numeric"
			placeholder={tokens.optional ? '空ならモデルの既定' : String(tokens.defaultValue ?? '')}
			value={tokenValue ?? ''}
			onchange={(e) => saveTokens(e.currentTarget.value)}
		/>
		{#if tokenError}<p class="hint error">{tokenError}</p>{/if}
		<p class="hint">{tokens.hint}</p>
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
