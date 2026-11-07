<script lang="ts" module>
	import type { Snippet } from 'svelte';

	export interface ItemContext {
		index: number;
		count: number;
		/** ハンドル(inlineHandle=false のとき、項目の中の好きな位置に置く) */
		handle: Snippet;
		moveUp: () => void;
		moveDown: () => void;
		canMoveUp: boolean;
		canMoveDown: boolean;
		/** ポインタでドラッグ中 */
		dragging: boolean;
		/** キーボードで持ち上げ中 */
		lifted: boolean;
	}

	/** 同じ group の一覧どうしで、項目を行き来できる(プロットの状態の列など) */
	interface ListApi {
		key: string;
		hit(): DOMRect | undefined;
		container(): HTMLElement | undefined;
		rows(): HTMLElement[];
		gap(): number;
		show(y: number | null): void;
	}

	// 描画には使わない登録簿(リアクティブにする必要がない)
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const groups = new Map<string, Set<ListApi>>();

	/** ドラッグ中だけ、画面全体で文字の選択とカーソルを固定する */
	const DRAGGING_CLASS = 'sortable-dragging';
</script>

<script lang="ts" generics="T extends { id: string }">
	/**
	 * 縦並びの並べ替えできる一覧。データは書き換えず、onmove(id, toIndex, listKey) を呼ぶだけ(書き込みは親が行う)。
	 *
	 * 操作
	 * - ポインタ(マウス・タッチ・ペン): ハンドルをドラッグ。ドラッグ中は項目が浮き、挿入位置に線が出る。
	 *   スクロールコンテナの端に近づくと自動でスクロールする。Escape で取り消し。
	 * - キーボード / スクリーンリーダー: ハンドルにフォーカスして Space で持ち上げ、↑↓(Home/End)で移動、
	 *   Space で確定、Escape で取り消し。移動は aria-live で通知する。
	 * - 移動ボタン(showMoveButtons): 「上へ」「下へ」。タッチで確実に使える代替。item のコンテキストの
	 *   moveUp / moveDown を、項目のメニューなどから呼んでもよい。
	 * - disabled(閲覧専用)では、ハンドルも移動ボタンも出さず、キーボード操作も効かない。
	 *
	 * 各項目は item スニペットで描画する。ハンドルは、既定では項目の左に自動で付く(inlineHandle=false にすると
	 * コンテキストの handle を好きな位置に置く)。ドラッグ・並べ替えの対象に .selectable は付けず、
	 * 本文だけに付ける(UI_GUIDELINES.md)。
	 */
	import { tick, untrack } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import {
		autoScrollDelta,
		clampIndex,
		indicatorY,
		insertionIndex,
		moveAnnouncement,
		pickList,
		previewPositions
	} from './sortableLogic';

	interface Props {
		items: T[];
		item: Snippet<[T, ItemContext]>;
		/** 位置が変わったとき。toIndex は移動後の位置(0 始まり)、listKey は移動先の一覧のキー */
		onmove: (id: string, toIndex: number, listKey: string) => void;
		/** 閲覧専用など。並べ替えの操作を一切出さない */
		disabled?: boolean;
		/** 一覧の名前(スクリーンリーダー用) */
		label: string;
		/** 通知やハンドルの名前に使う項目名 */
		titleOf?: (item: T) => string;
		/** この一覧のキー(group 内で移動先の判別に使う。例: プロットの状態) */
		listKey?: string;
		/** 同じ値の一覧どうしで、項目を行き来できる */
		group?: string;
		/** 「上へ」「下へ」のボタンをハンドルの下に出す */
		showMoveButtons?: boolean;
		/** ハンドルを項目の左に自動で付けるか */
		inlineHandle?: boolean;
		class?: string;
		empty?: Snippet;
	}

	let {
		items,
		item,
		onmove,
		disabled = false,
		label,
		titleOf = (it: T) =>
			String(
				(it as { title?: string; name?: string }).title ?? (it as { name?: string }).name ?? it.id
			),
		listKey = '',
		group,
		showMoveButtons = false,
		inlineHandle = true,
		class: className = '',
		empty
	}: Props = $props();

	const uid = $props.id();
	const hintId = `${uid}-hint`;

	let wrapEl = $state<HTMLElement>();
	let listEl = $state<HTMLElement>();
	/** 挿入位置の線(一覧の上端からの距離。null なら出さない) */
	let indicator = $state<number | null>(null);
	let draggingId = $state<string | null>(null);
	let lift = $state<{ id: string; from: number; to: number } | null>(null);
	let live = $state('');
	let refocusId: string | null = null;
	let refocusTimer: ReturnType<typeof setTimeout> | undefined;

	/* ---------- 一覧の登録(group 内で行き来するため) ---------- */

	const api: ListApi = {
		get key() {
			return listKey;
		},
		hit: () => wrapEl?.getBoundingClientRect(),
		container: () => wrapEl,
		rows: () => (listEl ? [...listEl.querySelectorAll<HTMLElement>(':scope > li[data-id]')] : []),
		gap: () => (listEl ? parseFloat(getComputedStyle(listEl).rowGap) || 0 : 0),
		show: (y) => {
			if (y === null || !wrapEl) indicator = null;
			else indicator = y - wrapEl.getBoundingClientRect().top;
		}
	};

	$effect(() => {
		if (!group) return;
		let set = groups.get(group);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- 登録簿の中身。描画には使わない
		if (!set) groups.set(group, (set = new Set()));
		set.add(api);
		return () => {
			set.delete(api);
			if (set.size === 0) groups.delete(group);
		};
	});

	function peers(): ListApi[] {
		return group ? [...(groups.get(group) ?? [api])] : [api];
	}

	/* ---------- ポインタでのドラッグ ---------- */

	interface Session {
		id: string;
		from: number;
		pointerId: number;
		handle: HTMLElement;
		row: HTMLElement;
		startX: number;
		startY: number;
		active: boolean;
		ghost?: HTMLElement;
		offsetX: number;
		offsetY: number;
		x: number;
		y: number;
		target: { api: ListApi; index: number } | null;
		raf?: number;
	}
	let session: Session | null = null;

	function onHandlePointerDown(e: PointerEvent, it: T, index: number) {
		if (disabled || session) return;
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		const handle = e.currentTarget as HTMLElement;
		const row = handle.closest('li') as HTMLElement | null;
		if (!row) return;
		e.preventDefault();
		handle.focus({ preventScroll: true });
		handle.setPointerCapture(e.pointerId);
		const rect = row.getBoundingClientRect();
		session = {
			id: it.id,
			from: index,
			pointerId: e.pointerId,
			handle,
			row,
			startX: e.clientX,
			startY: e.clientY,
			active: false,
			offsetX: e.clientX - rect.left,
			offsetY: e.clientY - rect.top,
			x: e.clientX,
			y: e.clientY,
			target: null
		};
	}

	function onHandlePointerMove(e: PointerEvent) {
		const s = session;
		if (!s || e.pointerId !== s.pointerId) return;
		s.x = e.clientX;
		s.y = e.clientY;
		if (!s.active) {
			if (Math.hypot(s.x - s.startX, s.y - s.startY) < 4) return;
			startDrag(s);
		}
		updateTarget(s);
		placeGhost(s);
	}

	function startDrag(s: Session) {
		s.active = true;
		draggingId = s.id;
		const rect = s.row.getBoundingClientRect();
		const ghost = s.row.cloneNode(true) as HTMLElement;
		ghost.classList.add('sortable-ghost');
		ghost.removeAttribute('data-id');
		ghost.setAttribute('aria-hidden', 'true');
		ghost.setAttribute('inert', '');
		for (const el of ghost.querySelectorAll('[id]')) el.removeAttribute('id');
		ghost.style.width = `${rect.width}px`;
		ghost.style.height = `${rect.height}px`;
		document.body.appendChild(ghost);
		s.ghost = ghost;
		document.documentElement.classList.add(DRAGGING_CLASS);
		window.getSelection()?.removeAllRanges();
		window.addEventListener('keydown', onWindowKeydown, true);
		const tickFrame = () => {
			if (session !== s) return;
			autoScroll(s);
			s.raf = requestAnimationFrame(tickFrame);
		};
		s.raf = requestAnimationFrame(tickFrame);
	}

	function placeGhost(s: Session) {
		if (!s.ghost) return;
		s.ghost.style.transform = `translate3d(${s.x - s.offsetX}px, ${s.y - s.offsetY}px, 0)`;
	}

	/** ポインタの下の一覧と、その中の挿入位置を求めて、線を動かす */
	function updateTarget(s: Session) {
		const lists = peers();
		const boxes = lists.flatMap((l) => {
			const r = l.hit();
			return r ? [{ key: l, rect: r }] : [];
		});
		const picked = pickList(boxes, { x: s.x, y: s.y });
		for (const l of lists) if (l !== picked?.key) l.show(null);
		if (!picked) {
			s.target = null;
			return;
		}
		const l = picked.key;
		const rows = l.rows().filter((r) => r !== s.row);
		const rects = rows.map((r) => r.getBoundingClientRect());
		const index = insertionIndex(
			rects.map((r) => (r.top + r.bottom) / 2),
			s.y
		);
		const listTop = l.hit()?.top ?? 0;
		l.show(indicatorY(rects, index, l.gap(), listTop + 2));
		s.target = { api: l, index };
	}

	function scrollParents(el: HTMLElement | undefined): HTMLElement[] {
		const out: HTMLElement[] = [];
		for (let p = el?.parentElement; p; p = p.parentElement) {
			const style = getComputedStyle(p);
			const scrollY = /(auto|scroll)/.test(style.overflowY) && p.scrollHeight > p.clientHeight;
			const scrollX = /(auto|scroll)/.test(style.overflowX) && p.scrollWidth > p.clientWidth;
			if (scrollX || scrollY) out.push(p);
		}
		return out;
	}

	/** スクロールコンテナの端に近づいたら、その方向へスクロールする */
	function autoScroll(s: Session) {
		const targets = [...scrollParents(wrapEl), ...scrollParents(s.target?.api.container())].filter(
			(el, i, all) => all.indexOf(el) === i
		);
		let scrolled = false;
		for (const el of targets) {
			const r = el.getBoundingClientRect();
			if (s.x >= r.left && s.x <= r.right && el.scrollHeight > el.clientHeight) {
				const dy = autoScrollDelta(s.y, r.top, r.bottom);
				if (dy) {
					const before = el.scrollTop;
					el.scrollTop += dy;
					scrolled ||= el.scrollTop !== before;
				}
			}
			if (s.y >= r.top && s.y <= r.bottom && el.scrollWidth > el.clientWidth) {
				const dx = autoScrollDelta(s.x, r.left, r.right);
				if (dx) {
					const before = el.scrollLeft;
					el.scrollLeft += dx;
					scrolled ||= el.scrollLeft !== before;
				}
			}
		}
		if (scrolled) updateTarget(s);
	}

	function endSession(commit: boolean) {
		const s = session;
		if (!s) return;
		session = null;
		if (s.raf !== undefined) cancelAnimationFrame(s.raf);
		s.ghost?.remove();
		window.removeEventListener('keydown', onWindowKeydown, true);
		document.documentElement.classList.remove(DRAGGING_CLASS);
		try {
			s.handle.releasePointerCapture(s.pointerId);
		} catch {
			// 既に解放されている
		}
		for (const l of peers()) l.show(null);
		draggingId = null;
		const target = s.target;
		if (!commit || !s.active || !target) return;
		if (target.api === api && target.index === s.from) return;
		announceTo(
			s.id,
			target.index,
			target.api === api ? items.length : target.api.rows().length + 1
		);
		onmove(s.id, target.index, target.api.key);
	}

	function onHandlePointerUp(e: PointerEvent) {
		if (session && e.pointerId === session.pointerId) endSession(true);
	}

	function onHandlePointerCancel(e: PointerEvent) {
		if (session && e.pointerId === session.pointerId) endSession(false);
	}

	function onWindowKeydown(e: KeyboardEvent) {
		if (e.key !== 'Escape' || !session) return;
		e.preventDefault();
		e.stopPropagation();
		endSession(false);
	}

	/* ---------- キーボード ---------- */

	function announceTo(id: string, index: number, count: number) {
		const it = items.find((x) => x.id === id);
		live = moveAnnouncement(it ? titleOf(it) : '', index, count);
	}

	function onHandleKeydown(e: KeyboardEvent, it: T, index: number) {
		if (disabled || e.isComposing) return;
		const count = items.length;
		if (!lift) {
			if (e.key === ' ' || e.key === 'Enter') {
				e.preventDefault();
				lift = { id: it.id, from: index, to: index };
				live = `${titleOf(it)}を持ち上げました。現在 ${index + 1} 番目(全 ${count} 件)。上下の矢印キーで移動、スペースキーで確定、Escape キーで取り消しです`;
			}
			return;
		}
		if (lift.id !== it.id) return;
		let to = lift.to;
		switch (e.key) {
			case 'ArrowUp':
				to = clampIndex(to, -1, count);
				break;
			case 'ArrowDown':
				to = clampIndex(to, 1, count);
				break;
			case 'Home':
				to = 0;
				break;
			case 'End':
				to = count - 1;
				break;
			case ' ':
			case 'Enter': {
				e.preventDefault();
				const { id, from, to: dest } = lift;
				lift = null;
				if (dest === from) {
					live = `${titleOf(it)}は元の位置のままです`;
				} else {
					announceTo(id, dest, count);
					refocus(id);
					onmove(id, dest, listKey);
				}
				return;
			}
			case 'Escape':
				e.preventDefault();
				e.stopPropagation();
				lift = null;
				live = `${titleOf(it)}の移動を取り消しました`;
				return;
			default:
				return;
		}
		e.preventDefault();
		lift = { ...lift, to };
		announceTo(it.id, to, count);
	}

	function onHandleBlur() {
		// 持ち上げたままフォーカスが外れたら取り消す
		if (lift) {
			lift = null;
			live = '移動を取り消しました';
		}
	}

	/** 並びが入れ替わって DOM が動くとフォーカスを失うことがあるので、確定後にハンドルへ戻す */
	function refocus(id: string) {
		refocusId = id;
		clearTimeout(refocusTimer);
		refocusTimer = setTimeout(() => (refocusId = null), 1000);
	}

	$effect(() => {
		void items.map((x) => x.id).join('\n');
		const id = untrack(() => refocusId);
		if (!id) return;
		void tick().then(() => {
			const handle = listEl?.querySelector<HTMLElement>(`li[data-id="${CSS.escape(id)}"] .handle`);
			if (handle && document.activeElement !== handle) handle.focus({ preventScroll: true });
		});
	});

	/* ---------- 移動ボタン ---------- */

	function moveBy(it: T, index: number, delta: number) {
		if (disabled) return;
		const to = clampIndex(index, delta, items.length);
		if (to === index) return;
		announceTo(it.id, to, items.length);
		refocus(it.id);
		onmove(it.id, to, listKey);
	}

	const positions = $derived(
		lift
			? previewPositions(
					items.map((x) => x.id),
					lift.id,
					lift.to
				)
			: null
	);

	$effect(() => () => {
		// 破棄時にドラッグ中なら片付ける
		if (session) endSession(false);
		clearTimeout(refocusTimer);
	});
</script>

<div bind:this={wrapEl} class="sortable {className}">
	{#if !disabled}
		<p id={hintId} class="sr-only">
			並べ替え:
			ハンドルにフォーカスしてスペースキーで持ち上げ、上下の矢印キーで移動、スペースキーで確定、Escape
			キーで取り消します。
		</p>
	{/if}
	<ul bind:this={listEl} class="list" aria-label={label}>
		{#each items as it, index (it.id)}
			{@const isLifted = lift?.id === it.id}
			{#snippet handle()}
				{#if !disabled}
					<button
						type="button"
						class="handle"
						aria-label="{titleOf(it)}を並べ替え"
						aria-roledescription="並べ替えハンドル"
						aria-describedby={hintId}
						aria-pressed={isLifted}
						onpointerdown={(e) => onHandlePointerDown(e, it, index)}
						onpointermove={onHandlePointerMove}
						onpointerup={onHandlePointerUp}
						onpointercancel={onHandlePointerCancel}
						onkeydown={(e) => onHandleKeydown(e, it, index)}
						onblur={onHandleBlur}
					>
						<Icon name="grip-vertical" class="handle-icon" />
					</button>
				{/if}
			{/snippet}
			<li
				class="row"
				class:dragging={draggingId === it.id}
				class:lifted={isLifted}
				data-id={it.id}
				style:order={positions ? positions.get(it.id) : undefined}
			>
				{#if inlineHandle && !disabled}
					<div class="grip">
						{@render handle()}
						{#if showMoveButtons}
							<button
								type="button"
								class="move"
								aria-label="{titleOf(it)}を上へ"
								disabled={index === 0}
								onclick={() => moveBy(it, index, -1)}
							>
								<Icon name="arrow-up" class="move-icon" />
							</button>
							<button
								type="button"
								class="move"
								aria-label="{titleOf(it)}を下へ"
								disabled={index === items.length - 1}
								onclick={() => moveBy(it, index, 1)}
							>
								<Icon name="arrow-down" class="move-icon" />
							</button>
						{/if}
					</div>
				{/if}
				<div class="content">
					{@render item(it, {
						index,
						count: items.length,
						handle,
						moveUp: () => moveBy(it, index, -1),
						moveDown: () => moveBy(it, index, 1),
						canMoveUp: !disabled && index > 0,
						canMoveDown: !disabled && index < items.length - 1,
						dragging: draggingId === it.id,
						lifted: isLifted
					})}
				</div>
			</li>
		{/each}
	</ul>
	{#if items.length === 0 && empty}
		{@render empty()}
	{/if}
	{#if indicator !== null}
		<div class="indicator" style:top="{indicator}px" aria-hidden="true"></div>
	{/if}
	<div class="sr-only" role="status" aria-live="assertive">{live}</div>
</div>

<style>
	.sortable {
		position: relative;
		min-width: 0;
		min-height: 48px;
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: var(--sortable-gap, 10px);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.row {
		display: flex;
		align-items: flex-start;
		gap: 4px;
		min-width: 0;
	}

	.content {
		flex: 1;
		min-width: 0;
	}

	.row.dragging {
		opacity: 0.35;
	}

	.row.lifted {
		border-radius: 10px;
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
		box-shadow: var(--shadow-float);
	}

	.grip {
		display: flex;
		flex: none;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding-top: 6px;
	}

	.handle,
	.move {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		width: var(--sortable-handle-size, 28px);
		height: var(--sortable-handle-size, 28px);
		padding: 0;
		border: 0;
		border-radius: 7px;
		background: transparent;
		color: var(--color-text-secondary);
		opacity: 0.7;
		transition:
			background-color 0.15s,
			color 0.15s,
			opacity 0.15s;
	}

	.handle {
		cursor: grab;
		/* ハンドルの上ではブラウザのスクロールを始めさせない(ドラッグを優先する) */
		touch-action: none;
	}

	.handle[aria-pressed='true'] {
		background: var(--selected);
		color: var(--color-primary);
		opacity: 1;
	}

	.move {
		cursor: pointer;
	}

	.move:disabled {
		opacity: 0.25;
		cursor: default;
	}

	.row:hover .handle,
	.row:hover .move:not(:disabled),
	.handle:focus-visible,
	.move:focus-visible {
		opacity: 1;
	}

	.handle:hover,
	.move:hover:not(:disabled) {
		background: var(--hover);
		color: var(--color-text);
	}

	/* ヒットするのは常にボタン自身にする(中のアイコンの touch-action が auto だと、タッチでスクロールが始まってしまう) */
	.handle :global(*) {
		pointer-events: none;
		touch-action: none;
	}

	.handle :global(.handle-icon),
	.move :global(.move-icon) {
		display: flex;
		width: 16px;
		height: 16px;
	}

	.handle :global(svg),
	.move :global(svg) {
		width: 100%;
		height: 100%;
	}

	@media (pointer: coarse) {
		.handle,
		.move {
			width: var(--sortable-handle-size, 36px);
			height: var(--sortable-handle-size, 36px);
			opacity: 1;
		}
	}

	.indicator {
		position: absolute;
		right: 0;
		left: 0;
		z-index: 2;
		height: 3px;
		margin-top: -1.5px;
		border-radius: 2px;
		background: var(--color-primary);
		pointer-events: none;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	/* ドラッグ中に浮いて見える複製(body の直下に置く) */
	:global(.sortable-ghost) {
		position: fixed;
		top: 0;
		left: 0;
		z-index: 1400;
		margin: 0;
		border-radius: 10px;
		background: var(--color-background);
		box-shadow: var(--shadow-float);
		opacity: 0.96;
		pointer-events: none;
		will-change: transform;
		cursor: grabbing;
	}

	:global(html.sortable-dragging),
	:global(html.sortable-dragging *) {
		cursor: grabbing !important;
		-webkit-user-select: none !important;
		user-select: none !important;
	}

	@media (prefers-reduced-motion: reduce) {
		.handle,
		.move {
			transition: none;
		}
	}
</style>
