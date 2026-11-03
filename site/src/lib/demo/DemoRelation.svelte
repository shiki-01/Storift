<script lang="ts">
	let { mover, dragging }: { mover: { x: number; y: number }; dragging: boolean } = $props();

	// 座標は viewBox 上の値。mover は「瀬尾 湊」の移動量(画面上の px を、おおよそ等倍で扱う)
	let seo = $derived({ x: 150 + mover.x, y: 220 + mover.y });
	const akari = { x: 340, y: 90 };
	const shizu = { x: 540, y: 200 };
	const mashiba = { x: 360, y: 330 };

	type P = { x: number; y: number };
	/** 線の端を、ノードの円(半径 24)の少し外で止める */
	const R = 28;
	/** お互い別の 2 本を並べるときの、始点・終点のずれ */
	const LANE = 8;

	// 矢印の種類は、アプリの相関図と同じ。single=片方向 / both=双方向 / separate=お互い別(2 本)
	function arrow(a: P, b: P, o: { bend?: number; lane?: number } = {}) {
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const len = Math.hypot(dx, dy) || 1;
		const ux = dx / len;
		const uy = dy / len;
		const nx = -uy;
		const ny = ux;
		const lane = (o.lane ?? 0) * LANE;
		const s = { x: a.x + ux * R + nx * lane, y: a.y + uy * R + ny * lane };
		const t = { x: b.x - ux * R + nx * lane, y: b.y - uy * R + ny * lane };
		const bend = o.bend ?? 0;
		const mid = { x: (s.x + t.x) / 2 + nx * bend, y: (s.y + t.y) / 2 + ny * bend };
		const c = { x: 2 * mid.x - (s.x + t.x) / 2, y: 2 * mid.y - (s.y + t.y) / 2 };
		return { d: `M${s.x} ${s.y} Q${c.x} ${c.y} ${t.x} ${t.y}`, x: mid.x, y: mid.y };
	}

	let edges = $derived([
		{ ...arrow(akari, seo, { bend: 10 }), label: '同級生', both: false },
		// お互い別: 灯 → 静 と 静 → 灯 を、それぞれ相手へ向く 2 本の矢印で
		{ ...arrow(akari, shizu, { bend: 14, lane: 1 }), label: '孫', both: false },
		{ ...arrow(shizu, akari, { bend: 14, lane: 1 }), label: '祖母', both: false },
		// 双方向: 1 本の線の両端に矢印
		{ ...arrow(akari, mashiba), label: '常連', both: true },
		{ ...arrow(shizu, mashiba, { bend: -14 }), label: '旧友', both: true }
	]);

	const nodes = [
		{ ...akari, name: '朝倉 灯', role: '主人公', mark: '朝', main: true },
		{ ...shizu, name: '朝倉 静', role: '祖母', mark: '静', main: false },
		{ ...mashiba, name: '真柴 蓮', role: '店主', mark: '真', main: false }
	];
</script>

<div class="page">
	<header>
		<div>
			<h3>キャラクター管理</h3>
			<p>登場人物の情報と相関図を管理します</p>
		</div>
		<span class="tabs"><i>グリッド</i><i>リスト</i><i class="on">相関図</i></span>
	</header>

	<div class="canvas">
		<svg viewBox="0 0 680 400" preserveAspectRatio="xMidYMid meet">
			<defs>
				<marker
					id="demo-arrow"
					viewBox="0 0 10 10"
					refX="8"
					refY="5"
					markerWidth="7"
					markerHeight="7"
					orient="auto-start-reverse"
				>
					<path d="M1 1 L9 5 L1 9 z" class="head" />
				</marker>
			</defs>
			{#each edges as e (e.label)}
				<path
					d={e.d}
					class="edge"
					marker-end="url(#demo-arrow)"
					marker-start={e.both ? 'url(#demo-arrow)' : undefined}
				/>
				<text x={e.x} y={e.y} class="edge-label">{e.label}</text>
			{/each}
			{#each nodes as n (n.name)}
				<g transform="translate({n.x} {n.y})">
					<circle r="24" class="node" class:main={n.main} />
					<text class="mark" y="6">{n.mark}</text>
					<text class="name" y="42">{n.name}</text>
					<text class="role" y="57">{n.role}</text>
				</g>
			{/each}
			<g transform="translate({seo.x} {seo.y})" class:dragging>
				<circle r="24" class="node" />
				<text class="mark" y="6">瀬</text>
				<text class="name" y="42">瀬尾 湊</text>
				<text class="role" y="57">同級生</text>
				<circle r="24" fill="transparent" data-t="node-mover" />
			</g>
		</svg>
	</div>
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}

	header {
		flex: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 20px;
		border-bottom: 1px solid var(--color-border);
	}

	h3 {
		font-size: 17px;
		line-height: 1.3;
	}

	header p {
		font-size: 11px;
		color: var(--color-text-secondary);
	}

	.tabs {
		display: inline-flex;
		gap: 2px;
		padding: 3px;
		border-radius: 8px;
		background: var(--color-surface);
		font-size: 11px;
		color: var(--color-text-secondary);
		white-space: nowrap;
	}

	.tabs i {
		padding: 3px 9px;
		border-radius: 6px;
		font-style: normal;
	}

	.tabs i.on {
		background: var(--color-background);
		color: var(--color-text);
	}

	.canvas {
		flex: 1;
		min-height: 0;
		margin: 14px 20px 18px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background-color: var(--editor-background);
		background-image: radial-gradient(
			color-mix(in srgb, var(--color-text) 14%, transparent) 1px,
			transparent 1px
		);
		background-size: 18px 18px;
	}

	svg {
		display: block;
		width: 100%;
		height: 100%;
	}

	.edge {
		fill: none;
		stroke: color-mix(in srgb, var(--color-text) 40%, transparent);
		stroke-width: 1.3;
	}

	.head {
		fill: color-mix(in srgb, var(--color-text) 55%, transparent);
	}

	.edge-label {
		fill: var(--color-text-secondary);
		paint-order: stroke;
		stroke: var(--editor-background);
		stroke-width: 4px;
		font-size: 11px;
		text-anchor: middle;
	}

	.node {
		fill: var(--color-surface);
		stroke: var(--color-border);
	}

	.node.main {
		stroke: var(--color-primary);
		stroke-width: 1.5;
	}

	.dragging .node {
		stroke: var(--color-primary);
		stroke-width: 1.5;
	}

	.mark {
		fill: var(--color-text);
		font-size: 15px;
		text-anchor: middle;
	}

	.name {
		fill: var(--color-text);
		font-size: 12.5px;
		font-weight: 600;
		text-anchor: middle;
	}

	.role {
		fill: var(--color-text-secondary);
		font-size: 10.5px;
		text-anchor: middle;
	}

	@media (max-width: 760px) {
		header {
			padding: 10px 12px;
		}

		header p {
			display: none;
		}

		.canvas {
			margin: 8px;
		}
	}
</style>
