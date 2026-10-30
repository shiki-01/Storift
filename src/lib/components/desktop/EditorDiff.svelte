<script lang="ts">
	/**
	 * エディタ上に、Claude の変更を色付きで表示する(VS Code の Copilot のインライン差分に当たる)。
	 *
	 * - 反映済みで未確認の変更: 追加した文字を緑、消えた文字はその位置に赤い取り消し線の札で示す
	 * - 未反映の提案: 消える文字を赤(取り消し線)、入る文字はその位置に緑の札で示す
	 *
	 * 本文の DOM は書き換えず、CSS Custom Highlight API で色を付ける(非対応の環境では半透明の枠を重ねる)。
	 * 変更にマウスを乗せると差分と「保持 / 元に戻す」(提案なら「反映 / 却下」)が出る。
	 */
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { claudeStore, type EditorEdit } from '$lib/stores/claude.svelte';
	import { editorStore } from '$lib/stores/editor.svelte';
	import {
		appliedDecoration,
		diffChars,
		pendingDecoration,
		type Decoration
	} from '$lib/desktop/edits';
	import {
		scrollParent,
		scrollRangeIntoView,
		supportsHighlight,
		textRange
	} from '$lib/utils/editorInput';

	const ADD = 'storift-ai-add';
	const DEL = 'storift-ai-del';

	interface Box {
		left: number;
		top: number;
		width: number;
		height: number;
	}

	interface Placed {
		key: number;
		entry: EditorEdit;
		deco: Decoration;
		/** Highlight API が使えないときに重ねる枠 */
		marks: (Box & { kind: 'add' | 'del' })[];
		/** 本文に無い側の文字(反映済みなら消えた文字、提案なら入る文字)の位置と中身 */
		ghosts: (Box & { kind: 'add' | 'del'; text: string })[];
		/** ホバーの判定に使う、変更全体の矩形 */
		hits: Box[];
	}

	const useHighlight = supportsHighlight();

	let placed = $state<Placed[]>([]);
	let clip = $state<Box | null>(null);
	let vertical = $state(false);
	let active = $state<number | null>(null);
	let cardBox = $state<{ left: number; top: number } | null>(null);
	let cursor = -1;
	let frame = 0;
	let hideTimer: ReturnType<typeof setTimeout> | undefined;

	function editorRoot(): HTMLElement | null {
		return document.querySelector<HTMLElement>('.app-main [contenteditable="true"]');
	}

	function toBox(r: DOMRect | Box): Box {
		return { left: r.left, top: r.top, width: r.width, height: r.height };
	}

	function rects(root: HTMLElement, start: number, end: number): Box[] {
		const range = textRange(root, start, end);
		return range
			? Array.from(range.getClientRects(), toBox).filter((b) => b.width || b.height)
			: [];
	}

	/** 本文に無い文字の位置を示す細い印(縦書きでは横線) */
	function ghostBox(root: HTMLElement, at: number, length: number, vertical: boolean): Box | null {
		const after = at < length;
		const r = (after ? rects(root, at, at + 1) : rects(root, at - 1, at))[0];
		if (!r) return null;
		if (vertical) {
			return {
				left: r.left,
				width: r.width,
				top: after ? r.top - 1 : r.top + r.height - 1,
				height: 3
			};
		}
		return {
			top: r.top,
			height: r.height,
			left: after ? r.left - 1 : r.left + r.width - 1,
			width: 3
		};
	}

	function setHighlights(add: Range[], del: Range[]) {
		if (!useHighlight) return;
		const highlights = (CSS as unknown as { highlights: Map<string, unknown> }).highlights;
		if (add.length) highlights.set(ADD, new Highlight(...add));
		else highlights.delete(ADD);
		if (del.length) highlights.set(DEL, new Highlight(...del));
		else highlights.delete(DEL);
	}

	function layout() {
		frame = 0;
		const root = editorRoot();
		const content = editorStore.content;
		const entries = root ? claudeStore.editorEdits : [];
		const add: Range[] = [];
		const del: Range[] = [];
		const next: Placed[] = [];

		if (root) {
			vertical = getComputedStyle(root).writingMode.startsWith('vertical');
			entries.forEach((entry, key) => {
				const deco =
					entry.edit.status === 'applied'
						? appliedDecoration(content, entry.edit)
						: pendingDecoration(content, entry.edit);
				if (!deco) return;
				const item: Placed = { key, entry, deco, marks: [], ghosts: [], hits: [] };
				for (const m of deco.marks) {
					const range = textRange(root, m.start, m.end);
					if (!range) continue;
					(m.kind === 'add' ? add : del).push(range);
					for (const b of rects(root, m.start, m.end)) item.marks.push({ ...b, kind: m.kind });
				}
				for (const g of deco.ghosts) {
					const b = ghostBox(root, g.at, content.length, vertical);
					if (b) item.ghosts.push({ ...b, kind: g.kind, text: g.text });
				}
				item.hits = [...item.marks, ...item.ghosts, ...rects(root, deco.start, deco.end)];
				next.push(item);
			});
			// 前後の移動が本文の順になるよう並べる
			next.sort((a, b) => a.deco.start - b.deco.start);
			const container = scrollParent(root);
			clip = toBox((container ?? root).getBoundingClientRect());
		} else {
			clip = null;
		}

		setHighlights(add, del);
		placed = next;
		if (active != null && !next.some((p) => p.key === active)) closeCard();
		else if (active != null) placeCard(active);
	}

	function schedule() {
		if (!frame) frame = requestAnimationFrame(layout);
	}

	// 変更の一覧・状態・本文が変わったら描き直す(エディタ側の DOM 更新の後に測るため次のフレームで)
	$effect(() => {
		void editorStore.content;
		for (const { edit } of claudeStore.editorEdits)
			void [edit.status, edit.reviewed, edit.appliedAt];
		schedule();
	});

	// 履歴から開いたときなど、まだシーンとファイルの対応が無ければ作る
	$effect(() => {
		if (editorStore.currentScene) void claudeStore.refreshSceneFiles();
	});

	function inside(b: Box, x: number, y: number, pad = 4): boolean {
		return (
			x >= b.left - pad &&
			x <= b.left + b.width + pad &&
			y >= b.top - pad &&
			y <= b.top + b.height + pad
		);
	}

	function placeCard(key: number) {
		const item = placed.find((p) => p.key === key);
		const last = item?.hits[item.hits.length - 1];
		if (!last) return;
		const width = 320;
		cardBox = {
			left: Math.min(Math.max(8, last.left), window.innerWidth - width - 8),
			top: Math.min(last.top + last.height + 6, window.innerHeight - 160)
		};
	}

	function openCard(key: number) {
		clearTimeout(hideTimer);
		if (active !== key) {
			active = key;
			placeCard(key);
		}
	}

	function closeCard() {
		active = null;
		cardBox = null;
	}

	function onMouseMove(e: MouseEvent) {
		if (!placed.length) return;
		if ((e.target as HTMLElement)?.closest?.('[data-ai-diff-card]')) {
			clearTimeout(hideTimer);
			return;
		}
		const hit = placed.find((p) => p.hits.some((b) => inside(b, e.clientX, e.clientY)));
		if (hit) openCard(hit.key);
		else if (active != null) {
			clearTimeout(hideTimer);
			hideTimer = setTimeout(closeCard, 300);
		}
	}

	/** 前後の変更へ移動して、差分を開く */
	function go(step: number) {
		const root = editorRoot();
		if (!root || !placed.length) return;
		cursor = (cursor + step + placed.length) % placed.length;
		const item = placed[cursor];
		const range = textRange(root, item.deco.start, Math.max(item.deco.end, item.deco.start + 1));
		if (range) scrollRangeIntoView(root, range);
		active = item.key;
		// スクロールが終わってから位置を測り直す
		setTimeout(() => {
			layout();
			placeCard(item.key);
		}, 350);
	}

	async function act(item: Placed, action: 'keep' | 'revert' | 'apply' | 'reject') {
		const { edit } = item.entry;
		closeCard();
		if (action === 'keep') claudeStore.keepEdit(edit);
		else if (action === 'revert') await claudeStore.revertEdit(edit);
		else if (action === 'apply') await claudeStore.applyEdit(edit);
		else claudeStore.rejectEdit(edit);
	}

	let activeItem = $derived(placed.find((p) => p.key === active) ?? null);
	let appliedCount = $derived(placed.filter((p) => p.deco.kind === 'applied').length);
	let pendingCount = $derived(placed.length - appliedCount);

	onMount(() => {
		window.addEventListener('scroll', schedule, true);
		window.addEventListener('resize', schedule);
		document.addEventListener('mousemove', onMouseMove);
		return () => {
			cancelAnimationFrame(frame);
			clearTimeout(hideTimer);
			window.removeEventListener('scroll', schedule, true);
			window.removeEventListener('resize', schedule);
			document.removeEventListener('mousemove', onMouseMove);
			setHighlights([], []);
		};
	});
</script>

{#if clip && placed.length}
	<div
		class="layer"
		style="left:{clip.left}px;top:{clip.top}px;width:{clip.width}px;height:{clip.height}px"
		aria-hidden="true"
	>
		{#each placed as item (item.key)}
			{#if !useHighlight}
				{#each item.marks as b, i (i)}
					<div
						class="mark {b.kind}"
						style="left:{b.left - clip.left}px;top:{b.top -
							clip.top}px;width:{b.width}px;height:{b.height}px"
					></div>
				{/each}
			{/if}
			{#each item.ghosts as b, i (i)}
				<div
					class="ghost {b.kind}"
					class:active={active === item.key}
					style="left:{b.left - clip.left}px;top:{b.top -
						clip.top}px;width:{b.width}px;height:{b.height}px"
				></div>
				{#if b.text.trim()}
					<!-- 本文に無い側の文字を、その位置の上(縦書きなら右)に小さな札で出す -->
					<div
						class="ghost-text {b.kind}"
						class:vertical
						class:active={active === item.key}
						style="left:{b.left - clip.left + (vertical ? b.width + 2 : 0)}px;top:{b.top -
							clip.top}px"
					>
						{b.text}
					</div>
				{/if}
			{/each}
		{/each}
	</div>

	<div
		class="bar"
		style="left:{clip.left + clip.width / 2}px;top:{clip.top + clip.height - 72}px"
		role="toolbar"
		aria-label="AI の変更"
		transition:fly={{ y: 16, duration: 220 }}
	>
		<span class="bar-icon" aria-hidden="true">
			<svg
				viewBox="0 0 24 24"
				width="16"
				height="16"
				fill="none"
				stroke="currentColor"
				stroke-width="1.8"
				stroke-linecap="round"
				stroke-linejoin="round"
				><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /></svg
			>
		</span>
		<span class="bar-label">
			<strong>AI の変更 {placed.length} 件</strong>
			<small
				>{appliedCount ? `反映済み ${appliedCount}` : ''}{appliedCount && pendingCount
					? '・'
					: ''}{pendingCount ? `提案 ${pendingCount}` : ''}</small
			>
		</span>
		<span class="bar-nav">
			<button class="nav" onclick={() => go(-1)} title="前の変更" aria-label="前の変更">
				<svg
					viewBox="0 0 24 24"
					width="16"
					height="16"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg
				>
			</button>
			<button class="nav" onclick={() => go(1)} title="次の変更" aria-label="次の変更">
				<svg
					viewBox="0 0 24 24"
					width="16"
					height="16"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg
				>
			</button>
		</span>
		{#if appliedCount}
			<button class="bar-btn" onclick={() => claudeStore.forEditorEdits('revert')}
				>すべて元に戻す</button
			>
			<button class="bar-btn primary" onclick={() => claudeStore.forEditorEdits('keep')}
				>すべて保持</button
			>
		{/if}
		{#if pendingCount}
			<button class="bar-btn" onclick={() => claudeStore.forEditorEdits('reject')}
				>すべて却下</button
			>
			<button class="bar-btn primary" onclick={() => claudeStore.forEditorEdits('apply')}
				>すべて反映</button
			>
		{/if}
	</div>
{/if}

{#if activeItem && cardBox}
	{@const item = activeItem}
	<div
		class="card"
		data-ai-diff-card
		style="left:{cardBox.left}px;top:{cardBox.top}px"
		role="dialog"
		aria-label="AI の変更の詳細"
	>
		<div class="card-title">
			{item.deco.kind === 'applied' ? 'AI が変更しました' : 'AI の提案'}
		</div>
		<div class="diff">
			{#each diffChars(item.entry.edit.old, item.entry.edit.new) as op, i (i)}<span class={op.kind}
					>{op.text}</span
				>{/each}
		</div>
		<div class="card-buttons">
			{#if item.deco.kind === 'applied'}
				<button class="primary" onclick={() => act(item, 'keep')}>保持</button>
				<button onclick={() => act(item, 'revert')}>元に戻す</button>
			{:else}
				<button class="primary" onclick={() => act(item, 'apply')}>反映</button>
				<button onclick={() => act(item, 'reject')}>却下</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	:global(::highlight(storift-ai-add)) {
		background-color: color-mix(in srgb, var(--color-success) 30%, transparent);
	}

	:global(::highlight(storift-ai-del)) {
		background-color: color-mix(in srgb, var(--color-error) 22%, transparent);
		text-decoration: line-through;
		text-decoration-color: var(--color-error);
	}

	.layer {
		position: fixed;
		z-index: 50;
		overflow: hidden;
		pointer-events: none;
	}

	.mark,
	.ghost {
		position: absolute;
		border-radius: 2px;
	}

	.mark.add {
		background: color-mix(in srgb, var(--color-success) 30%, transparent);
	}

	.mark.del {
		background: color-mix(in srgb, var(--color-error) 22%, transparent);
	}

	.ghost.del {
		background: var(--color-error);
	}

	.ghost.add {
		background: var(--color-success);
	}

	.ghost.active {
		box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 30%, transparent);
	}

	.ghost-text {
		position: absolute;
		max-width: 260px;
		padding: 0 5px;
		border-radius: 4px;
		font-size: 12px;
		line-height: 18px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		transform: translate(-2px, -100%);
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
		transition: box-shadow 0.15s;
	}

	.ghost-text.vertical {
		max-width: none;
		max-height: 260px;
		padding: 5px 0;
		writing-mode: vertical-rl;
		transform: none;
	}

	/* 反映済みで消えた文字 */
	.ghost-text.del {
		color: var(--color-error);
		background: color-mix(in srgb, var(--color-error) 12%, var(--editor-background));
		text-decoration: line-through;
	}

	/* 提案で入る文字 */
	.ghost-text.add {
		color: var(--color-success);
		background: color-mix(in srgb, var(--color-success) 14%, var(--editor-background));
	}

	.ghost-text.active {
		box-shadow: 0 0 0 1.5px currentColor;
	}

	/* 変更の承認バー: 原稿の上で見落とさないよう、墨色の帯にする */
	.bar {
		position: fixed;
		z-index: 60;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 6px 6px 12px;
		border-radius: 14px;
		background: var(--color-text);
		color: var(--color-background);
		box-shadow:
			0 2px 6px rgb(0 0 0 / 0.12),
			0 12px 32px rgb(0 0 0 / 0.18);
		font-size: 13px;
		white-space: nowrap;
	}

	.bar-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		background: color-mix(in srgb, var(--color-background) 14%, transparent);
	}

	.bar-label {
		display: flex;
		flex-direction: column;
		line-height: 1.25;
		margin-right: 4px;
	}

	.bar-label strong {
		font-weight: 600;
	}

	.bar-label small {
		font-size: 11px;
		opacity: 0.7;
	}

	.bar-nav {
		display: flex;
		gap: 2px;
		padding: 0 6px;
		border-left: 1px solid color-mix(in srgb, var(--color-background) 22%, transparent);
		border-right: 1px solid color-mix(in srgb, var(--color-background) 22%, transparent);
	}

	.bar .nav {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: inherit;
	}

	.bar .nav:hover {
		background: color-mix(in srgb, var(--color-background) 14%, transparent);
	}

	.bar-btn {
		height: 32px;
		padding: 0 14px;
		border: 1px solid color-mix(in srgb, var(--color-background) 30%, transparent);
		border-radius: 9px;
		background: transparent;
		color: inherit;
		font-size: 13px;
		transition:
			background-color 0.15s,
			transform 0.1s;
	}

	.bar-btn:hover {
		background: color-mix(in srgb, var(--color-background) 12%, transparent);
	}

	.bar-btn:active {
		transform: scale(0.97);
	}

	.bar-btn.primary {
		border-color: transparent;
		background: var(--color-background);
		color: var(--color-text);
		font-weight: 600;
	}

	.bar-btn.primary:hover {
		background: color-mix(in srgb, var(--color-background) 88%, var(--color-text));
	}

	.card {
		position: fixed;
		z-index: 70;
		width: 320px;
		max-height: 300px;
		display: flex;
		flex-direction: column;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		box-shadow: var(--shadow-float);
		font-size: 13px;
		color: var(--color-text);
	}

	.card-title {
		padding: 6px 10px;
		font-size: 12px;
		color: var(--color-text-secondary);
		border-bottom: 1px solid var(--color-border);
	}

	.diff {
		padding: 8px 10px;
		overflow-y: auto;
		white-space: pre-wrap;
		word-break: break-word;
		line-height: 1.8;
	}

	.diff .del {
		color: var(--color-error);
		background: color-mix(in srgb, var(--color-error) 14%, transparent);
		text-decoration: line-through;
	}

	.diff .add {
		color: var(--color-success);
		background: color-mix(in srgb, var(--color-success) 16%, transparent);
	}

	.card-buttons {
		display: flex;
		gap: 6px;
		padding: 0 10px 10px;
	}

	button {
		padding: 3px 10px;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		font-size: 12px;
		cursor: pointer;
		color: var(--color-text);
		background: var(--color-surface);
	}

	button.primary {
		border-color: var(--color-primary);
		background: var(--color-primary);
		color: var(--color-background);
	}
</style>
