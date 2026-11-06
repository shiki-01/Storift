<script lang="ts">
	import { untrack } from 'svelte';
	import Button from './Button.svelte';
	import SettingsCard from '$lib/components/settings/SettingsCard.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { isFirebaseInitialized } from '$lib/firebase/config';
	import { applySettingsCode, getSettingsCode } from '$lib/services/access.service';
	import rulesText from '../../../../firestore.rules?raw';

	let settingsCode = $state<string | null>(null);
	let codeVisible = $state(false);
	let codeInput = $state('');
	let applying = $state(false);
	let applyError = $state('');

	const mode = $derived(authStore.accessMode);
	const modeLabel = $derived(
		mode === 'legacy'
			? '旧ルール(共有機能は使えません)'
			: mode === 'owner'
				? '新ルール・オーナー'
				: mode === 'needs-owner'
					? '新ルール・未登録(設定コードが必要)'
					: '未確認(オフラインなどで判定できていません)'
	);

	// オーナーになったら(鍵が保存されたあとに)設定コードを読み込む
	$effect(() => {
		if (mode !== 'owner') {
			settingsCode = null;
			codeVisible = false;
			return;
		}
		untrack(() => {
			getSettingsCode()
				.then((code) => (settingsCode = code))
				.catch((error) => console.warn('Failed to load settings code:', error));
		});
	});

	async function copy(text: string, done: string) {
		try {
			await navigator.clipboard.writeText(text);
			toast.success(done);
		} catch {
			toast.error('コピーに失敗しました');
		}
	}

	async function handleApply() {
		applyError = '';
		applying = true;
		try {
			const result = await applySettingsCode(codeInput);
			if (!result.ok) {
				applyError = result.message;
				return;
			}
			codeInput = '';
			if (!result.reloading) toast.success('オーナー端末として登録しました');
		} catch (error) {
			applyError = error instanceof Error ? error.message : '設定コードの適用に失敗しました';
		} finally {
			applying = false;
		}
	}
</script>

{#if isFirebaseInitialized()}
	{#if mode === 'needs-owner'}
		<SettingsCard title="設定コードの入力" tone="warning">
			<p class="font:.875rem">{authStore.accessMessage}</p>
			<p class="fg:theme-text-secondary font:.875rem">
				オーナー端末の「設定コード」カードで表示したコードを貼り付けて、適用してください。この端末の同期が自動で始まります。
			</p>
			<textarea
				bind:value={codeInput}
				placeholder="storift1:..."
				aria-label="設定コード"
				class="w:full p:12 r:6 b:1px|solid|theme-border font:13 font-family:monospace min-h:80 resize:vertical"
			></textarea>
			{#if applyError}
				<p class="fg:theme-error font:.875rem">{applyError}</p>
			{/if}
			<div>
				<Button onclick={handleApply} disabled={applying || !codeInput.trim()}>
					{applying ? '適用中...' : '適用'}
				</Button>
			</div>
		</SettingsCard>
	{/if}

	{#if mode === 'owner'}
		<SettingsCard
			title="設定コード"
			description="自分の別の端末で同じ Firebase に接続するときに、Firebase Console の設定値の代わりに貼り付けるコードです。"
		>
			<div
				class="px:1rem py:.75rem r:6px b:1px|solid|theme-warning"
				style="background-color: color-mix(in srgb, var(--color-warning) 10%, transparent);"
			>
				<p class="font:.875rem fg:theme-warning">
					このコードを持つ人は、全データにアクセスできます。共有には使わず、自分の別端末にだけ貼ってください。
				</p>
			</div>
			{#if settingsCode}
				<code
					class="block p:12 r:6 b:1px|solid|theme-border font:12"
					style="word-break: break-all;"
				>
					{codeVisible ? settingsCode : '•'.repeat(32)}
				</code>
				<div class="flex gap:.5rem">
					<Button variant="secondary" onclick={() => (codeVisible = !codeVisible)}>
						{codeVisible ? '隠す' : '表示'}
					</Button>
					<Button
						variant="secondary"
						onclick={() => settingsCode && copy(settingsCode, '設定コードをコピーしました')}
						>コピー</Button
					>
				</div>
			{:else}
				<p class="fg:theme-text-secondary font:.875rem">
					設定コードを作成できません(この端末にオーナー鍵が保存されていません)。
				</p>
			{/if}
		</SettingsCard>
	{/if}

	<SettingsCard title="Firebase ルール">
		<p class="font:.875rem">現在のモード: <strong>{modeLabel}</strong></p>

		{#if mode === 'legacy'}
			<div
				class="px:1rem py:.75rem r:6px b:1px|solid|theme-border"
				style="background-color: color-mix(in srgb, var(--color-primary) 10%, transparent);"
			>
				<p class="font:.875rem">
					共有機能を使うには新ルールが必要です。新ルールを適用すると、最初に開いた端末でオーナー鍵が自動で作られます。他の端末では、その端末に表示される設定コードが必要になります。
				</p>
			</div>
		{/if}

		<p class="fg:theme-text-secondary font:.875rem">
			適用手順: Firebase Console → Firestore Database → ルール
			に下のルールを貼り付けて「公開」を押します。
		</p>
		<details class="flex flex:column gap:.5rem">
			<summary class="font:bold cursor:pointer">新ルールの全文を表示</summary>
			<pre
				class="mt:8 p:12 r:6 b:1px|solid|theme-border font:12 overflow:auto max-h:320 white-space:pre">{rulesText}</pre>
		</details>
		<div>
			<Button variant="secondary" onclick={() => copy(rulesText, 'ルールをコピーしました')}
				>ルールをコピー</Button
			>
		</div>
	</SettingsCard>
{/if}
