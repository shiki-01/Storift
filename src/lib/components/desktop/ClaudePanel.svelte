<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { fade, fly, slide } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import { formatRelativeTime } from '$lib/utils/dateUtils';
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import {
		claudeStore,
		EDIT_MODE_LABELS,
		QUICK_ACTIONS,
		type ChatMessage,
		type EditMode,
		type QuickAction
	} from '$lib/stores/claude.svelte';
	import { splitEdits, type EditProposal } from '$lib/desktop/edits';
	import EditCard from './EditCard.svelte';

	let input = $state('');
	let showHistory = $state(false);
	let listEl = $state<HTMLDivElement>();
	let inputEl = $state<HTMLTextAreaElement>();

	/** 24x24 の線画アイコン(svg の中身) */
	const ICONS = {
		history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
		compose: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
		settings:
			'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
		close: '<path d="M6 6l12 12M18 6L6 18"/>',
		trash:
			'<path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
		sparkles:
			'<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
		pen: '<path d="M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16v4"/>',
		// 紙飛行機
		send: '<path d="M21 3L10 14"/><path d="M21 3l-7 18-4-7-7-4z"/>'
	};

	let sessionTitle = $derived(
		claudeStore.sessions.find((s) => s.id === claudeStore.currentSessionId)?.title ?? '新しい会話'
	);

	function startNewChat() {
		claudeStore.newChat();
		showHistory = false;
		void tick().then(() => inputEl?.focus());
	}

	function openSettings() {
		void goto('/settings#claude');
	}

	// 入力に合わせて入力欄を伸ばす(最大 8 行ほど)
	function autoGrow() {
		if (!inputEl) return;
		inputEl.style.height = 'auto';
		inputEl.style.height = `${Math.min(inputEl.scrollHeight, 200)}px`;
	}

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

	type Item =
		| { kind: 'markdown'; text: string }
		| { kind: 'tool'; name: string; summary: string }
		| { kind: 'edit'; edit: EditProposal; index: number }
		| { kind: 'pending-edit' };

	/** 回答を表示用に分ける。編集を許可した回答では、編集案をカードとして出す */
	function renderItems(message: ChatMessage): Item[] {
		const items: Item[] = [];
		const withEdits = !!message.editMode && message.editMode !== 'suggest';
		let index = 0;
		for (const part of message.parts ?? []) {
			if (part.kind === 'tool') {
				items.push(part);
				continue;
			}
			if (!withEdits) {
				items.push({ kind: 'markdown', text: part.text });
				continue;
			}
			const { segments, pending } = splitEdits(part.text);
			for (const seg of segments) {
				if (seg.kind === 'markdown') items.push(seg);
				else items.push({ kind: 'edit', edit: seg.edit, index: index++ });
			}
			if (pending && message.running) items.push({ kind: 'pending-edit' });
		}
		return items;
	}

	// エディタで「AI に聞く」を押したら入力欄へ
	$effect(() => {
		if (claudeStore.focusRequest) void tick().then(() => inputEl?.focus());
	});

	async function send(text = input) {
		if (!text.trim() || claudeStore.isRunning) return;
		if (text === input) {
			input = '';
			void tick().then(autoGrow);
		}
		showHistory = false;
		stickToBottom = true;
		await claudeStore.send(text);
		inputEl?.focus();
	}

	function runAction(action: QuickAction) {
		void send(claudeStore.actionPrompt(action));
	}

	function actionDisabled(action: QuickAction): boolean {
		if (claudeStore.isRunning || notFound) return true;
		if (action.needs === 'target') return !claudeStore.hasScene && !claudeStore.quote;
		if (action.needs === 'project') return !claudeStore.hasProject;
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

	let loginError = $state('');
	async function openLogin() {
		loginError = '';
		try {
			await claudeStore.openLogin();
		} catch (error) {
			loginError = String(error);
		}
	}

	function formatCost(usd?: number): string {
		return usd ? `$${usd.toFixed(usd < 0.01 ? 4 : 2)}` : '';
	}

	onMount(() => {
		if (!claudeStore.status) void claudeStore.checkStatus();
		inputEl?.focus();
	});
</script>

{#snippet icon(path: string, size = 18)}
	<svg
		viewBox="0 0 24 24"
		width={size}
		height={size}
		fill="none"
		stroke="currentColor"
		stroke-width="1.7"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true">{@html path}</svg
	>
{/snippet}

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
		<div class="heading">
			<span class="title">{showHistory ? '会話の履歴' : sessionTitle}</span>
			<span class="scope" title="会話は作品ごとに分かれます">{claudeStore.scopeLabel}</span>
		</div>
		<button
			class="icon"
			class:active={showHistory}
			onclick={() => (showHistory = !showHistory)}
			title="会話の履歴"
			aria-label="会話の履歴"
			aria-pressed={showHistory}>{@render icon(ICONS.history)}</button
		>
		<button
			class="icon"
			onclick={startNewChat}
			disabled={claudeStore.isRunning}
			title="新しい会話"
			aria-label="新しい会話">{@render icon(ICONS.compose)}</button
		>
		<button class="icon" onclick={openSettings} title="Claude の設定" aria-label="Claude の設定"
			>{@render icon(ICONS.settings)}</button
		>
		<button
			class="icon"
			onclick={() => (claudeStore.open = false)}
			title="閉じる"
			aria-label="閉じる">{@render icon(ICONS.close)}</button
		>
	</header>

	{#if claudeStore.status?.found && claudeStore.status.loggedIn === false}
		<section class="setup">
			<p><strong>Claude Code にログインしていません。</strong></p>
			<p>
				ターミナルで <code>claude auth login</code> を実行してログインしてください。ログインはユーザー単位で、どのフォルダで行っても
				Storift から使えます。
			</p>
			<div class="row">
				<button class="small" onclick={openLogin}>ログインする(ターミナルを開く)</button>
				<button class="small" onclick={() => claudeStore.checkStatus()}>ログインした</button>
			</div>
			{#if loginError}<p class="hint">{loginError}</p>{/if}
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
				>。インストール先が特殊な場合は設定画面で場所を指定できます。
			</p>
		</section>
	{/if}

	{#if showHistory}
		<div class="history" transition:fade={{ duration: 120 }}>
			{#if claudeStore.sessions.length === 0}
				<p class="history-empty">まだ会話がありません</p>
			{/if}
			{#each claudeStore.sessions as session (session.id)}
				<div class="history-item" class:current={session.id === claudeStore.currentSessionId}>
					<button
						class="history-open"
						disabled={claudeStore.isRunning}
						onclick={() => {
							claudeStore.openSession(session.id);
							showHistory = false;
						}}
					>
						<span class="history-title">{session.title}</span>
						<span class="history-meta"
							>{formatRelativeTime(session.updatedAt)} ・ {session.messages.filter(
								(m) => m.role === 'user'
							).length}件の質問</span
						>
					</button>
					<button
						class="icon history-delete"
						onclick={() => claudeStore.deleteSession(session.id)}
						title="この会話を削除"
						aria-label="この会話を削除">{@render icon(ICONS.trash, 16)}</button
					>
				</div>
			{/each}
		</div>
	{:else}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div class="messages" bind:this={listEl} onscroll={onScroll} onclick={onClickContent}>
			{#if claudeStore.messages.length === 0}
				<div class="empty">
					<div class="empty-mark">{@render icon(ICONS.sparkles, 22)}</div>
					<p>
						開いているシーンについて相談できます。<br />エディタで文章を選ぶと「AI
						に聞く」が出ます。
					</p>
					<p>全作品を横断した質問(設定の使い回し、表記の統一など)もできます。</p>
				</div>
			{/if}
			{#each claudeStore.messages as message (message.id)}
				{#if message.role === 'user'}
					<div class="msg user" in:fly={{ y: 6, duration: 180 }}>
						{#if message.quote}
							<blockquote class="quote">{message.quote}</blockquote>
						{/if}
						<div class="text">{message.text}</div>
					</div>
				{:else if message.role === 'error'}
					<div class="msg error" class:auth={message.auth}>
						{#if message.auth}
							<strong>Claude Code のログインが切れています。</strong>
							<span class="error-detail">{message.text}</span>
							<div class="row">
								<button class="small" onclick={openLogin}>ログインする(ターミナルを開く)</button>
							</div>
							<span class="hint">ターミナルでログインが終わったら、もう一度送信してください。</span>
						{:else}
							{message.text}
						{/if}
					</div>
				{:else}
					<div class="msg assistant" in:fade={{ duration: 180 }}>
						{#each renderItems(message) as item, i (i)}
							{#if item.kind === 'markdown'}
								<!-- eslint-disable-next-line svelte/no-at-html-tags -- DOMPurify で無害化済み -->
								<div class="markdown">{@html renderMarkdown(item.text)}</div>
							{:else if item.kind === 'tool'}
								<div class="tool">
									<span class="tool-name">{item.name}</span>
									<span class="tool-summary">{item.summary}</span>
								</div>
							{:else if item.kind === 'edit'}
								<EditCard
									edit={item.edit}
									editState={message.edits?.[item.index]}
									mode={message.editMode ?? 'suggest'}
								/>
							{:else}
								<div class="tool">編集案を作成中…</div>
							{/if}
						{/each}
						{#if message.edits?.length && !message.running}
							{@const pending = message.edits.filter((e) => e.status === 'pending').length}
							{@const applied = message.edits.filter((e) => e.status === 'applied').length}
							<div class="changes">
								<span class="changes-label"
									>変更 {message.edits.length} 件(反映済み {applied}{pending
										? `・未反映 ${pending}`
										: ''})</span
								>
								{#if pending}
									<button class="small primary" onclick={() => claudeStore.applyAll(message)}
										>すべて反映</button
									>
									<button class="small" onclick={() => claudeStore.rejectAll(message)}
										>すべて却下</button
									>
								{/if}
								{#if applied}
									<button class="small" onclick={() => claudeStore.revertAll(message)}
										>すべて元に戻す</button
									>
								{/if}
							</div>
						{/if}
						{#if message.running}
							<div class="typing" aria-label="回答中"><span></span><span></span><span></span></div>
						{:else if message.costUsd != null}
							<div class="meta">{formatCost(message.costUsd)}</div>
						{/if}
					</div>
				{/if}
			{/each}
		</div>
	{/if}

	<footer class="composer">
		<div class="actions">
			{#each QUICK_ACTIONS as action (action.label)}
				<button class="chip" disabled={actionDisabled(action)} onclick={() => runAction(action)}>
					{action.label}
				</button>
			{/each}
		</div>
		{#if claudeStore.quote}
			<div class="quote-card" transition:slide={{ duration: 160 }}>
				<div class="quote-meta">
					<span>引用: {claudeStore.quote.sceneTitle}({claudeStore.quote.text.length}字)</span>
					<button class="icon" onclick={() => claudeStore.setQuote(null)} aria-label="引用を外す"
						>{@render icon(ICONS.close, 14)}</button
					>
				</div>
				<blockquote class="quote">{claudeStore.quote.text}</blockquote>
			</div>
		{/if}
		<div class="input-box" class:disabled={notFound}>
			<textarea
				bind:this={inputEl}
				bind:value={input}
				onkeydown={onKeydown}
				oninput={autoGrow}
				rows="1"
				placeholder={claudeStore.quote
					? '引用した部分について質問'
					: 'Claude に相談(Shift+Enter で改行)'}
				disabled={notFound}
			></textarea>
			<div class="input-foot">
				<label class="mode-select" title="本文の編集">
					{@render icon(ICONS.pen, 14)}
					<select
						value={claudeStore.settings.editMode}
						onchange={(e) =>
							claudeStore.updateSettings({ editMode: e.currentTarget.value as EditMode })}
						aria-label="本文の編集"
					>
						{#each Object.entries(EDIT_MODE_LABELS) as [value, label] (value)}
							<option {value}>{label}</option>
						{/each}
					</select>
				</label>
				<span class="spacer"></span>
				{#if claudeStore.isRunning}
					<button
						class="send stop"
						onclick={() => claudeStore.cancel()}
						title="停止"
						aria-label="停止"
					>
						<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
							><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg
						>
					</button>
				{:else}
					<button
						class="send"
						onclick={() => send()}
						disabled={!input.trim() || notFound}
						title="送信 (Enter)"
						aria-label="送信">{@render icon(ICONS.send, 17)}</button
					>
				{/if}
			</div>
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
		gap: 2px;
		height: 48px;
		padding: 0 8px 0 14px;
		border-bottom: 1px solid var(--color-border);
		flex: none;
	}

	.heading {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 6px 0 8px;
	}

	.title {
		min-width: 0;
		font-size: 13.5px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.spacer {
		flex: 1;
	}

	.dot {
		flex: none;
		width: 7px;
		height: 7px;
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
		border: none;
		background: none;
	}

	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.icon {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		padding: 0;
		border-radius: 7px;
		color: var(--color-text-secondary);
		transition:
			background-color 0.15s,
			color 0.15s;
	}

	.icon:hover:not(:disabled),
	.icon.active {
		color: var(--color-text);
		background: var(--hover);
	}

	.icon.active {
		color: var(--color-primary);
	}

	.setup {
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px 14px;
		border-bottom: 1px solid var(--color-border);
		font-size: 13px;
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

	.small.primary {
		border-color: var(--color-primary);
		background: var(--color-primary);
		color: var(--color-background);
	}

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
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 0 12px;
		color: var(--color-text-secondary);
		font-size: 12.5px;
		line-height: 1.8;
		text-align: center;
	}

	.empty p {
		margin: 0;
	}

	.empty-mark {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 44px;
		height: 44px;
		margin-bottom: 8px;
		border-radius: 50%;
		background: var(--selected);
		color: var(--color-primary);
	}

	.history {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.history-empty {
		margin: auto;
		color: var(--color-text-secondary);
		font-size: 13px;
	}

	.history-item {
		display: flex;
		align-items: center;
		gap: 4px;
		padding-right: 6px;
		border-radius: 8px;
		transition: background-color 0.12s;
	}

	.history-item:hover {
		background: var(--hover);
	}

	.history-item.current {
		background: var(--selected);
	}

	.history-open {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 3px;
		padding: 10px 6px 10px 12px;
		text-align: left;
	}

	.history-title {
		max-width: 100%;
		font-size: 13.5px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.history-item.current .history-title {
		color: var(--color-primary);
		font-weight: 600;
	}

	.history-meta {
		font-size: 11.5px;
		color: var(--color-text-secondary);
	}

	.history-delete {
		opacity: 0;
	}

	.history-item:hover .history-delete,
	.history-delete:focus-visible {
		opacity: 1;
	}

	.msg {
		line-height: 1.7;
		word-break: break-word;
	}

	.msg.user {
		align-self: flex-end;
		max-width: 90%;
		padding: 8px 12px;
		border-radius: 14px 14px 4px 14px;
		background: var(--color-background);
		border: 1px solid var(--color-border);
	}

	.msg.user .text {
		white-space: pre-wrap;
	}

	.msg.error.auth {
		white-space: normal;
	}

	.error-detail {
		display: block;
		margin: 4px 0 8px;
		font-size: 12px;
		opacity: 0.8;
	}

	.msg.error {
		padding: 8px 12px;
		border-radius: 8px;
		color: var(--color-error);
		background: color-mix(in srgb, var(--color-error) 10%, transparent);
		white-space: pre-wrap;
		font-size: 13px;
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
		padding: 10px 12px 12px;
		border-top: 1px solid var(--color-border);
	}

	/* よく使う操作は横にスクロールする 1 行に収める */
	.actions {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		scrollbar-width: none;
		mask-image: linear-gradient(to right, #000 85%, transparent);
	}

	.actions::-webkit-scrollbar {
		display: none;
	}

	.chip {
		flex: none;
		height: 26px;
		padding: 0 10px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		font-size: 12px;
		background: var(--color-background);
		color: var(--color-text);
		transition:
			border-color 0.15s,
			color 0.15s;
	}

	.chip:hover:not(:disabled) {
		border-color: color-mix(in srgb, var(--color-primary) 60%, var(--color-border));
		color: var(--color-primary);
	}

	.changes {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		margin-top: 4px;
		padding: 6px 8px;
		border-radius: 8px;
		background: color-mix(in srgb, var(--color-text) 5%, transparent);
	}

	.changes-label {
		flex: 1 1 100%;
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.scope {
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		padding: 1px 8px;
		border-radius: 999px;
		font-size: 11px;
		color: var(--color-text-secondary);
		background: color-mix(in srgb, var(--color-text) 8%, transparent);
	}

	.quote {
		margin: 0 0 4px;
		padding-left: 8px;
		border-left: 3px solid var(--color-primary);
		color: var(--color-text-secondary);
		font-size: 12px;
		white-space: pre-wrap;
		display: -webkit-box;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.quote-card {
		padding: 6px 8px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
	}

	.quote-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.input-box {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: var(--color-background);
		transition:
			border-color 0.15s,
			box-shadow 0.15s;
	}

	.input-box:focus-within {
		border-color: color-mix(in srgb, var(--color-primary) 55%, var(--color-border));
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 12%, transparent);
	}

	.input-box.disabled {
		opacity: 0.6;
	}

	textarea {
		display: block;
		width: 100%;
		min-height: 44px;
		max-height: 200px;
		padding: 11px 14px 4px;
		border: none;
		background: transparent;
		color: var(--color-text);
		font: inherit;
		font-size: 13.5px;
		line-height: 1.6;
		resize: none;
		outline: none;
	}

	textarea::placeholder {
		color: var(--color-text-secondary);
	}

	.input-foot {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 6px 6px 10px;
	}

	.mode-select {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		height: 26px;
		padding: 0 4px 0 8px;
		border-radius: 7px;
		color: var(--color-text-secondary);
		transition: background-color 0.15s;
	}

	.mode-select:hover {
		background: var(--hover);
		color: var(--color-text);
	}

	.mode-select select {
		min-width: 0;
		padding: 0 2px;
		border: none;
		background: transparent;
		color: inherit;
		font: inherit;
		font-size: 11.5px;
		cursor: pointer;
		outline: none;
	}

	.send {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		padding: 0;
		border-radius: 50%;
		background: var(--color-primary);
		color: var(--color-background);
		transition:
			transform 0.12s,
			background-color 0.15s,
			opacity 0.15s;
	}

	.send svg {
		margin: 1px 1px 0 0;
	}

	.send:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-primary) 85%, var(--color-text));
	}

	.send:active:not(:disabled) {
		transform: scale(0.92);
	}

	.send:disabled {
		opacity: 0.35;
	}

	.send.stop {
		background: var(--color-text);
	}
</style>
