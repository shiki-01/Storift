<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { previewToHtml } from '$lib/utils/ruby';
	import { estimateLines, type Manuscript } from '$lib/utils/manuscript';
	import type { WritingMode } from '$lib/types';

	/**
	 * 作品全体を通して読むための、読み取り専用の連続表示。
	 * 各シーンの本文は、画面の近くに来た時だけ描画する(離れたシーンは見積もりの大きさの空き)。
	 * 位置は「シーン + そのシーン内の割合」で扱い、描画によるずれは数フレームかけて補正する。
	 */
	interface Props {
		manuscript: Manuscript;
		projectTitle: string;
		writingMode: WritingMode;
		fontSize: number;
		lineHeight: number;
		letterSpacing: number;
		fontFamily: string;
		/** 開いた時に復元する位置 */
		initial: { sceneId: string; ratio: number } | null;
		/** 読んでいる位置が変わった(スクロールが落ち着いた)時 */
		onposition: (position: { sceneIndex: number; ratio: number }) => void;
		/** 「このシーンをエディタで開く」 */
		onopen: (sceneId: string) => void;
	}

	let {
		manuscript,
		projectTitle,
		writingMode,
		fontSize,
		lineHeight,
		letterSpacing,
		fontFamily,
		initial,
		onposition,
		onopen
	}: Props = $props();

	let reader = $state<HTMLDivElement | null>(null);
	let viewW = $state(360);
	let viewH = $state(640);
	let vertical = $derived(writingMode === 'vertical');

	// 本文を描画済みのシーン(一度描画したら残す。描画後は content-visibility で画面外のレイアウトを省く)
	const rendered = new SvelteSet<string>();

	// 横書きの 1 行の最大幅(em)。CSS の .flow と揃える
	const MAX_LINE_EM = 38;
	const PAD_PX = 20;
	const PAD_BLOCK_PX = 24;

	// 未描画のシーンの大きさ(行数 × 行の高さ)の見積り
	let estimates = $derived.by(() => {
		const inline = vertical
			? viewH - PAD_BLOCK_PX * 2
			: Math.min(viewW - PAD_PX * 2, MAX_LINE_EM * fontSize);
		const perLine = Math.max(1, Math.floor(inline / (fontSize * (1 + letterSpacing))));
		const lh = fontSize * lineHeight;
		return manuscript.scenes.map((s) =>
			s.isEmpty ? lh * 2 : estimateLines(s.content, perLine) * lh
		);
	});

	// --- 位置の計算 ---
	// 「読み始めの端からの距離」を共通の座標にする(横書き: 上から、縦書き: 右から)
	function scrolled(): number {
		if (!reader) return 0;
		return vertical ? -reader.scrollLeft : reader.scrollTop;
	}

	function setScrolled(value: number) {
		if (!reader) return;
		if (vertical) reader.scrollLeft = -value;
		else reader.scrollTop = value;
	}

	function geom(el: Element): { start: number; size: number } {
		const r = el.getBoundingClientRect();
		const c = reader!.getBoundingClientRect();
		const s = scrolled();
		return vertical
			? { start: c.right - r.right + s, size: r.width }
			: { start: r.top - c.top + s, size: r.height };
	}

	// シーンの要素(読む順)。追加・削除のたびに作り直す
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- DOM 要素の管理用で、描画には使わない
	const unitEls = new Map<string, HTMLElement>();
	let unitList: HTMLElement[] = [];
	let unitListDirty = true;
	let io: IntersectionObserver | null = null;

	function getUnits(): HTMLElement[] {
		if (unitListDirty && reader) {
			unitList = Array.from(reader.querySelectorAll<HTMLElement>('.unit'));
			unitListDirty = false;
		}
		return unitList;
	}

	function track(node: HTMLElement) {
		const id = node.dataset.sceneId ?? '';
		unitEls.set(id, node);
		unitListDirty = true;
		io?.observe(node);
		return {
			destroy() {
				if (unitEls.get(id) === node) unitEls.delete(id);
				unitListDirty = true;
				io?.unobserve(node);
			}
		};
	}

	function computePosition(): { sceneIndex: number; ratio: number } | null {
		if (!reader) return null;
		const list = getUnits();
		if (list.length === 0) return null;
		// 末尾までスクロールしたら、最後のシーンの終わりとする(進捗 100% に届くように)
		const viewport = vertical ? reader.clientWidth : reader.clientHeight;
		const total = vertical ? reader.scrollWidth : reader.scrollHeight;
		if (total > viewport && scrolled() + viewport >= total - 2) {
			return { sceneIndex: Number(list[list.length - 1].dataset.index), ratio: 1 };
		}
		const probe = scrolled() + 0.5;
		let lo = 0;
		let hi = list.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (geom(list[mid]).start <= probe) lo = mid;
			else hi = mid - 1;
		}
		const g = geom(list[lo]);
		const ratio = g.size > 0 ? Math.min(Math.max((probe - g.start) / g.size, 0), 1) : 0;
		return { sceneIndex: Number(list[lo].dataset.index), ratio };
	}

	// --- 位置の復元・ジャンプ(描画による大きさの変化を、落ち着くまで追いかけて補正する) ---
	let settleToken = 0;
	let settling = false;
	let lastPos: { sceneIndex: number; ratio: number } | null = null;

	function report() {
		const pos = computePosition();
		if (!pos) return;
		lastPos = pos;
		onposition(pos);
	}

	function cancelSettle() {
		settleToken++;
		settling = false;
	}

	function settleTo(getTarget: () => number | null) {
		const token = ++settleToken;
		settling = true;
		let stable = 0;
		let frames = 0;
		const step = () => {
			if (token !== settleToken) return;
			const target = getTarget();
			if (target !== null) {
				const cur = scrolled();
				if (Math.abs(target - cur) > 1) {
					setScrolled(Math.max(0, target));
					// 末尾などで動けない場合も、安定したものとして数える
					if (Math.abs(scrolled() - cur) < 0.5) stable++;
					else stable = 0;
				} else {
					stable++;
				}
			}
			frames++;
			if (stable >= 6 || frames > 90) {
				settling = false;
				report();
				return;
			}
			requestAnimationFrame(step);
		};
		requestAnimationFrame(step);
	}

	/** 指定のシーンの、先頭から ratio(0〜1)の位置へ移動する */
	export async function jumpTo(sceneId: string, ratio = 0): Promise<boolean> {
		const index = manuscript.sceneIndexById.get(sceneId);
		if (index === undefined) return false;
		for (let i = index - 1; i <= index + 1; i++) {
			const s = manuscript.scenes[i];
			if (s) rendered.add(s.id);
		}
		await tick();
		settleTo(() => {
			const el = unitEls.get(sceneId);
			if (!el) return null;
			const g = geom(el);
			return g.start + ratio * g.size;
		});
		return true;
	}

	/** 章の先頭へ移動する(シーンが無い章は見出しへ) */
	export async function jumpToChapter(chapterId: string): Promise<boolean> {
		const chapter = manuscript.chapters.find((c) => c.id === chapterId);
		if (!chapter) return false;
		if (chapter.scenes.length > 0) return jumpTo(chapter.scenes[0].id, 0);
		await tick();
		settleTo(() => {
			const el = Array.from(
				reader?.querySelectorAll<HTMLElement>('[data-chapter-heading]') ?? []
			).find((e) => e.dataset.chapterHeading === chapterId);
			return el ? geom(el).start : null;
		});
		return true;
	}

	/** 今の位置を保ったまま、レイアウトの変化(表示設定・データ更新)を補正し直す */
	async function reanchor() {
		const pos = lastPos;
		if (!pos) return;
		const scene = manuscript.scenes[pos.sceneIndex];
		if (scene) await jumpTo(scene.id, pos.ratio);
	}

	// --- 描画の遅延(画面の近くに来たシーンだけ本文を描画) ---
	$effect(() => {
		if (!reader) return;
		const margin = vertical ? '0px 150% 0px 150%' : '150% 0px 150% 0px';
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					const id = (entry.target as HTMLElement).dataset.sceneId;
					if (id) rendered.add(id);
				}
			},
			{ root: reader, rootMargin: margin }
		);
		io = observer;
		for (const el of unitEls.values()) observer.observe(el);
		return () => {
			observer.disconnect();
			if (io === observer) io = null;
		};
	});

	// 表示領域の大きさ(未描画シーンの見積りに使う)
	$effect(() => {
		if (!reader) return;
		const el = reader;
		const update = () => {
			viewW = el.clientWidth;
			viewH = el.clientHeight;
		};
		update();
		const ro = new ResizeObserver(update);
		ro.observe(el);
		return () => ro.disconnect();
	});

	// 縦書きでは縦のホイールを横スクロールへ変換する(右から左へ読む向き)
	$effect(() => {
		if (!reader || !vertical) return;
		const el = reader;
		const onWheel = (e: WheelEvent) => {
			if (e.ctrlKey || e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
			e.preventDefault();
			el.scrollLeft -= e.deltaY;
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	});

	// 利用者の操作が始まったら、補正を止める(操作を奪わない)
	$effect(() => {
		if (!reader) return;
		const el = reader;
		const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
		for (const name of events) el.addEventListener(name, cancelSettle, { passive: true });
		return () => {
			for (const name of events) el.removeEventListener(name, cancelSettle);
		};
	});

	let scrollFrame = 0;
	function onScroll() {
		if (settling || scrollFrame) return;
		scrollFrame = requestAnimationFrame(() => {
			scrollFrame = 0;
			if (!settling) report();
		});
	}

	// 縦横・文字サイズなどの変更後は、読んでいた位置へ戻す
	let ready = false;
	$effect(() => {
		void vertical;
		void fontSize;
		void lineHeight;
		void letterSpacing;
		void fontFamily;
		if (!ready) return;
		untrack(() => void tick().then(reanchor));
	});

	// データの更新後も、読んでいた位置を保つ
	$effect(() => {
		void manuscript;
		if (!ready) return;
		untrack(() => void tick().then(reanchor));
	});

	onMount(() => {
		reader?.focus({ preventScroll: true });
		const target = initial && manuscript.sceneIndexById.has(initial.sceneId) ? initial : null;
		if (target) void jumpTo(target.sceneId, target.ratio);
		else report();
		ready = true;
		return () => {
			cancelSettle();
			if (scrollFrame) cancelAnimationFrame(scrollFrame);
		};
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
	class="reader"
	class:scroll-stable={!vertical}
	class:vertical
	bind:this={reader}
	onscroll={onScroll}
	tabindex="0"
	role="region"
	aria-label="作品の本文"
	data-testid="reader"
	style="
		--fs: {fontSize}px;
		--lh: {lineHeight};
		--ls: {letterSpacing}em;
		--ff: {fontFamily};
		--max-line: {MAX_LINE_EM};
		--pad: {PAD_PX}px;
		--pad-block: {PAD_BLOCK_PX}px;
	"
>
	<div class="flow">
		<h1 class="work-title">{projectTitle}</h1>

		{#each manuscript.chapters as chapter (chapter.id)}
			{#if chapter.scenes.length === 0}
				<h2 class="chapter-title" data-chapter-heading={chapter.id}>{chapter.title}</h2>
				<p class="empty-note">（この章にはまだシーンがありません）</p>
			{/if}
			{#each chapter.scenes as scene (scene.id)}
				<div
					class="unit"
					class:rendered={rendered.has(scene.id)}
					data-scene-id={scene.id}
					data-index={scene.index}
					data-chapter-id={chapter.id}
					style="--est: {estimates[scene.index] ?? 0}px"
					use:track
				>
					{#if scene.indexInChapter === 0}
						<h2 class="chapter-title" data-chapter-heading={chapter.id}>{chapter.title}</h2>
					{/if}
					<article class="scene" aria-label={scene.title}>
						<div class="scene-head">
							{#if scene.indexInChapter > 0}
								<span class="sep" aria-hidden="true">＊</span>
							{/if}
							<button
								type="button"
								class="open-btn"
								onclick={() => onopen(scene.id)}
								aria-label="「{scene.title}」をエディタで開く"
								title="「{scene.title}」をエディタで開く"
							>
								<svg
									viewBox="0 0 24 24"
									width="14"
									height="14"
									fill="none"
									stroke="currentColor"
									stroke-width="1.8"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<path d="M4 20h4L18.5 9.5a2.83 2.83 0 0 0-4-4L4 16v4" />
									<path d="M13.5 6.5l4 4" />
								</svg>
							</button>
						</div>
						{#if rendered.has(scene.id)}
							{#if scene.isEmpty}
								<p class="empty-note">（本文なし）</p>
							{:else}
								<div class="body selectable">
									<!-- eslint-disable-next-line svelte/no-at-html-tags -- previewToHtml で本文をエスケープ済み -->
									{@html previewToHtml(scene.content, true, true)}
								</div>
							{/if}
						{:else}
							<div class="placeholder" aria-hidden="true"></div>
						{/if}
					</article>
				</div>
			{/each}
		{/each}

		<div class="tail" aria-hidden="true"></div>
	</div>
</div>

<style>
	.reader {
		width: 100%;
		height: 100%;
		overflow: auto;
		background: var(--editor-background, #fff);
		color: var(--editor-text, #333);
		font-family: var(--ff);
		font-size: var(--fs);
		line-height: var(--lh);
		letter-spacing: var(--ls);
		overscroll-behavior: contain;
		outline: none;
	}

	.reader:focus-visible {
		outline: 2px solid color-mix(in srgb, var(--color-primary, #33507a) 55%, transparent);
		outline-offset: -2px;
	}

	.reader.vertical {
		writing-mode: vertical-rl;
		overflow-x: auto;
		overflow-y: hidden;
	}

	/* 横書き: 読みやすい行の長さに収めて中央へ */
	.flow {
		box-sizing: border-box;
		max-width: calc(var(--max-line) * var(--fs) + var(--pad) * 2);
		margin: 0 auto;
		padding: var(--pad-block) calc(var(--pad) + var(--safe-right, 0px)) 0
			calc(var(--pad) + var(--safe-left, 0px));
	}

	/* 縦書き: 高さいっぱいに行を流し、右から左へ段を積む */
	.reader.vertical .flow {
		max-width: none;
		margin: 0;
		height: 100%;
		padding: var(--pad-block) var(--pad);
		padding-right: calc(var(--pad) + var(--safe-right, 0px));
		padding-left: calc(var(--pad) + var(--safe-left, 0px));
	}

	.work-title {
		margin: 0;
		margin-block-end: 3em;
		font-size: 1.5em;
		font-weight: 600;
		line-height: 1.5;
	}

	.chapter-title {
		margin: 0;
		margin-block: 3em 2em;
		font-size: 1.25em;
		font-weight: 600;
		line-height: 1.5;
	}

	.unit.rendered {
		content-visibility: auto;
		contain-intrinsic-block-size: auto var(--est);
	}

	.scene-head {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5em;
		min-height: 2em;
		margin: 0;
		margin-block: 1.5em;
		color: var(--color-text-secondary, #999);
		letter-spacing: 0;
	}

	.reader.vertical .scene-head {
		flex-direction: column;
		min-height: 0;
		min-width: 2em;
	}

	.sep {
		font-size: 0.9em;
		opacity: 0.7;
	}

	.open-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border: none;
		border-radius: 6px;
		background: transparent;
		color: inherit;
		opacity: 0.45;
		cursor: pointer;
		writing-mode: horizontal-tb;
	}

	.open-btn:hover,
	.open-btn:focus-visible {
		opacity: 1;
		background: color-mix(in srgb, currentColor 10%, transparent);
	}

	/* 指で押しやすい大きさ */
	@media (pointer: coarse) {
		.open-btn {
			width: 36px;
			height: 36px;
		}
	}

	.placeholder {
		block-size: var(--est);
	}

	.body :global(p) {
		margin: 0;
		min-height: 1em;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.body :global(p.empty-line) {
		min-height: calc(var(--lh) * 1em);
	}

	.empty-note {
		margin: 0;
		color: var(--color-text-secondary, #999);
		font-size: 0.9em;
	}

	.body :global(.bouten) {
		text-emphasis: filled sesame;
		text-emphasis-position: over right;
	}

	.reader.vertical .body :global(.bouten) {
		text-emphasis-position: right;
	}

	.body :global(ruby) {
		ruby-align: center;
	}

	.body :global(rt) {
		font-size: 0.5em;
	}

	.tail {
		block-size: 40vmin;
	}
</style>
