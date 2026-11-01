<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { fly } from 'svelte/transition';
	import { goto } from '$app/navigation';
	import Button from '$lib/components/ui/Button.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { projectsStore } from '$lib/stores/projects.svelte';
	import { viewport } from '$lib/stores/viewport.svelte';
	import { createSampleProject } from '$lib/tutorial/sample';
	import { tourStore } from '$lib/tutorial/tour.svelte';
	import { blockerRects, cutoutRect, placeCard, type Rect } from '$lib/tutorial/tourGeometry';

	/** 強調枠の余白(px) */
	const SPOT_PADDING = 6;
	/** target が現れるまで待つ時間(ms) */
	const TARGET_TIMEOUT_MS = 5000;
	/** advance: 'click' で、クリック後に次へ進むまでの待ち時間(ms) */
	const ADVANCE_DELAY_MS = 300;
	const CARD_WIDTH = 320;
	const CARD_MARGIN = 12;
	const CARD_GAP = 14;

	const reduceMotion =
		typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	/** 強調中の要素。DOM から消えたら探し直す */
	let targetEl = $state<HTMLElement | null>(null);
	/** 強調中の要素の画面上の矩形(余白なし)。要素が無いときは null */
	let rect = $state<Rect | null>(null);
	let vw = $state(0);
	let vh = $state(0);
	let cardHeight = $state(0);
	let cardEl = $state<HTMLElement | null>(null);
	let busy = $state(false);
	/** ステップの切り替えごとに増やす。古い非同期処理を無効にするために使う */
	let runId = 0;

	const step = $derived(tourStore.current);
	const total = $derived(tourStore.steps.length);
	const isFirst = $derived(tourStore.index === 0);
	const isLast = $derived(tourStore.index >= total - 1);
	const isMobile = $derived(viewport.isMobile);

	const hole = $derived(
		rect
			? cutoutRect(rect, SPOT_PADDING, { width: vw, height: vh })
			: { x: 0, y: 0, width: 0, height: 0 }
	);
	const hasHole = $derived(hole.width > 0 && hole.height > 0);
	const blockers = $derived(
		hasHole
			? blockerRects(hole, { width: vw, height: vh })
			: [{ x: 0, y: 0, width: vw, height: vh }]
	);
	const cardPos = $derived(
		placeCard(
			hasHole ? hole : null,
			{ width: CARD_WIDTH, height: cardHeight },
			{ width: vw, height: vh },
			step?.placement ?? 'auto',
			CARD_MARGIN,
			CARD_GAP
		)
	);
	/** スマホ: 強調が画面の下半分にあるときはカードを上に出す */
	const mobileAtTop = $derived(hasHole && hole.y + hole.height > vh / 2);
	/** クリックで進むステップで、強調要素があるあいだは「次へ」を出さない */
	const waitingForClick = $derived(step?.advance === 'click' && targetEl !== null);
	const canAdvanceByButton = $derived(!waitingForClick);

	function findVisibleElement(selector: string): HTMLElement | null {
		for (const el of document.querySelectorAll<HTMLElement>(selector)) {
			const box = el.getBoundingClientRect();
			if (box.width > 0 && box.height > 0 && getComputedStyle(el).visibility !== 'hidden') {
				return el;
			}
		}
		return null;
	}

	function readRect(el: HTMLElement): Rect {
		const box = el.getBoundingClientRect();
		return { x: box.x, y: box.y, width: box.width, height: box.height };
	}

	function sameRect(a: Rect, b: Rect): boolean {
		return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
	}

	/** 表示済みの要素を待つ。見つからないまま timeout したら null */
	function findTarget(selector: string, id: number): Promise<HTMLElement | null> {
		return new Promise((resolve) => {
			let done = false;
			let frame = 0;

			const finish = (el: HTMLElement | null) => {
				if (done) return;
				done = true;
				cancelAnimationFrame(frame);
				clearTimeout(timer);
				observer.disconnect();
				resolve(el);
			};
			const check = () => {
				if (done) return;
				if (id !== runId) return finish(null);
				const el = findVisibleElement(selector);
				if (el) finish(el);
			};
			const tickFrame = () => {
				check();
				if (!done) frame = requestAnimationFrame(tickFrame);
			};

			// DOM の変化で即座に確認し、念のため毎フレームも確認する
			const observer = new MutationObserver(check);
			observer.observe(document.body, { childList: true, subtree: true, attributes: true });
			const timer = setTimeout(() => finish(null), TARGET_TIMEOUT_MS);
			tickFrame();
		});
	}

	/** 要素が見つからないステップを、移動の向きに合わせて飛ばす */
	function skipStep() {
		const next = tourStore.index + (tourStore.direction === 'backward' ? -1 : 1);
		// 範囲外なら goTo は無視されるので、中央のカードだけを表示したままになる
		tourStore.goTo(next);
	}

	function clearTarget() {
		targetEl = null;
		rect = null;
	}

	async function enterStep(index: number, id: number) {
		const current = tourStore.steps[index];
		if (!current) return;

		// 既に目的の状態なら、押させずに次へ送る(押すと逆の操作になるため)
		if (current.skipWhen?.()) {
			skipStep();
			return;
		}

		if (current.route) {
			const href = current.route({ projectId: tourStore.projectId });
			if (window.location.pathname !== href) {
				try {
					// eslint-disable-next-line svelte/no-navigation-without-resolve -- 経路はステップ定義で決めた内部パス
					await goto(href);
				} catch (error) {
					console.error('Failed to navigate for tour:', error);
				}
				if (id !== runId) return;
			}
		}

		current.prepare?.();

		if (!current.target) return;

		const el = await findTarget(current.target, id);
		if (id !== runId) return;

		if (!el) {
			if (current.optional) skipStep();
			return;
		}

		el.scrollIntoView({ block: 'center', inline: 'nearest' });
		targetEl = el;
		rect = readRect(el);
	}

	// ステップが変わったら、移動してから要素を探す。ツアーが止まったら探索を打ち切る
	$effect(() => {
		const index = tourStore.index;
		const isActive = tourStore.active;
		untrack(() => {
			const id = ++runId;
			clearTarget();
			if (!isActive) return;
			void enterStep(index, id);
			// カードへフォーカスを移す(表示のたびに行う)
			void tick().then(() => cardEl?.focus({ preventScroll: true }));
		});
	});

	// 強調中の要素の位置を毎フレーム追従する(スクロール・リサイズ・パネル開閉)
	$effect(() => {
		if (!tourStore.active) return;
		let alive = true;
		let frame = 0;
		const tickFrame = () => {
			if (!alive) return;
			vw = window.innerWidth;
			vh = window.innerHeight;

			let current = targetEl;
			if (current && !current.isConnected) {
				const selector = tourStore.current?.target;
				current = selector ? findVisibleElement(selector) : null;
				targetEl = current;
			}
			if (current) {
				const next = readRect(current);
				if (!rect || !sameRect(rect, next)) rect = next;
			} else if (rect) {
				rect = null;
			}
			frame = requestAnimationFrame(tickFrame);
		};
		untrack(tickFrame);
		return () => {
			alive = false;
			cancelAnimationFrame(frame);
		};
	});

	// advance: 'click' のステップでは、強調要素のクリックを capture で監視して次へ進む
	$effect(() => {
		const el = targetEl;
		if (!el || tourStore.current?.advance !== 'click') return;
		const index = tourStore.index;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const onClick = (event: MouseEvent) => {
			if (!(event.target instanceof Node) || !el.contains(event.target)) return;
			clearTimeout(timer);
			// クリックで起きる画面遷移や DOM の変化を待ってから進む
			timer = setTimeout(() => {
				if (tourStore.active && tourStore.index === index) tourStore.next();
			}, ADVANCE_DELAY_MS);
		};
		document.addEventListener('click', onClick, true);
		return () => {
			document.removeEventListener('click', onClick, true);
			clearTimeout(timer);
		};
	});

	// キーボード操作。Esc で終了、← で戻る、→ / Enter で次へ
	$effect(() => {
		if (!tourStore.active) return;
		const onKeydown = (event: KeyboardEvent) => {
			if (event.isComposing) return;
			// 前面に別のモーダルがあるときは、そちらの操作を優先する
			if (document.querySelector('[aria-modal="true"]')) return;

			if (event.key === 'Escape') {
				event.preventDefault();
				tourStore.stop();
				return;
			}
			// 入力中の文字キーや矢印キーは、執筆の操作として扱う
			if (isTypingTarget(event.target)) return;

			if (event.key === 'ArrowLeft') {
				event.preventDefault();
				tourStore.prev();
				return;
			}
			const isNextKey =
				event.key === 'ArrowRight' || (event.key === 'Enter' && !isInteractive(event.target));
			if (!isNextKey || waitingForClick) return;
			event.preventDefault();
			tourStore.next();
		};
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});

	function isTypingTarget(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		return (
			target.isContentEditable ||
			target.tagName === 'INPUT' ||
			target.tagName === 'TEXTAREA' ||
			target.tagName === 'SELECT'
		);
	}

	function isInteractive(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		return target.closest('button, a, input, textarea, select, [role="button"]') !== null;
	}

	async function createSample() {
		if (busy) return;
		busy = true;
		try {
			const { project, created } = await createSampleProject();
			if (created) {
				projectsStore.projects = [
					project,
					...projectsStore.projects.filter((p) => p.id !== project.id)
				];
				toast.success('サンプル作品を作成しました');
			}
			// 既にあった場合も、そのまま続行する
			tourStore.projectId = project.id;
			tourStore.next();
		} catch (error) {
			console.error('Failed to create sample project:', error);
			toast.error('サンプル作品の作成に失敗しました');
		} finally {
			busy = false;
		}
	}
</script>

{#if tourStore.active && step}
	<div class="tour">
		<svg class="tour-dim" aria-hidden="true" focusable="false">
			<defs>
				<mask id="tour-spotlight" x="0" y="0" width="100%" height="100%">
					<rect x="0" y="0" width="100%" height="100%" fill="#fff" />
					<rect
						class="tour-hole"
						x={hole.x}
						y={hole.y}
						width={hole.width}
						height={hole.height}
						rx="10"
						fill="#000"
						style="x: {hole.x}px; y: {hole.y}px; width: {hole.width}px; height: {hole.height}px"
					/>
				</mask>
			</defs>
			<rect class="tour-shade" x="0" y="0" width="100%" height="100%" mask="url(#tour-spotlight)" />
		</svg>

		<!-- 切り抜き以外のクリックを遮断する。切り抜き内は下の要素へポインタが届く -->
		{#each blockers as box, i (i)}
			<div
				class="tour-block"
				style="left: {box.x}px; top: {box.y}px; width: {box.width}px; height: {box.height}px"
			></div>
		{/each}

		<div
			class="tour-ring"
			class:tour-ring--on={hasHole}
			style="left: {hole.x}px; top: {hole.y}px; width: {hole.width}px; height: {hole.height}px"
		></div>

		<div
			bind:this={cardEl}
			bind:offsetHeight={cardHeight}
			class="tour-card"
			class:tour-card--mobile={isMobile}
			class:tour-card--top={isMobile && mobileAtTop}
			style={isMobile ? undefined : `transform: translate(${cardPos.x}px, ${cardPos.y}px)`}
			role="dialog"
			aria-modal="false"
			aria-labelledby="tour-card-title"
			tabindex="-1"
		>
			{#key tourStore.index}
				<div class="tour-content" in:fly={{ y: 8, duration: reduceMotion ? 0 : 220 }}>
					<div class="tour-head">
						<span class="tour-count">{tourStore.index + 1} / {total}</span>
						<button type="button" class="tour-exit" onclick={() => tourStore.stop()}>
							ツアーを終了
						</button>
					</div>
					<div class="tour-progress" aria-hidden="true">
						<span style="width: {((tourStore.index + 1) / total) * 100}%"></span>
					</div>

					<h2 id="tour-card-title" class="tour-title">{step.title}</h2>
					{#each step.body as paragraph, i (i)}
						<p class="tour-text">{paragraph}</p>
					{/each}

					{#if step.link}
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- 外部の固定 URL -->
						<a class="tour-link" href={step.link.href} target="_blank" rel="noopener">
							{step.link.label} ↗
						</a>
					{/if}

					{#if waitingForClick}
						<p class="tour-hint">ハイライトされた所を押してください</p>
					{/if}

					<div class="tour-actions">
						<Button
							variant="secondary"
							size="sm"
							onclick={() => tourStore.prev()}
							disabled={isFirst}
						>
							戻る
						</Button>
						{#if step.action === 'create-sample'}
							<Button size="sm" onclick={createSample} disabled={busy}>
								{busy ? '作成中...' : 'サンプル作品を作って始める'}
							</Button>
						{:else if canAdvanceByButton}
							<Button size="sm" onclick={() => tourStore.next()}>
								{isLast ? '完了' : '次へ'}
							</Button>
						{/if}
					</div>
				</div>
			{/key}
		</div>
	</div>
{/if}

<style>
	.tour {
		position: fixed;
		inset: 0;
		z-index: 1050;
		/* 子要素(遮断用の面とカード)だけがポインタを受け取る */
		pointer-events: none;
	}

	.tour-dim {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}

	.tour-shade {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		fill: rgb(20 20 20 / 38%);
		pointer-events: none;
	}

	.tour-hole {
		transition:
			x 0.3s ease,
			y 0.3s ease,
			width 0.3s ease,
			height 0.3s ease;
	}

	.tour-block {
		position: absolute;
		pointer-events: auto;
		transition:
			left 0.3s ease,
			top 0.3s ease,
			width 0.3s ease,
			height 0.3s ease;
	}

	.tour-ring {
		position: absolute;
		box-sizing: border-box;
		border: 2px solid var(--color-primary);
		border-radius: 10px;
		opacity: 0;
		pointer-events: none;
		transition:
			left 0.3s ease,
			top 0.3s ease,
			width 0.3s ease,
			height 0.3s ease,
			opacity 0.2s ease;
		animation: tour-pulse 1.8s ease-in-out infinite;
	}

	.tour-ring--on {
		opacity: 1;
	}

	@keyframes tour-pulse {
		0%,
		100% {
			box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-primary) 45%, transparent);
		}
		50% {
			box-shadow: 0 0 0 6px color-mix(in srgb, var(--color-primary) 0%, transparent);
		}
	}

	.tour-card {
		position: absolute;
		left: 0;
		top: 0;
		box-sizing: border-box;
		width: 320px;
		max-height: calc(100% - 24px);
		overflow-y: auto;
		padding: 16px 18px;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: var(--color-background);
		color: var(--color-text);
		box-shadow: 0 12px 32px rgb(0 0 0 / 22%);
		pointer-events: auto;
		outline: none;
		transition: transform 0.3s cubic-bezier(0.2, 0.7, 0.2, 1);
	}

	/* スマホ: 画面下部に全幅で固定。強調が下半分にあるときは上部へ */
	.tour-card--mobile {
		left: 12px;
		right: 12px;
		width: auto;
		top: auto;
		bottom: calc(var(--safe-bottom, 0px) + var(--bottom-nav-height, 0px) + 12px);
		max-height: 60%;
		transition: none;
	}

	.tour-card--mobile.tour-card--top {
		top: 12px;
		bottom: auto;
	}

	.tour-content {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.tour-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.tour-count {
		font-size: 12px;
		letter-spacing: 0.06em;
		color: var(--color-text-secondary);
	}

	.tour-exit {
		padding: 4px 6px;
		border: none;
		border-radius: 6px;
		background: transparent;
		font: inherit;
		font-size: 12px;
		color: var(--color-text-secondary);
		cursor: pointer;
	}

	.tour-exit:hover {
		background: color-mix(in srgb, var(--color-text) 6%, transparent);
		color: var(--color-text);
	}

	.tour-progress {
		height: 3px;
		border-radius: 2px;
		background: var(--color-border);
		overflow: hidden;
	}

	.tour-progress span {
		display: block;
		height: 100%;
		background: var(--color-primary);
		transition: width 0.3s ease;
	}

	.tour-title {
		margin: 2px 0 0;
		font-size: 16px;
		font-weight: 600;
		line-height: 1.4;
	}

	.tour-text {
		margin: 0;
		font-size: 14px;
		line-height: 1.75;
	}

	.tour-link {
		font-size: 13px;
		color: var(--color-primary);
	}

	.tour-hint {
		margin: 0;
		font-size: 13px;
		color: var(--color-accent);
	}

	.tour-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 4px;
	}

	@media (prefers-reduced-motion: reduce) {
		.tour-hole,
		.tour-block,
		.tour-ring,
		.tour-card,
		.tour-progress span {
			transition: none;
		}

		.tour-ring {
			animation: none;
		}
	}
</style>
