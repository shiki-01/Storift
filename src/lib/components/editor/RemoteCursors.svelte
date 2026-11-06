<script lang="ts">
	import { untrack } from 'svelte';
	import type * as Y from 'yjs';
	import type { EditorBinding } from '$lib/crdt/editorBinding';
	import type { PresenceEntry } from '$lib/crdt/presencePolicy';
	import {
		CURSOR_LABEL_SHOW_MS,
		cursorKey,
		decodeCursor,
		isLabelEmphasized,
		locateTextOffset
	} from '$lib/crdt/remoteCursor';

	/**
	 * 共同編集中に、同じシーンを開いている他の人のカーソルと選択範囲を重ねて描く。
	 * 本文のレイアウトには影響しない(position:absolute・pointer-events:none)。親(.editor-page)の中に置かれ、
	 * 本文と一緒にスクロールするので、スクロールでは位置の再計算は要らない。
	 * 位置は Y.RelativePosition → 今の Y.Text の絶対インデックス → DOM の位置(Range)の順に求める。
	 */
	interface Props {
		/** 本文の contenteditable */
		root: HTMLElement | null;
		ydoc: Y.Doc;
		ytext: Y.Text;
		binding: EditorBinding | null;
		/** 同じシーンを開いていてカーソルを持つ他者(90 秒以内のものだけ) */
		cursors: PresenceEntry[];
		/** フォント・サイズ・テーマなど、レイアウトが変わったら変わる値 */
		layoutKey: string;
	}

	let { root, ydoc, ytext, binding, cursors, layoutKey }: Props = $props();

	interface Box {
		x: number;
		y: number;
		w: number;
		h: number;
	}
	interface Item {
		uid: string;
		name: string;
		color: string;
		caret: Box | null;
		rects: Box[];
		emphasized: boolean;
	}

	let overlay = $state<HTMLElement | null>(null);
	let items = $state<Item[]>([]);

	// 位置が変わった時刻(名前ラベルを濃く出す期間の判定用)
	let changed: Record<string, { key: string; at: number }> = {};
	let frame = 0;
	let labelTimer: ReturnType<typeof setTimeout> | null = null;
	let retries = 0;

	function schedule() {
		if (frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			compute();
		});
	}

	function toBox(rect: DOMRect, origin: DOMRect): Box {
		return { x: rect.left - origin.left, y: rect.top - origin.top, w: rect.width, h: rect.height };
	}

	function rangeAt(from: number, to: number): Range | null {
		if (!root) return null;
		const start = locateTextOffset(root, from);
		const end = locateTextOffset(root, to);
		const range = document.createRange();
		try {
			range.setStart(start.node as Node, start.offset);
			range.setEnd(end.node as Node, end.offset);
		} catch {
			return null;
		}
		return range;
	}

	/** キャレットの矩形。空行など矩形が取れない位置は、その位置の要素で代用する */
	function caretRect(index: number): DOMRect | null {
		const range = rangeAt(index, index);
		if (!range) return null;
		const rects = Array.from(range.getClientRects()).filter((r) => r.height > 0);
		if (rects.length > 0) return rects[0];
		const rect = range.getBoundingClientRect();
		if (rect.height > 0) return rect;
		const container = range.startContainer;
		const child =
			container.childNodes[range.startOffset] ?? container.childNodes[range.startOffset - 1];
		const el =
			child?.nodeType === Node.ELEMENT_NODE
				? (child as Element)
				: container.nodeType === Node.ELEMENT_NODE
					? (container as Element)
					: container.parentElement;
		const fallback = el?.getBoundingClientRect();
		return fallback && fallback.height > 0 ? fallback : null;
	}

	function compute() {
		if (!overlay || !root || !root.isConnected) {
			items = [];
			return;
		}
		// リモートの変更がまだ本文の DOM に入っていない間は、位置がずれるので待つ(反映後は MutationObserver も来る)
		if (binding?.hasPendingRemote && retries < 10) {
			retries++;
			schedule();
			return;
		}
		retries = 0;
		// 縦書きなどでは矩形の対応が崩れるので描かない
		if (getComputedStyle(root).writingMode !== 'horizontal-tb') {
			items = [];
			return;
		}
		const origin = overlay.getBoundingClientRect();
		const now = Date.now();
		const next: Item[] = [];
		for (const entry of cursors) {
			if (!entry.cursor) continue;
			const resolved = decodeCursor(ydoc, ytext, entry.cursor);
			if (!resolved) continue;
			const start = Math.min(resolved.anchor, resolved.head);
			const end = Math.max(resolved.anchor, resolved.head);
			const caret = caretRect(resolved.head);
			const rects: Box[] = [];
			if (start !== end) {
				const range = rangeAt(start, end);
				if (range) {
					for (const rect of Array.from(range.getClientRects())) {
						if (rect.width > 0 && rect.height > 0) rects.push(toBox(rect, origin));
					}
				}
			}
			if (!caret && rects.length === 0) continue;
			const mark = changed[entry.uid];
			next.push({
				uid: entry.uid,
				name: entry.name,
				color: entry.color,
				caret: caret ? toBox(caret, origin) : null,
				rects,
				emphasized: !mark || isLabelEmphasized(mark.at, now)
			});
		}
		items = next;
	}

	// リモートの更新(cursors)・レイアウトの変化・本文の DOM の変化で再計算する
	$effect(() => {
		void layoutKey;
		void root;
		const list = cursors;
		untrack(() => {
			const now = Date.now();
			let fresh = false;
			const alive: string[] = [];
			for (const entry of list) {
				alive.push(entry.uid);
				const key = cursorKey(entry.cursor ?? null);
				if (changed[entry.uid]?.key !== key) {
					changed[entry.uid] = { key, at: now };
					fresh = true;
				}
			}
			for (const uid of Object.keys(changed)) if (!alive.includes(uid)) delete changed[uid];
			if (fresh) {
				// 濃い表示の期間が終わったら淡くするため、もう一度計算する
				if (labelTimer) clearTimeout(labelTimer);
				labelTimer = setTimeout(schedule, CURSOR_LABEL_SHOW_MS + 50);
			}
			schedule();
		});
	});

	$effect(() => {
		const element = root;
		if (!element) return;
		const mutations = new MutationObserver(schedule);
		mutations.observe(element, { childList: true, characterData: true, subtree: true });
		const resizes = new ResizeObserver(schedule);
		resizes.observe(element);
		window.addEventListener('resize', schedule);
		void document.fonts?.ready.then(schedule);
		document.fonts?.addEventListener?.('loadingdone', schedule);
		return () => {
			mutations.disconnect();
			resizes.disconnect();
			window.removeEventListener('resize', schedule);
			document.fonts?.removeEventListener?.('loadingdone', schedule);
		};
	});

	$effect(() => {
		return () => {
			if (frame) cancelAnimationFrame(frame);
			frame = 0;
			if (labelTimer) clearTimeout(labelTimer);
		};
	});
</script>

<div class="remote-cursors" bind:this={overlay} aria-hidden="true" data-testid="remote-cursors">
	{#each items as item (item.uid)}
		<div
			class="rc"
			data-remote-cursor={item.uid}
			data-name={item.name}
			style:--rc-color={item.color}
		>
			{#each item.rects as rect, i (i)}
				<span
					class="rc-sel"
					data-remote-selection={item.uid}
					style:left="{rect.x}px"
					style:top="{rect.y}px"
					style:width="{rect.w}px"
					style:height="{rect.h}px"
				></span>
			{/each}
			{#if item.caret}
				<span
					class="rc-caret"
					style:left="{item.caret.x}px"
					style:top="{item.caret.y}px"
					style:height="{item.caret.h}px"
				>
					<span class="rc-label" class:on={item.emphasized}>{item.name}</span>
				</span>
			{/if}
		</div>
	{/each}
</div>

<style>
	.remote-cursors {
		position: absolute;
		inset: 0;
		pointer-events: none;
		user-select: none;
		z-index: 1;
	}

	.rc-sel {
		position: absolute;
		background: color-mix(in srgb, var(--rc-color) 28%, transparent);
	}

	.rc-caret {
		position: absolute;
		width: 2px;
		margin-left: -1px;
		background: var(--rc-color);
	}

	.rc-label {
		position: absolute;
		left: -1px;
		bottom: 100%;
		max-width: 12em;
		padding: 0 5px;
		border-radius: 3px 3px 3px 0;
		background: var(--rc-color);
		color: #fff;
		font-size: 10px;
		line-height: 15px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		opacity: 0.35;
		transition: opacity 0.6s ease;
	}

	.rc-label.on {
		opacity: 1;
		transition-duration: 0.1s;
	}

	@media (prefers-reduced-motion: reduce) {
		.rc-label {
			transition: none;
		}
	}
</style>
