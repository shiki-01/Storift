<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import { claudeStore, QUICK_ACTIONS, type QuickAction } from '$lib/stores/claude.svelte';
	import { currentProjectStore } from '$lib/stores/currentProject.svelte';
	import { getWorkspacePath, openWorkspace } from '$lib/desktop/claude';

	let input = $state('');
	let attachScene = $state(true);
	let attachSelection = $state(true);
	let showSettings = $state(false);
	let workspacePath = $state('');
	let listEl = $state<HTMLDivElement>();
	let inputEl = $state<HTMLTextAreaElement>();

	const MODELS = [
		{ value: '', label: '既定' },
		{ value: 'sonnet', label: 'Sonnet' },
		{ value: 'opus', label: 'Opus' },
		{ value: 'haiku', label: 'Haiku' }
	];

	let hasSelection = $derived(claudeStore.selection.trim().length > 0);
	let notFound = $derived(claudeStore.status !== null && !claudeStore.status.found);

	function renderMarkdown(text: string): string {
		return DOMPurify.sanitize(marked.parse(text, { async: false, breaks: true }) as string);
	}

	// 新しい出力が来たら一番下までスクロールする(上を読んでいるときは動かさない)
	let stickToBottom = true;
	function onScroll() {
		if (!listEl) return;
		stickToBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 40;
	}
	$effect(() => {
		// 表示内容の変化を購読する
		void JSON.stringify(claudeStore.messages);
		if (stickToBottom) void tick().then(() => listEl?.scrollTo({ top: listEl.scrollHeight }));
	});

	async function send(text = input, options = { attachScene, attachSelection }) {
		if (!text.trim() || claudeStore.isRunning) return;
		if (text === input) input = '';
		stickToBottom = true;
		await claudeStore.send(text, {
			attachScene: options.attachScene && claudeStore.hasScene,
			attachSelection: options.attachSelection && hasSelection
		});
		inputEl?.focus();
	}

	function runAction(action: QuickAction) {
		// 選択範囲があればそれを、なければシーン全体を対象にする
		const useSelection = action.needs === 'scene' && hasSelection;
		void send(action.prompt, {
			attachSelection: useSelection,
			attachScene: action.needs === 'scene' && !useSelection
		});
	}

	function actionDisabled(action: QuickAction): boolean {
		if (claudeStore.isRunning || notFound) return true;
		if (action.needs === 'scene') return !claudeStore.hasScene && !hasSelection;
		if (action.needs === 'project') return !currentProjectStore.project;
		return false;
	}

	function onKeydown(e: KeyboardEvent) {
		// 日本語入力の変換確定の Enter では送らない
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
			e.preventDefault();
			void send();
		}
	}

	// 回答中のリンクは既定のブラウザで開く
	function onClickContent(e: MouseEvent) {
		const a = (e.target as HTMLElement).closest('a');
		if (!a?.href) return;
		e.preventDefault();
		if (/^https?:/.test(a.href)) void openUrl(a.href);
	}

	// 左端のつまみで幅を変える
	function startResize(e: PointerEvent) {
		const startX = e.clientX;
		const startWidth = claudeStore.width;
		const target = e.currentTarget as HTMLElement;
		target.setPointerCapture(e.pointerId);
		const move = (ev: PointerEvent) => (claudeStore.width = startWidth + (startX - ev.clientX));
		const up = () => {
			target.removeEventListener('pointermove', move);
			target.removeEventListener('pointerup', up);
		};
		target.addEventListener('pointermove', move);
		target.addEventListener('pointerup', up);
	}

	async function toggleSettings() {
		showSettings = !showSettings;
		if (showSettings && !workspacePath) {
			workspacePath = (await getWorkspacePath()).path;
		}
	}

	function formatCost(usd?: number): string {
		return usd == null ? '' : `$${usd.toFixed(usd < 0.01 ? 4 : 2)}`;
	}

	onMount(() => {
		if (!claudeStore.status) void claudeStore.checkStatus();
		inputEl?.focus();
	});
</script>

<aside class="panel" data-claude-panel style="width:{claudeStore.width}px" aria-label="Claude Code">
	<div
		class="resize"
		role="separator"
		aria-orientation="vertical"
		aria-label="パネルの幅を変更"
		onpointerdown={startResize}
	></div>

	<header class="panel-header">
		<span
			class="dot"
			class:ok={claudeStore.status?.found}
			class:ng={notFound}
			title={claudeStore.status?.version ?? claudeStore.status?.error ?? '確認中'}
		></span>
		<span class="title">Claude Code</span>
		<span class="spacer"></span>
		<button
			class="icon"
			onclick={() => claudeStore.newChat()}
			disabled={claudeStore.isRunning}
			title="新しい会話">新規</button
		>
		<button class="icon" class:active={showSettings} onclick={toggleSettings} title="設定"
			>設定</button
		>
		<button class="icon" onclick={() => (claudeStore.open = false)} aria-label="閉じる">×</button>
	</header>

	{#if showSettings}
		<section class="settings">
			<label class="field">
				<span>モデル</span>
				<select
					value={MODELS.some((m) => m.value === claudeStore.settings.model)
						? claudeStore.settings.model
						: '__custom'}
					onchange={(e) => {
						const v = e.currentTarget.value;
						if (v !== '__custom') claudeStore.updateSettings({ model: v });
					}}
				>
					{#each MODELS as m (m.value)}
						<option value={m.value}>{m.label}</option>
					{/each}
					<option value="__custom">その他(下に入力)</option>
				</select>
			</label>
			<label class="field">
				<span>モデル名</span>
				<input
					type="text"
					placeholder="例: claude-sonnet-5-5(空なら既定)"
					value={claudeStore.settings.model}
					onchange={(e) => claudeStore.updateSettings({ model: e.currentTarget.value.trim() })}
				/>
			</label>
			<label class="field">
				<span>claude の場所</span>
				<input
					type="text"
					placeholder="空なら自動で探します"
					value={claudeStore.settings.claudePath}
					onchange={(e) => claudeStore.updateSettings({ claudePath: e.currentTarget.value.trim() })}
				/>
			</label>
			<label class="check">
				<input
					type="checkbox"
					checked={claudeStore.settings.allowWeb}
					onchange={(e) => claudeStore.updateSettings({ allowWeb: e.currentTarget.checked })}
				/>
				Web 検索を許可する
			</label>
			<div class="status-line">
				{#if claudeStore.status?.found}
					{claudeStore.status.version}<br /><code>{claudeStore.status.path}</code>
				{:else if claudeStore.status}
					{claudeStore.status.error}
				{:else}
					確認中…
				{/if}
			</div>
			<div class="row">
				<button class="small" onclick={() => claudeStore.checkStatus()}>再確認</button>
				<button class="small" onclick={() => openWorkspace()}>ワークスペースを開く</button>
			</div>
			<p class="hint">
				原稿は送信のたびに <code>{workspacePath || 'workspace'}</code> へ Markdown で書き出され、Claude
				Code はそこを読み取り専用で参照します。ファイルを書き換えてもアプリには反映されません。
			</p>
		</section>
	{/if}

	{#if notFound}
		<section class="setup">
			<p><strong>Claude Code が見つかりません。</strong></p>
			<p>ターミナルでインストールし、一度 <code>claude</code> を起動してログインしてください。</p>
			<pre>curl -fsSL https://claude.ai/install.sh | bash</pre>
			<p class="hint">
				Windows は PowerShell で <code>irm https://claude.ai/install.ps1 | iex</code>。npm の場合は
				<code>npm install -g @anthropic-ai/claude-code</code
				>。インストール先が特殊な場合は設定で場所を指定できます。
			</p>
		</section>
	{/if}

	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="messages" bind:this={listEl} onscroll={onScroll} onclick={onClickContent}>
		{#if claudeStore.messages.length === 0}
			<div class="empty">
				<p>開いているシーンや選択した文章について相談できます。</p>
				<p>全作品を横断した質問(設定の使い回し、表記の統一など)もできます。</p>
			</div>
		{/if}
		{#each claudeStore.messages as message (message.id)}
			{#if message.role === 'user'}
				<div class="msg user">
					{#if message.attachments?.length}
						<div class="attachments">
							{#each message.attachments as a (a)}<span class="chip static">{a}</span>{/each}
						</div>
					{/if}
					<div class="text">{message.text}</div>
				</div>
			{:else if message.role === 'error'}
				<div class="msg error">{message.text}</div>
			{:else}
				<div class="msg assistant">
					{#each message.parts ?? [] as part, i (i)}
						{#if part.kind === 'text'}
							<!-- eslint-disable-next-line svelte/no-at-html-tags -- DOMPurify で無害化済み -->
							<div class="markdown">{@html renderMarkdown(part.text)}</div>
						{:else}
							<div class="tool">
								<span class="tool-name">{part.name}</span>
								<span class="tool-summary">{part.summary}</span>
							</div>
						{/if}
					{/each}
					{#if message.running}
						<div class="typing" aria-label="回答中"><span></span><span></span><span></span></div>
					{:else if message.costUsd != null}
						<div class="meta">{formatCost(message.costUsd)}</div>
					{/if}
				</div>
			{/if}
		{/each}
	</div>

	<footer class="composer">
		<div class="actions">
			{#each QUICK_ACTIONS as action (action.label)}
				<button class="chip" disabled={actionDisabled(action)} onclick={() => runAction(action)}>
					{action.label}
				</button>
			{/each}
		</div>
		<div class="attach">
			<label class="check" class:muted={!claudeStore.hasScene}>
				<input type="checkbox" bind:checked={attachScene} disabled={!claudeStore.hasScene} />
				シーン本文を添付
			</label>
			<label class="check" class:muted={!hasSelection}>
				<input type="checkbox" bind:checked={attachSelection} disabled={!hasSelection} />
				選択範囲{hasSelection ? `(${claudeStore.selection.length}字)` : ''}
			</label>
		</div>
		<div class="input-row">
			<textarea
				bind:this={inputEl}
				bind:value={input}
				onkeydown={onKeydown}
				rows="3"
				placeholder="Claude に相談(Enter で送信、Shift+Enter で改行)"
				disabled={notFound}
			></textarea>
			{#if claudeStore.isRunning}
				<button class="send stop" onclick={() => claudeStore.cancel()}>停止</button>
			{:else}
				<button class="send" onclick={() => send()} disabled={!input.trim() || notFound}
					>送信</button
				>
			{/if}
		</div>
	</footer>
</aside>

<style>
	.panel {
		position: relative;
		flex: none;
		display: flex;
		flex-direction: column;
		min-width: 320px;
		max-width: 70vw;
		height: 100%;
		border-left: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text);
		font-size: 14px;
	}

	.resize {
		position: absolute;
		left: -3px;
		top: 0;
		bottom: 0;
		width: 6px;
		cursor: col-resize;
		z-index: 1;
	}

	.resize:hover {
		background: color-mix(in srgb, var(--color-primary) 30%, transparent);
	}

	.panel-header {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 44px;
		padding: 0 10px 0 14px;
		border-bottom: 1px solid var(--color-border);
		flex: none;
	}

	.title {
		font-weight: 600;
	}

	.spacer {
		flex: 1;
	}

	.dot {
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

	button {
		cursor: pointer;
		color: inherit;
		font: inherit;
	}

	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.icon {
		padding: 4px 8px;
		border-radius: 6px;
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.icon:hover:not(:disabled),
	.icon.active {
		color: var(--color-text);
		background: color-mix(in srgb, var(--color-text) 8%, transparent);
	}

	.settings,
	.setup {
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px 14px;
		border-bottom: 1px solid var(--color-border);
		font-size: 13px;
	}

	.field {
		display: grid;
		grid-template-columns: 92px 1fr;
		align-items: center;
		gap: 8px;
	}

	.field span {
		color: var(--color-text-secondary);
	}

	input[type='text'],
	select,
	textarea {
		width: 100%;
		padding: 6px 8px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: var(--color-background);
		color: var(--color-text);
		font: inherit;
	}

	.check {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
	}

	.muted {
		color: var(--color-text-secondary);
	}

	.row {
		display: flex;
		gap: 8px;
	}

	.small {
		padding: 4px 10px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		font-size: 12px;
		background: var(--color-background);
	}

	.status-line,
	.hint {
		color: var(--color-text-secondary);
		font-size: 12px;
		line-height: 1.6;
		word-break: break-all;
	}

	code,
	pre {
		font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 12px;
	}

	.setup pre {
		padding: 8px;
		border-radius: 6px;
		background: var(--color-background);
		overflow-x: auto;
	}

	.messages {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px 14px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.empty {
		margin: auto 0;
		color: var(--color-text-secondary);
		font-size: 13px;
		line-height: 1.8;
		text-align: center;
	}

	.msg {
		line-height: 1.7;
		word-break: break-word;
	}

	.msg.user {
		align-self: flex-end;
		max-width: 90%;
		padding: 8px 12px;
		border-radius: 12px 12px 2px 12px;
		background: color-mix(in srgb, var(--color-primary) 14%, var(--color-background));
	}

	.msg.user .text {
		white-space: pre-wrap;
	}

	.msg.error {
		padding: 8px 12px;
		border-radius: 8px;
		color: var(--color-error);
		background: color-mix(in srgb, var(--color-error) 10%, transparent);
		white-space: pre-wrap;
		font-size: 13px;
	}

	.attachments {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-bottom: 4px;
	}

	.tool {
		display: flex;
		gap: 6px;
		align-items: baseline;
		margin: 4px 0;
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.tool-name {
		font-weight: 600;
	}

	.tool-summary {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.markdown :global(p),
	.markdown :global(ul),
	.markdown :global(ol),
	.markdown :global(pre),
	.markdown :global(blockquote) {
		margin: 0 0 8px;
	}

	.markdown :global(ul),
	.markdown :global(ol) {
		padding-left: 1.4em;
	}

	.markdown :global(ul) {
		list-style: disc;
	}

	.markdown :global(ol) {
		list-style: decimal;
	}

	.markdown :global(h1),
	.markdown :global(h2),
	.markdown :global(h3),
	.markdown :global(h4) {
		margin: 12px 0 6px;
		font-weight: 700;
		font-size: 1em;
	}

	.markdown :global(code) {
		padding: 1px 4px;
		border-radius: 4px;
		background: color-mix(in srgb, var(--color-text) 8%, transparent);
	}

	.markdown :global(pre) {
		padding: 8px;
		border-radius: 6px;
		background: var(--color-background);
		overflow-x: auto;
	}

	.markdown :global(pre code) {
		padding: 0;
		background: none;
	}

	.markdown :global(blockquote) {
		padding-left: 10px;
		border-left: 3px solid var(--color-border);
		color: var(--color-text-secondary);
	}

	.markdown :global(a) {
		color: var(--color-primary);
		text-decoration: underline;
	}

	.markdown :global(table) {
		border-collapse: collapse;
		margin-bottom: 8px;
		font-size: 13px;
	}

	.markdown :global(th),
	.markdown :global(td) {
		border: 1px solid var(--color-border);
		padding: 4px 6px;
	}

	.meta {
		font-size: 11px;
		color: var(--color-text-secondary);
		text-align: right;
	}

	.typing {
		display: inline-flex;
		gap: 4px;
		padding: 4px 0;
	}

	.typing span {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-text-secondary);
		animation: blink 1.2s infinite ease-in-out;
	}

	.typing span:nth-child(2) {
		animation-delay: 0.2s;
	}

	.typing span:nth-child(3) {
		animation-delay: 0.4s;
	}

	@keyframes blink {
		0%,
		80%,
		100% {
			opacity: 0.2;
		}
		40% {
			opacity: 1;
		}
	}

	.composer {
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px 14px 14px;
		border-top: 1px solid var(--color-border);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.chip {
		padding: 3px 10px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		font-size: 12px;
		background: var(--color-background);
	}

	.chip:hover:not(:disabled):not(.static) {
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.chip.static {
		font-size: 11px;
		padding: 1px 8px;
	}

	.attach {
		display: flex;
		gap: 14px;
	}

	.input-row {
		display: flex;
		gap: 8px;
		align-items: flex-end;
	}

	textarea {
		resize: none;
		line-height: 1.6;
	}

	.send {
		flex: none;
		padding: 8px 14px;
		border-radius: 8px;
		background: var(--color-primary);
		color: #fff;
		font-size: 13px;
	}

	.send.stop {
		background: var(--color-error);
	}
</style>
