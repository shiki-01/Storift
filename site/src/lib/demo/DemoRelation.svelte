<script lang="ts">
	let { mover, dragging }: { mover: { x: number; y: number }; dragging: boolean } = $props();

	// 座標は viewBox 上の値。mover は「瀬尾 湊」の移動量(画面上の px を、おおよそ等倍で扱う)
	let seo = $derived({ x: 150 + mover.x, y: 220 + mover.y });
	const akari = { x: 340, y: 90 };
	const shizu = { x: 540, y: 200 };
	const mashiba = { x: 360, y: 330 };

	function curve(a: { x: number; y: number }, b: { x: number; y: number }, bend = 24) {
		const mx = (a.x + b.x) / 2;
		const my = (a.y + b.y) / 2 - bend;
		return `M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`;
	}

	let edges = $derived([
		{
			d: curve(akari, seo),
			label: '同級生',
			x: (akari.x + seo.x) / 2,
			y: (akari.y + seo.y) / 2 - 12
		},
		{ d: curve(akari, shizu), label: '孫', x: 440, y: 133 },
		{ d: curve(akari, mashiba, 0), label: '常連', x: 350, y: 210 },
		{ d: curve(shizu, mashiba, -20), label: '旧友', x: 450, y: 275 }
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
			{#each edges as e (e.label)}
				<path d={e.d} class="edge" />
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
