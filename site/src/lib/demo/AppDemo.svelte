<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/Icon.svelte';
	import type { IconName } from '$lib/icons';
	import DemoEditor from './DemoEditor.svelte';
	import DemoPlot from './DemoPlot.svelte';
	import DemoCharacters from './DemoCharacters.svelte';
	import DemoWorld from './DemoWorld.svelte';
	import DemoProgress from './DemoProgress.svelte';
	import Logo from '$lib/Logo.svelte';
	import {
		BASE_TEXT,
		PLOTS,
		type CharMode,
		type PlotStatus,
		type View,
		type WorldCategory
	} from './data';

	// トップの操作デモ。動画ではなく、本物の部品を台本どおりに動かしている。
	// 配色に追従し、文字もぼやけず、読み込みも軽い。

	const rail: { view: View | 'preview'; icon: IconName; label: string }[] = [
		{ view: 'editor', icon: 'write', label: '執筆' },
		{ view: 'preview', icon: 'preview', label: '通読' },
		{ view: 'plot', icon: 'plot', label: 'プロット' },
		{ view: 'characters', icon: 'characters', label: '人物' },
		{ view: 'world', icon: 'world', label: '設定資料' },
		{ view: 'progress', icon: 'progress', label: '進捗' }
	];

	const chapters = [
		{ id: 'write', label: '書く', note: '記法をそのまま打つと、隣の縦書きに組まれます' },
		{
			id: 'plot',
			label: 'プロット',
			note: 'カードをドラッグして、アイデアから推敲済みまで進めます'
		},
		{ id: 'characters', label: '人物', note: '一覧と詳細で読み、相関図で関係を整理します' },
		{ id: 'world', label: '設定資料', note: '分類で絞り込み、選ぶと全文が読めます' },
		{ id: 'progress', label: '進捗', note: '書いた分量は、日ごとに記録されます' }
	] as const;

	// ===== 画面の状態 =====
	let view = $state<View>('editor');
	let split = $state(false);
	let text = $state(BASE_TEXT);
	let saving = $state(false);
	let plots = $state<Record<string, PlotStatus>>({});
	let plotDrag = $state<{ id: string; x: number; y: number } | null>(null);
	let charMode = $state<CharMode>('list');
	let charOpened = $state(false);
	let worldChip = $state<'all' | WorldCategory>('all');
	let worldOpened = $state('');
	let mover = $state({ x: 0, y: 0 });
	let progressShown = $state(0);
	let pressed = $state<string | null>(null);

	let cursor = $state({ x: 60, y: 60, down: false, shown: false });
	let chapter = $state(0);
	let paused = $state(false);
	let inView = $state(true);
	let reduced = $state(false);

	let stage: HTMLElement;
	let notchTop = $state<number | null>(null);

	function resetState() {
		view = 'editor';
		split = false;
		text = BASE_TEXT;
		saving = false;
		plots = Object.fromEntries(PLOTS.map((p) => [p.id, p.status]));
		plotDrag = null;
		charMode = 'list';
		charOpened = false;
		worldChip = 'all';
		worldOpened = '';
		mover = { x: 0, y: 0 };
		progressShown = 0;
		pressed = null;
	}
	resetState();

	$effect(() => {
		void view;
		const el = stage?.querySelector<HTMLElement>('.d-rail-item.active');
		notchTop = el ? el.offsetTop + el.offsetHeight / 2 : null;
	});

	// ===== 台本の時計 =====
	// 止める・飛ばすを一か所で扱うため、待ち時間はすべて描画フレームを数えて進める
	class Cancelled extends Error {}
	let runId = 0;

	function frame(): Promise<number> {
		return new Promise((r) => requestAnimationFrame(r));
	}

	async function clock(id: number, ms: number, onTick?: (t: number) => void) {
		let elapsed = 0;
		let last = performance.now();
		while (elapsed < ms) {
			const now = await frame();
			if (id !== runId) throw new Cancelled();
			if (!paused && inView) elapsed += Math.min(now - last, 64);
			last = now;
			onTick?.(Math.min(elapsed / ms, 1));
		}
	}

	const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

	function targetPoint(name: string) {
		const el = stage.querySelector<HTMLElement>(`[data-t="${name}"]`);
		if (!el) return { x: cursor.x, y: cursor.y };
		const a = el.getBoundingClientRect();
		const b = stage.getBoundingClientRect();
		return { x: a.left - b.left + a.width / 2, y: a.top - b.top + a.height / 2 };
	}

	async function moveTo(id: number, name: string, ms = 650) {
		const from = { x: cursor.x, y: cursor.y };
		const to = targetPoint(name);
		await clock(id, ms, (t) => {
			const k = ease(t);
			// 少しだけ弧を描かせて、機械的な直線にしない
			const arc = Math.sin(k * Math.PI) * Math.min(24, Math.abs(to.x - from.x) * 0.06);
			cursor.x = from.x + (to.x - from.x) * k;
			cursor.y = from.y + (to.y - from.y) * k - arc;
		});
	}

	async function click(id: number, name: string, action: () => void) {
		await moveTo(id, name);
		await clock(id, 120);
		cursor.down = true;
		pressed = name;
		await clock(id, 110);
		cursor.down = false;
		pressed = null;
		action();
	}

	/** カードの取っ手をつかんで、別の列へ運ぶ */
	async function drag(id: number, plot: string, to: PlotStatus) {
		await moveTo(id, `grip-${plot}`);
		await clock(id, 150);
		cursor.down = true;
		const from = { x: cursor.x, y: cursor.y };
		// 取っ手を、移し先の列の上部(左寄り)へ運ぶ
		const col = stage.querySelector<HTMLElement>(`[data-t="col-${to}"]`)!.getBoundingClientRect();
		const box = stage.getBoundingClientRect();
		const dest = { x: col.left - box.left + 30, y: col.top - box.top + 62 };
		plotDrag = { id: plot, x: 0, y: 0 };
		await clock(id, 900, (t) => {
			const k = ease(t);
			const x = (dest.x - from.x) * k;
			const y = (dest.y - from.y) * k;
			plotDrag = { id: plot, x, y };
			cursor.x = from.x + x;
			cursor.y = from.y + y;
		});
		cursor.down = false;
		plotDrag = null;
		plots[plot] = to;
	}

	async function type(id: number, input: string) {
		for (const ch of input) {
			text += ch;
			saving = true;
			// 記号や句読点の後は少し間を置く
			await clock(id, /[、。《》｜]/.test(ch) ? 190 : 70 + Math.random() * 45);
		}
		await clock(id, 450);
		saving = false;
	}

	// ===== 台本 =====
	const scripts: Record<string, (id: number) => Promise<void>> = {
		async write(id) {
			await moveTo(id, 'text-end', 700);
			await clock(id, 300);
			await type(id, '\n　店の奥から、古い紙の匂いがする。');
			await clock(id, 400);
			await click(id, 'mode-split', () => (split = true));
			await clock(id, 600);
			await moveTo(id, 'text-end', 550);
			await type(id, '\n　｜真柴《ましば》さんは《《なにも》》言わなかった。');
			await clock(id, 1500);
		},
		async plot(id) {
			await click(id, 'rail-plot', () => (view = 'plot'));
			await clock(id, 700);
			await drag(id, 'pl3', 'written');
			await clock(id, 700);
			await drag(id, 'pl1', 'planned');
			await clock(id, 1500);
		},
		async characters(id) {
			await click(id, 'rail-characters', () => (view = 'characters'));
			await clock(id, 700);
			await click(id, 'row-akari', () => (charOpened = true));
			await clock(id, 1600);
			await click(id, 'seg-graph', () => (charMode = 'graph'));
			await clock(id, 700);
			await moveTo(id, 'node-mover');
			await clock(id, 120);
			cursor.down = true;
			const from = { x: cursor.x, y: cursor.y };
			await clock(id, 950, (t) => {
				const k = ease(t);
				mover = { x: -70 * k, y: 56 * k };
				cursor.x = from.x - 70 * k;
				cursor.y = from.y + 56 * k;
			});
			cursor.down = false;
			await clock(id, 1300);
		},
		async world(id) {
			await click(id, 'rail-world', () => (view = 'world'));
			await clock(id, 700);
			await click(id, 'chip-location', () => (worldChip = 'location'));
			await clock(id, 700);
			await click(id, 'row-w1', () => (worldOpened = 'w1'));
			await clock(id, 2000);
		},
		async progress(id) {
			await click(id, 'rail-progress', () => (view = 'progress'));
			await clock(id, 1300, (t) => (progressShown = ease(t)));
			await clock(id, 1700);
		}
	};

	// 各章の見た目を、その章の頭の状態へ揃える(途中から飛んだときのため)。
	// 画面は一つ前のものに戻しておき、レールを押す動きを見せる
	function prepare(index: number) {
		resetState();
		split = index >= 1;
		if (index >= 2) {
			plots.pl3 = 'written';
			plots.pl1 = 'planned';
		}
		// 人物から設定資料へ移る章では、相関図で動かした人物の位置を保ったままにする
		if (index >= 3) {
			charMode = 'graph';
			charOpened = true;
			mover = { x: -70, y: 56 };
		}
		// 設定資料から進捗へ移る章では、絞り込みと開いた資料を保つ
		if (index >= 4) {
			worldChip = 'location';
			worldOpened = 'w1';
		}
		view = (['editor', 'editor', 'plot', 'characters', 'world'] as const)[index];
	}

	/** 動きを減らす設定のとき: 章の終わりの状態をそのまま見せる */
	function showFinal(index: number) {
		resetState();
		if (index === 0) {
			split = true;
			text =
				BASE_TEXT +
				'\n　店の奥から、古い紙の匂いがする。\n　｜真柴《ましば》さんは《《なにも》》言わなかった。';
		} else if (index === 1) {
			view = 'plot';
			plots.pl3 = 'written';
			plots.pl1 = 'planned';
		} else if (index === 2) {
			view = 'characters';
			charMode = 'graph';
			charOpened = true;
			mover = { x: -70, y: 56 };
		} else if (index === 3) {
			view = 'world';
			worldChip = 'location';
			worldOpened = 'w1';
		} else {
			view = 'progress';
			progressShown = 1;
		}
	}

	async function play(start: number) {
		const id = ++runId;
		let index = start;
		try {
			while (true) {
				chapter = index;
				prepare(index);
				await clock(id, 500);
				cursor.shown = true;
				await scripts[chapters[index].id](id);
				index = (index + 1) % chapters.length;
			}
		} catch (e) {
			if (!(e instanceof Cancelled)) throw e;
		}
	}

	function jump(index: number) {
		if (reduced) {
			chapter = index;
			showFinal(index);
			return;
		}
		paused = false;
		play(index);
	}

	function togglePause() {
		if (reduced) {
			reduced = false;
			paused = false;
			play(chapter);
			return;
		}
		paused = !paused;
	}

	onMount(() => {
		reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const io = new IntersectionObserver(([e]) => (inView = e.isIntersecting), { threshold: 0.15 });
		io.observe(stage);
		if (reduced) showFinal(0);
		else play(0);
		return () => {
			runId++;
			io.disconnect();
		};
	});
</script>

<figure class="demo">
	<div class="window" bind:this={stage} aria-hidden="true" inert>
		<div class="d-rail">
			<span class="d-mark"><Logo variant="mark" size={24} title="" /></span>
			<div class="d-rail-group">
				{#if notchTop !== null}
					<span class="d-notch" style:transform="translateY({notchTop}px)"></span>
				{/if}
				{#each rail as r (r.view)}
					<span
						class="d-rail-item"
						class:active={view === r.view}
						class:pressed={pressed === `rail-${r.view}`}
						data-t="rail-{r.view}"
					>
						<Icon name={r.icon} size={18} />
						<span>{r.label}</span>
					</span>
				{/each}
			</div>
			<div class="d-rail-bottom">
				<span class="d-rail-item"><Icon name="home" size={18} /><span>作品一覧</span></span>
				<span class="d-rail-item"><Icon name="settings" size={18} /><span>設定</span></span>
				<span class="d-sync"><i></i>同期なし</span>
			</div>
		</div>

		<div class="d-main">
			{#if view === 'editor'}
				<DemoEditor {text} {split} {saving} {pressed} />
			{:else if view === 'plot'}
				<DemoPlot {plots} drag={plotDrag} />
			{:else if view === 'characters'}
				<DemoCharacters
					mode={charMode}
					opened={charOpened}
					{mover}
					dragging={cursor.down}
					{pressed}
				/>
			{:else if view === 'world'}
				<DemoWorld chip={worldChip} opened={worldOpened} {pressed} />
			{:else if view === 'progress'}
				<DemoProgress shown={progressShown} />
			{/if}
		</div>

		<svg
			class="cursor"
			class:shown={cursor.shown}
			class:down={cursor.down}
			style:transform="translate({cursor.x}px, {cursor.y}px)"
			viewBox="0 0 24 24"
			width="22"
			height="22"
		>
			<path
				d="M5 3l14.5 8.2-6.3 1.6-2.9 6.1z"
				fill="var(--cursor-fill)"
				stroke="var(--cursor-line)"
				stroke-width="1.5"
				stroke-linejoin="round"
			/>
		</svg>
	</div>

	<figcaption class="controls">
		<div class="segmented" role="group" aria-label="デモの場面">
			{#each chapters as c, i (c.id)}
				<button type="button" aria-pressed={chapter === i} onclick={() => jump(i)}>{c.label}</button
				>
			{/each}
		</div>
		<p class="note" aria-live="off">{chapters[chapter].note}</p>
		<button
			type="button"
			class="pause"
			aria-label={reduced || paused ? 'デモを再生' : 'デモを一時停止'}
			onclick={togglePause}
		>
			<Icon name={reduced || paused ? 'play' : 'pause'} size={16} />
		</button>
	</figcaption>
</figure>

<style>
	.demo {
		margin: 0;
	}

	.window {
		--cursor-fill: var(--color-text);
		--cursor-line: var(--color-background);
		position: relative;
		display: grid;
		grid-template-columns: 62px minmax(0, 1fr);
		height: clamp(420px, 44vw, 560px);
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: var(--color-background);
		box-shadow: var(--shadow-float);
		overflow: hidden;
		font-size: 12.5px;
		line-height: 1.6;
		user-select: none;
	}

	.d-rail {
		display: flex;
		flex-direction: column;
		min-height: 0;
		padding: 10px 0 8px;
		border-right: 1px solid var(--color-border);
		background: var(--color-surface);
	}

	.d-mark {
		display: flex;
		justify-content: center;
		padding: 4px 0 14px;
	}

	.d-rail-group {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.d-rail-bottom {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-top: auto;
	}

	.d-rail-item {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		margin: 0 5px;
		padding: 6px 0 5px;
		border-radius: 9px;
		color: var(--color-text-secondary);
		font-size: 9.5px;
		line-height: 1.2;
		letter-spacing: 0;
		white-space: nowrap;
		transition:
			color 0.15s,
			background-color 0.15s;
	}

	.d-rail-item.active {
		color: var(--color-text);
	}

	.d-rail-item.active :global(svg) {
		color: var(--color-primary);
	}

	.d-rail-item.pressed {
		background: var(--hover);
	}

	.d-notch {
		position: absolute;
		top: -7px;
		right: 0;
		border-style: solid;
		border-width: 7px 7px 7px 0;
		border-color: transparent var(--color-border) transparent transparent;
		transition: transform 0.28s cubic-bezier(0.2, 0.7, 0.2, 1);
	}

	.d-sync {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		margin: 6px 6px 0;
		padding-top: 7px;
		border-top: 1px solid var(--color-border);
		color: var(--color-text-secondary);
		font-size: 9px;
	}

	.d-sync i {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--color-text-secondary);
	}

	.d-main {
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.cursor {
		position: absolute;
		top: 0;
		left: 0;
		z-index: 5;
		margin: -2px 0 0 -3px;
		opacity: 0;
		pointer-events: none;
		filter: drop-shadow(0 1px 2px rgb(0 0 0 / 0.25));
		transition: opacity 0.25s;
	}

	.cursor.shown {
		opacity: 1;
	}

	.cursor path {
		transform-origin: 5px 3px;
		transition: transform 0.1s;
	}

	.cursor.down path {
		transform: scale(0.84);
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 14px;
		margin-top: 14px;
	}

	.note {
		flex: 1;
		min-width: 0;
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.pause {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		color: var(--color-text);
		cursor: pointer;
		transition: background-color 0.15s;
	}

	.pause:hover {
		background: var(--hover);
	}

	@media (max-width: 760px) {
		.window {
			grid-template-columns: 50px minmax(0, 1fr);
			height: 440px;
		}

		.d-rail-item {
			margin: 0 3px;
			font-size: 8.5px;
		}

		.d-rail-bottom {
			display: none;
		}

		.controls {
			flex-wrap: wrap;
		}

		.note {
			order: 3;
			flex-basis: 100%;
		}

		.pause {
			margin-left: auto;
		}
	}
</style>
