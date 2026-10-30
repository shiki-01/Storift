<script lang="ts">
	/**
	 * エディタ上に、Claude の変更を色付きで表示する(VS Code の Copilot のインライン差分に当たる)。
	 *
	 * - 反映済みで未確認の変更: 追加した文字を緑、消えた文字のあった位置に赤い印
	 * - 未反映の提案: 消える文字を赤(取り消し線)、入る位置に緑の印
	 *
	 * 本文の DOM は書き換えず、CSS Custom Highlight API で色を付ける(非対応の環境では半透明の枠を重ねる)。
	 * 変更にマウスを乗せると差分と「保持 / 元に戻す」(提案なら「反映 / 却下」)が出る。
	 */
	import { onMount } from 'svelte';
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
		ghosts: (Box & { kind: 'add' | 'del' })[];
		/** ホバーの判定に使う、変更全体の矩形 */
		hits: Box[];
	}

	const useHighlight = supportsHighlight();

	let placed = $state<Placed[]>([]);
	let clip = $state<Box | null>(null);
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
			const vertical = getComputedStyle(root).writingMode.startsWith('vertical');
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
					if (b) item.ghosts.push({ ...b, kind: g.kind });
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
			{/each}
		{/each}
	</div>

	<div
		class="bar"
		style="left:{clip.left + clip.width / 2}px;top:{clip.top + clip.height - 52}px"
		role="toolbar"
		aria-label="AI の変更"
	>
		<span class="bar-label">AI の変更 {placed.length} 件</span>
		<button onclick={() => go(-1)} title="前の変更" aria-label="前の変更">↑</button>
		<button onclick={() => go(1)} title="次の変更" aria-label="次の変更">↓</button>
		{#if appliedCount}
			<button class="primary" onclick={() => claudeStore.forEditorEdits('keep')}>すべて保持</button>
			<button onclick={() => claudeStore.forEditorEdits('revert')}>すべて元に戻す</button>
		{/if}
		{#if pendingCount}
			<button class="primary" onclick={() => claudeStore.forEditorEdits('apply')}>すべて反映</button
			>
			<button onclick={() => claudeStore.forEditorEdits('reject')}>すべて却下</button>
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

	.bar {
		position: fixed;
		z-index: 60;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 6px 4px 12px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		background: var(--color-background);
		box-shadow: var(--shadow-float);
		font-size: 12px;
		white-space: nowrap;
	}

	.bar-label {
		margin-right: 4px;
		color: var(--color-text-secondary);
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

	.bar button {
		border-radius: 999px;
	}

	button.primary {
		border-color: var(--color-primary);
		background: var(--color-primary);
		color: var(--color-background);
	}
</style>
