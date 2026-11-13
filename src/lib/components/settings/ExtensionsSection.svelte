<script lang="ts">
	// 設定「拡張機能」: 拡張を 1 つずつのカードで並べる(有効/無効・プライバシー・拡張固有の設定)。
	// 拡張の名前・説明・対応環境・扱う情報は、各拡張のマニフェスト(extensions/<id>/manifest.json)から出す。
	// 公式の拡張のほかに、「拡張機能を探す」「ファイルから追加」「拡張フォルダ(デスクトップ版)」で入れたパックを並べる
	import ConsentDialog from '$lib/components/extensions/ConsentDialog.svelte';
	import PackBrowser from '$lib/components/extensions/PackBrowser.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import { onMount } from 'svelte';
	import { isDesktop } from '$lib/desktop/platform';
	import { extensionHost } from '$lib/extensions/host.svelte';
	import { PACK_LIMITS } from '$lib/extensions/pack';
	import { packManager, type InstallResult } from '$lib/extensions/packManager.svelte';
	import { registryState } from '$lib/extensions/registryState.svelte';
	import { revocation } from '$lib/extensions/revocation.svelte';
	import { IDLE_MINUTES_OPTIONS } from '$lib/extensions/session';
	import { sessionSettings } from '$lib/extensions/sessionSettings.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import ExtensionCard from './ExtensionCard.svelte';
	import SettingsCard from './SettingsCard.svelte';
	import SettingsRow from './SettingsRow.svelte';

	const official = $derived(extensionHost.extensions.filter((e) => e.manifest.kind === 'official'));
	const packs = $derived(extensionHost.extensions.filter((e) => e.manifest.kind !== 'official'));
	const desktop = isDesktop();

	// 設定の「拡張機能」を開いたとき、失効リストを確認する(失敗しても何も壊さない)
	onMount(() => {
		void revocation.check();
	});

	let browserOpen = $state(false);
	let fileInput: HTMLInputElement | undefined = $state();
	let fileBusy = $state(false);

	// インストール直後の同意画面
	let consentOpen = $state(false);
	let consentId = $state<string | null>(null);
	let consentMode = $state<'enable' | 'review'>('enable');
	const consentExt = $derived(
		consentId ? extensionHost.extensions.find((e) => e.manifest.id === consentId) : undefined
	);

	function askConsent(result: InstallResult) {
		consentId = result.id;
		consentMode = result.reconsent ? 'review' : 'enable';
		if (!result.reconsent && result.replaced && extensionHost.isEnabled(result.id)) {
			toast.success('更新しました');
			return;
		}
		consentOpen = true;
	}

	async function consent() {
		if (!consentId) return;
		await extensionHost.grantConsent(consentId);
		if (consentMode === 'enable') await extensionHost.setEnabled(consentId, true);
	}

	async function addFile(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		if (file.size > PACK_LIMITS.bundleBytes) {
			toast.error(`ファイルが大きすぎます(${Math.round(PACK_LIMITS.bundleBytes / 1024)}KB まで)`);
			return;
		}
		fileBusy = true;
		try {
			askConsent(await packManager.installFromText(await file.text()));
		} catch (error) {
			toast.error(error instanceof Error ? error.message : '追加できませんでした');
		} finally {
			fileBusy = false;
		}
	}

	// 手動の更新確認: 一覧を取得して、入れてあるパックに新しい版があるかを数える
	let checkMessage = $state('');
	const updateCount = $derived(
		packs.filter((p) => {
			const entry = registryState.entry(p.manifest.id);
			return !!entry && packManager.updateAvailable(entry);
		}).length
	);

	async function checkUpdates() {
		checkMessage = '';
		await registryState.load();
		if (registryState.status === 'error') {
			checkMessage = registryState.error;
			return;
		}
		// 同じ一覧に載っている失効も反映する
		if (registryState.index) await revocation.apply(registryState.index.revoked);
		checkMessage =
			updateCount > 0
				? `${updateCount} 件の更新があります。各カードの「更新」を押してください`
				: '更新はありません';
	}

	let folderInput = $state(packManager.folderPath);
	async function applyFolder() {
		packManager.setFolderPath(folderInput);
		await packManager.reloadFolder();
	}
	async function openFolder() {
		try {
			await packManager.openFolder();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'フォルダを開けませんでした');
		}
	}
</script>

<p class="intro">
	Storift
	に機能を足します。既定はすべて無効で、有効にするときは、その拡張が扱う情報を確認して同意します。有効/無効と同意の記録はこの端末だけのもので、同期やバックアップには含まれません。
</p>

<div class="list" aria-label="公式の拡張機能">
	{#each official as ext (ext.manifest.id)}
		<ExtensionCard extension={ext} />
	{/each}
</div>

<SettingsCard
	title="拡張機能を探す"
	description="コミュニティが公開した拡張機能を、一覧から探して入れます。パックは、コードを含まない設定ファイル(テーマ・辞書・入力補助キーなど)で、通信しません。スクリプトは、隔離された環境で動くコードで、宣言した通信先にだけ通信できます。"
	data-testid="ext-discover"
>
	<div class="actions">
		<Button onclick={() => (browserOpen = true)} data-testid="open-pack-browser"
			>拡張機能を探す</Button
		>
		<Button variant="secondary" onclick={() => fileInput?.click()} disabled={fileBusy}>
			ファイルから追加
		</Button>
		<Button variant="secondary" onclick={() => void checkUpdates()} data-testid="check-updates">
			更新を確認
		</Button>
		<input
			bind:this={fileInput}
			type="file"
			accept=".json,application/json"
			class="hidden"
			data-testid="pack-file-input"
			onchange={addFile}
		/>
	</div>
	{#if checkMessage}<p class="status" role="status" data-testid="check-message">
			{checkMessage}
		</p>{/if}
	<p class="caution">
		<b>ファイルから追加した拡張機能は未審査です。</b
		>公式のものではありません。内容を確認できるものだけを追加してください(自己責任)。レジストリ(storift.shiki-01.com)から入れたものは、公開前にリポジトリ上でレビューされますが、内容は保証されません。
	</p>
</SettingsCard>

{#if packs.length > 0}
	<div class="list" aria-label="追加した拡張機能" data-testid="installed-packs">
		<h3 class="list-title">追加した拡張機能</h3>
		{#each packs as ext (ext.manifest.id)}
			<ExtensionCard extension={ext} />
		{/each}
	</div>
{/if}

{#if desktop}
	<SettingsCard
		title="拡張フォルダ"
		description="フォルダの直下に <id>/manifest.json を置くと、パックとして読み込みます。読み取り専用で、フォルダの外は読みません。出所は「個人フォルダ(未審査)」です。"
		data-testid="ext-folder"
	>
		<SettingsRow
			label="フォルダのパス"
			labelFor="ext-folder-path"
			description={packManager.folderRoot
				? `読み込み先: ${packManager.folderRoot}`
				: '空欄のときは、アプリのデータフォルダ内の extensions を使います。'}
		>
			<input
				id="ext-folder-path"
				class="path"
				type="text"
				placeholder="(既定のフォルダ)"
				bind:value={folderInput}
				onchange={applyFolder}
			/>
		</SettingsRow>
		<div class="actions">
			<Button
				variant="secondary"
				size="sm"
				disabled={packManager.folderBusy}
				onclick={() => void applyFolder()}>再読み込み</Button
			>
			<Button variant="secondary" size="sm" onclick={() => void openFolder()}>フォルダを開く</Button
			>
		</div>
		{#if packManager.folderErrors.length > 0}
			<ul class="folder-errors" role="alert" data-testid="folder-errors">
				{#each packManager.folderErrors as item (item.dir)}
					<li>
						<b>{item.dir}</b>: {item.errors.slice(0, 3).join(' / ')}{#if item.errors.length > 3}
							(ほか {item.errors.length - 3} 件){/if}
					</li>
				{/each}
			</ul>
		{/if}
	</SettingsCard>
{/if}

<SettingsCard
	title="失効リスト"
	description="運営が停止した拡張機能(失効した版)を、自動で無効にするための一覧です。取得先は storift.shiki-01.com に固定で、取得に失敗しても何も変わりません。"
	data-testid="ext-revocation"
>
	<SettingsRow
		label="失効リストを自動で確認"
		labelFor="revocation-auto"
		description="スクリプトの拡張機能を有効にしているときだけ、アプリの起動時に 1 日 1 回まで確認します(設定を開いたときと「更新を確認」では、この設定にかかわらず確認します)。通信するのは storift.shiki-01.com だけで、利用者を識別する情報は送りません。"
	>
		<Switch
			id="revocation-auto"
			checked={revocation.auto}
			aria-label="失効リストを自動で確認"
			onchange={(v) => revocation.setAuto(v)}
		/>
	</SettingsRow>
	{#if !revocation.auto}
		<p class="caution" role="status" data-testid="revocation-off-note">
			<b>自動確認をオフにしています。</b
			>運営が有害と判断して停止した拡張機能があっても、設定の「拡張機能」を開くか「更新を確認」を押すまで、気付かずに動き続けることがあります。
		</p>
	{/if}
</SettingsCard>

<SettingsCard
	title="執筆セッション"
	description="拡張が使う「執筆している時間」の判定です。最初の編集で始まり、一定時間編集がなければ終わります。AI の提案の適用は含めません。"
>
	<SettingsRow
		label="無操作で終了するまでの時間"
		labelFor="session-idle"
		description="最後の編集からこの時間操作がなければ、執筆セッションを終了します。"
	>
		<Select
			id="session-idle"
			value={String(sessionSettings.value.idleMinutes)}
			onchange={(v) => sessionSettings.update({ idleMinutes: Number(v) })}
			options={IDLE_MINUTES_OPTIONS.map((m) => ({ value: String(m), label: `${m} 分` }))}
		/>
	</SettingsRow>
</SettingsCard>

<PackBrowser bind:open={browserOpen} oninstalled={askConsent} />

{#if consentExt}
	<ConsentDialog
		bind:open={consentOpen}
		manifest={consentExt.manifest}
		origin={consentExt.origin}
		content={consentExt.content}
		mode={consentMode}
		reason={consentMode === 'review'
			? 'この拡張が扱う情報が、同意したときから変わりました。内容を確認してください。'
			: undefined}
		onconsent={consent}
	/>
{/if}

<style>
	.intro {
		margin: 0 0 4px;
		font-size: 13px;
		line-height: 1.7;
		color: var(--color-text-secondary);
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.list-title {
		margin: 8px 0 -4px;
		font-size: 13px;
		font-weight: 600;
		letter-spacing: 0.06em;
		color: var(--color-text-secondary);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.hidden {
		display: none;
	}

	.status {
		margin: 8px 0 0;
		font-size: 12.5px;
		color: var(--color-text-secondary);
	}

	.caution {
		margin: 12px 0 0;
		padding: 10px 12px;
		border: 1px solid color-mix(in srgb, var(--color-warning) 50%, var(--color-border));
		border-radius: 8px;
		background: color-mix(in srgb, var(--color-warning) 7%, var(--color-background));
		font-size: 12.5px;
		line-height: 1.7;
		color: var(--color-text-secondary);
	}

	.caution b {
		color: var(--color-text);
	}

	.path {
		width: min(100%, 320px);
		height: 36px;
		padding: 0 10px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		color: var(--color-text);
		font: inherit;
		font-size: 13px;
	}

	.path:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 1px;
	}

	.folder-errors {
		margin: 12px 0 0;
		padding: 10px 12px 10px 28px;
		border: 1px solid color-mix(in srgb, var(--color-error) 45%, var(--color-border));
		border-radius: 8px;
		background: color-mix(in srgb, var(--color-error) 6%, var(--color-background));
		font-size: 12.5px;
		line-height: 1.7;
		list-style: disc;
	}
</style>
