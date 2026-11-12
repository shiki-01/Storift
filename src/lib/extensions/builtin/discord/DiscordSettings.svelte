<script lang="ts">
	// 設定「拡張機能」の Discord Rich Presence カードに出す、拡張固有の設定:
	// 表示する内容(作品名・総文字数・表示文字のテンプレート)と、その場のプレビュー、前面にないときの扱い、Application ID
	import SettingsGroup from '$lib/components/settings/SettingsGroup.svelte';
	import SettingsRow from '$lib/components/settings/SettingsRow.svelte';
	import Logo from '$lib/components/ui/Logo.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import { PAGE_LABELS, type PageId } from '$lib/extensions/pages';
	import { DISCORD_APPLICATION_ID, isValidApplicationId } from './config';
	import {
		AWAY_LABEL,
		DEFAULT_DETAILS_TEMPLATE,
		DEFAULT_STATE_TEMPLATE,
		buildPresence,
		type HiddenBehavior
	} from './presence';
	import { discordSettings, discordState } from './settings.svelte';
	import { MAX_TEMPLATE_LENGTH } from './template';

	const settings = $derived(discordSettings.value);

	const statusLabel = {
		idle: '表示していません',
		shown: 'Discord に表示中',
		unavailable: 'Discord に接続できません(Discord を起動しているか確認してください)'
	} as const;

	// ---- プレビュー(見た目の確認用の例の値。実際の作品の情報は使わない) ----
	const SAMPLE = { title: '月の庭', total: 12345, netChars: 1234 };
	let previewPage = $state<PageId>('editor');
	let previewWriting = $state(true);
	let previewHidden = $state(false);
	const PAGE_OPTIONS = (Object.keys(PAGE_LABELS) as PageId[])
		.filter((p) => p !== 'other')
		.map((p) => ({ value: p, label: PAGE_LABELS[p] }));
	const startedAt = Date.now() - (12 * 60 + 34) * 1000;

	const preview = $derived(
		buildPresence(
			{
				page: { page: previewPage, projectId: 'sample' },
				session: previewWriting ? { startedAt, netChars: SAMPLE.netChars } : null,
				projectTitle: SAMPLE.title,
				totalChars: SAMPLE.total,
				appStartedAt: startedAt,
				hidden: previewHidden
			},
			settings
		)
	);

	// ---- Application ID ----
	let idDraft = $state(discordSettings.value.applicationId);
	const idInvalid = $derived(idDraft !== '' && !isValidApplicationId(idDraft));
	function commitId() {
		discordSettings.update({ applicationId: idDraft });
		idDraft = discordSettings.value.applicationId;
	}

	const PLACEHOLDER_HELP: { name: string; help: string; note?: string }[] = [
		{ name: '{page}', help: '画面のラベル(例: 執筆中)' },
		{ name: '{project}', help: '作品名', note: '「作品名を送る」がオンのときだけ' },
		{ name: '{chars}', help: '増減した文字数(例: +1,234)', note: '執筆中だけ' },
		{ name: '{total}', help: '作品の総文字数', note: '「総文字数を送る」がオンのときだけ' }
	];
</script>

<div class="discord-settings">
	<SettingsGroup title="状態">
		<SettingsRow label="Discord への表示">
			<span class="status" data-status={discordState.status} role="status">
				<span class="dot" aria-hidden="true"></span>{statusLabel[discordState.status]}
			</span>
		</SettingsRow>
	</SettingsGroup>

	<SettingsGroup
		title="表示する内容"
		description="アプリを開いている間、いま開いている画面を表示します。本文は送りません。"
	>
		<SettingsRow
			label="作品名を送る"
			labelFor="discord-title"
			description={'オンにすると、{project} に作品名が入ります。オフのときは空として扱い、それを含む部分ごと省きます。'}
		>
			<input
				id="discord-title"
				type="checkbox"
				checked={settings.showProjectTitle}
				onchange={(e) => discordSettings.update({ showProjectTitle: e.currentTarget.checked })}
			/>
		</SettingsRow>
		<SettingsRow
			label="作品の総文字数を送る"
			labelFor="discord-total"
			description={'オンにすると、{total} に作品の総文字数が入ります。'}
		>
			<input
				id="discord-total"
				type="checkbox"
				checked={settings.showTotalChars}
				onchange={(e) => discordSettings.update({ showTotalChars: e.currentTarget.checked })}
			/>
		</SettingsRow>

		<SettingsRow
			label="1 行目(Details)"
			labelFor="discord-details"
			description="Discord の 1 行目に出す文字です。"
			stacked
		>
			<input
				id="discord-details"
				class="text-input"
				type="text"
				maxlength={MAX_TEMPLATE_LENGTH}
				value={settings.detailsTemplate}
				placeholder={DEFAULT_DETAILS_TEMPLATE}
				oninput={(e) => discordSettings.update({ detailsTemplate: e.currentTarget.value })}
			/>
		</SettingsRow>
		<SettingsRow
			label="2 行目(State)"
			labelFor="discord-state"
			description="執筆中だけ出す 2 行目です。空にすると出しません。"
			stacked
		>
			<input
				id="discord-state"
				class="text-input"
				type="text"
				maxlength={MAX_TEMPLATE_LENGTH}
				value={settings.stateTemplate}
				placeholder={DEFAULT_STATE_TEMPLATE}
				oninput={(e) => discordSettings.update({ stateTemplate: e.currentTarget.value })}
			/>
		</SettingsRow>

		<dl class="placeholders selectable">
			{#each PLACEHOLDER_HELP as item (item.name)}
				<div>
					<dt><code>{item.name}</code></dt>
					<dd>
						{item.help}{#if item.note}<span class="pn">({item.note})</span>{/if}
					</dd>
				</div>
			{/each}
		</dl>
		<div class="reset">
			<Button
				variant="ghost"
				size="sm"
				onclick={() =>
					discordSettings.update({
						detailsTemplate: DEFAULT_DETAILS_TEMPLATE,
						stateTemplate: DEFAULT_STATE_TEMPLATE
					})}
			>
				表示文字を既定に戻す
			</Button>
		</div>
	</SettingsGroup>

	<SettingsGroup title="プレビュー" description="いまの設定での見た目です(例の値を使っています)。">
		<div class="preview-controls">
			<Select
				aria-label="プレビューする画面"
				size="sm"
				value={previewPage}
				options={PAGE_OPTIONS}
				onchange={(v) => (previewPage = v as PageId)}
			/>
			<label class="check">
				<input type="checkbox" bind:checked={previewWriting} />執筆セッション中
			</label>
			<label class="check">
				<input type="checkbox" bind:checked={previewHidden} />Storift が前面にない
			</label>
		</div>

		<div
			class="discord-card"
			data-testid="discord-preview"
			aria-label="Discord での表示のプレビュー"
		>
			<p class="card-head">Storift をプレイ中</p>
			{#if preview}
				<div class="card-body">
					<div class="art">
						<span class="large"><Logo size={34} /></span>
						{#if preview.smallImage}
							<span class="small" aria-hidden="true" title={preview.smallText}>
								<svg
									viewBox="0 0 24 24"
									width="14"
									height="14"
									fill="none"
									stroke="currentColor"
									stroke-width="2.4"
									stroke-linecap="round"
									stroke-linejoin="round"
									><path d="M4 20h4L18.5 9.5a2.83 2.83 0 0 0-4-4L4 16v4" /></svg
								>
							</span>
						{/if}
					</div>
					<div class="lines">
						<p class="l-name">Storift</p>
						<p class="l-details">{preview.details}</p>
						{#if preview.state}<p class="l-state">{preview.state}</p>{/if}
						<p class="l-time">12:34 経過</p>
					</div>
				</div>
			{:else}
				<p class="cleared">表示を消します(Discord には何も出ません)</p>
			{/if}
		</div>
	</SettingsGroup>

	<SettingsGroup title="Storift が前面にないとき">
		<SettingsRow
			label="別のウィンドウに移ったとき"
			labelFor="discord-hidden"
			description={`「離席中」にすると、1 行目を「${AWAY_LABEL}」にして、ほかの情報を隠します。`}
		>
			<Select
				id="discord-hidden"
				value={settings.whenHidden}
				onchange={(v) => discordSettings.update({ whenHidden: v as HiddenBehavior })}
				options={[
					{ value: 'keep', label: '表示を続ける' },
					{ value: 'away', label: '「離席中」にする' },
					{ value: 'clear', label: '表示を消す' }
				]}
			/>
		</SettingsRow>
	</SettingsGroup>

	<SettingsGroup title="詳細設定">
		<SettingsRow
			label="自分の Application ID で上書き(任意)"
			labelFor="discord-app-id"
			description={`空なら、Storift の Application ID(${DISCORD_APPLICATION_ID})を使います。自分の Discord アプリケーションの名前や画像で表示したいときだけ入力します。`}
			stacked
		>
			<input
				id="discord-app-id"
				class="text-input mono"
				type="text"
				inputmode="numeric"
				autocomplete="off"
				maxlength="25"
				placeholder="空のまま(既定の ID を使う)"
				bind:value={idDraft}
				aria-invalid={idInvalid}
				onblur={commitId}
				onkeydown={(e) => {
					if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
				}}
			/>
		</SettingsRow>
		{#if idInvalid}
			<p class="note warn" role="status">
				Application ID は 15〜25 桁の数字です。このままでは使われず、既定の ID になります。
			</p>
		{/if}
	</SettingsGroup>
</div>

<style>
	.discord-settings {
		display: flex;
		flex-direction: column;
	}

	.status {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.dot {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--color-text-secondary);
	}

	.status[data-status='shown'] .dot {
		background: var(--color-success, var(--color-primary));
	}

	.status[data-status='unavailable'] .dot {
		background: var(--color-warning);
	}

	.text-input {
		width: 100%;
		min-height: 40px;
		padding: 0.5rem 0.75rem;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		color: var(--color-text);
		font: inherit;
		font-size: 14px;
	}

	.mono:placeholder-shown {
		font-family: inherit;
		letter-spacing: normal;
	}

	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		letter-spacing: 0.02em;
	}

	.placeholders {
		display: grid;
		gap: 6px;
		margin: 4px 0 0;
		padding: 10px 12px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: color-mix(in srgb, var(--color-surface) 45%, var(--color-background));
		font-size: 12.5px;
		line-height: 1.6;
		color: var(--color-text-secondary);
	}

	.placeholders div {
		display: flex;
		flex-wrap: wrap;
		gap: 2px 10px;
	}

	.placeholders dt {
		flex: none;
		min-width: 5.5em;
	}

	.placeholders dd {
		margin: 0;
		flex: 1 1 10rem;
	}

	.placeholders code {
		color: var(--color-text);
		font-size: 12px;
	}

	.pn {
		margin-left: 4px;
		font-size: 11.5px;
		opacity: 0.9;
	}

	.reset {
		display: flex;
		justify-content: flex-end;
		padding-top: 4px;
	}

	.preview-controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 16px;
		padding: 10px 0;
	}

	.check {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 32px;
		font-size: 13px;
		cursor: pointer;
	}

	/* Discord の画面を真似たプレビュー。Discord 自体の見た目(暗い配色)に合わせるため、テーマの色は使わない */
	.discord-card {
		display: flex;
		flex-direction: column;
		gap: 10px;
		max-width: 22rem;
		padding: 14px 16px;
		border-radius: 8px;
		background: #232428;
		color: #dbdee1;
		-webkit-user-select: none;
		user-select: none;
	}

	.card-head {
		margin: 0;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: #b5bac1;
	}

	.card-body {
		display: flex;
		gap: 12px;
		align-items: flex-start;
	}

	.art {
		position: relative;
		flex: none;
		width: 60px;
		height: 60px;
	}

	.large {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 60px;
		height: 60px;
		border-radius: 8px;
		background: #f6f4ef;
		color: #33507a;
	}

	.small {
		position: absolute;
		right: -4px;
		bottom: -4px;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border: 2px solid #232428;
		border-radius: 50%;
		background: #33507a;
		color: #fff;
	}

	.lines {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
		font-size: 13px;
		line-height: 1.4;
	}

	.lines p {
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.l-name {
		font-weight: 700;
		color: #f2f3f5;
	}

	.l-time {
		color: #b5bac1;
	}

	.cleared {
		margin: 0;
		font-size: 13px;
		color: #b5bac1;
	}

	.note {
		margin: 4px 0 0;
		font-size: 12.5px;
		line-height: 1.6;
		color: var(--color-text-secondary);
	}

	.note.warn {
		color: var(--color-warning);
	}
</style>
