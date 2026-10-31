<script lang="ts">
	const plot = [
		{ act: '起', text: '雨の日、古書店で祖母の栞を見つける', done: true },
		{ act: '承', text: '栞に書かれた町を探しはじめる', done: true },
		{ act: '転', text: '町はすでに地図から消えていた', done: false },
		{ act: '結', text: '祖母が町を離れた理由を知る', done: false }
	];
</script>

<div class="board" aria-hidden="true">
	<div class="pane plot">
		<p class="pane-head">プロット</p>
		<ol>
			{#each plot as p (p.act)}
				<li class:done={p.done}>
					<span class="act">{p.act}</span>
					<span>{p.text}</span>
				</li>
			{/each}
		</ol>
	</div>

	<div class="pane map">
		<p class="pane-head">相関図</p>
		<svg viewBox="0 0 300 190" role="presentation">
			<g class="edge">
				<line x1="150" y1="52" x2="64" y2="140" />
				<line x1="150" y1="52" x2="236" y2="140" />
				<line x1="64" y1="140" x2="236" y2="140" stroke-dasharray="3 4" />
			</g>
			<g class="edge-label">
				<text x="92" y="92">孫</text>
				<text x="200" y="92">旧友</text>
				<text x="150" y="160">古書店の常連</text>
			</g>
			<g class="node">
				<rect x="104" y="34" width="92" height="36" rx="8" />
				<text x="150" y="57">朝倉 静</text>
				<rect x="18" y="122" width="92" height="36" rx="8" class="main" />
				<text x="64" y="145">朝倉 灯</text>
				<rect x="190" y="122" width="92" height="36" rx="8" />
				<text x="236" y="145">真柴</text>
			</g>
		</svg>
	</div>

	<div class="pane person">
		<p class="pane-head">人物</p>
		<p class="name">朝倉 灯<span>あさくら あかり</span></p>
		<dl>
			<dt>年齢</dt>
			<dd>十七</dd>
			<dt>性格</dt>
			<dd>人見知りだが、気になったことは調べずにいられない</dd>
		</dl>
	</div>
</div>

<style>
	.board {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
		font-size: 12.5px;
		line-height: 1.6;
		user-select: none;
	}

	.pane {
		padding: 14px 16px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--editor-background);
	}

	.pane-head {
		margin-bottom: 10px;
		font-size: 11px;
		letter-spacing: 0.08em;
		color: var(--color-text-secondary);
	}

	.plot {
		grid-row: span 2;
	}

	.plot ol {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.plot li {
		display: flex;
		gap: 10px;
		padding: 8px 10px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
	}

	.plot li.done {
		color: var(--color-text-secondary);
	}

	.act {
		flex: none;
		font-family: var(--font-serif);
		font-weight: 600;
		color: var(--color-accent);
	}

	.map svg {
		display: block;
		width: 100%;
		height: auto;
	}

	.edge line {
		stroke: color-mix(in srgb, var(--color-text) 30%, transparent);
		stroke-width: 1.2;
	}

	.edge-label text {
		fill: var(--color-text-secondary);
		font-size: 10.5px;
		text-anchor: middle;
	}

	.node rect {
		fill: var(--color-background);
		stroke: var(--color-border);
	}

	.node rect.main {
		stroke: var(--color-primary);
	}

	.node text {
		fill: var(--color-text);
		font-size: 12px;
		text-anchor: middle;
	}

	.name {
		font-family: var(--font-serif);
		font-size: 15px;
		font-weight: 600;
	}

	.name span {
		margin-left: 8px;
		font-family: var(--font-ui);
		font-size: 10.5px;
		font-weight: 400;
		color: var(--color-text-secondary);
	}

	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 4px 12px;
		margin: 10px 0 0;
	}

	dt {
		color: var(--color-text-secondary);
	}

	dd {
		margin: 0;
	}

	@media (max-width: 560px) {
		.board {
			grid-template-columns: 1fr;
		}

		.plot {
			grid-row: auto;
		}
	}
</style>
