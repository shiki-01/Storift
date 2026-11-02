<script lang="ts">
	let { shown }: { shown: number } = $props();

	const stats = [
		{ label: '累計文字数', value: 35640, unit: '文字' },
		{ label: '平均執筆量', value: 1114, unit: '文字/日' },
		{ label: '最高記録', value: 1760, unit: '文字/日' },
		{ label: '連続執筆', value: 12, unit: '日間' },
		{ label: '目標達成率', value: 62, unit: '%', accent: true }
	];

	// 見本の記録(0 は書かなかった日)
	const days = [
		820, 1240, 0, 640, 1560, 980, 1320, 0, 410, 1120, 1760, 900, 0, 1280, 700, 1480, 1050, 0, 920,
		1640, 1200, 0, 880, 1340, 1020, 610, 1490, 0
	];
	const max = Math.max(...days);
</script>

<div class="page">
	<header>
		<div>
			<h3>進捗管理</h3>
			<p>執筆の進捗を記録・可視化します</p>
		</div>
		<span class="log">今日の記録</span>
	</header>

	<div class="stats">
		{#each stats as s (s.label)}
			<div class="stat">
				<p class="s-label">{s.label}</p>
				<p class="s-value" class:accent={s.accent}>
					{Math.round(s.value * shown).toLocaleString()}{s.unit === '%' ? '%' : ''}
				</p>
				<p class="s-unit">{s.unit === '%' ? '達成' : s.unit}</p>
			</div>
		{/each}
	</div>

	<div class="calendar">
		<p class="month">今月の記録</p>
		<div class="grid">
			{#each days as d, i (i)}
				<span
					class="day"
					style:--level={Math.min(d / max, shown * 1.6 - i / days.length)}
					class:empty={d === 0}
				>
					{i + 1}
				</span>
			{/each}
		</div>
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

	.log {
		padding: 6px 12px;
		border-radius: 8px;
		background: var(--color-primary);
		color: var(--color-background);
		font-size: 11.5px;
		white-space: nowrap;
	}

	.stats {
		flex: none;
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		gap: 10px;
		padding: 16px 20px 0;
	}

	.stat {
		padding: 12px 6px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
		text-align: center;
	}

	.s-label,
	.s-unit {
		font-size: 10.5px;
		color: var(--color-text-secondary);
	}

	.s-value {
		font-size: 21px;
		font-weight: 600;
		line-height: 1.4;
		font-variant-numeric: tabular-nums;
	}

	.s-value.accent {
		color: var(--color-primary);
	}

	.calendar {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		margin: 12px 20px 18px;
		padding: 12px 14px;
		border: 1px solid var(--color-border);
		border-radius: 10px;
	}

	.month {
		margin-bottom: 8px;
		font-weight: 600;
	}

	.grid {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		grid-auto-rows: minmax(0, 1fr);
		gap: 4px;
	}

	.day {
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--color-border);
		border-radius: 6px;
		background: color-mix(
			in srgb,
			var(--color-primary) calc(max(var(--level), 0) * 55%),
			var(--color-surface)
		);
		font-size: 10px;
		color: var(--color-text-secondary);
	}

	.day.empty {
		background: var(--color-surface);
	}

	@media (max-width: 760px) {
		header {
			padding: 10px 12px;
		}

		.log {
			display: none;
		}

		.stats {
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 6px;
			padding: 10px 10px 0;
		}

		.stat {
			padding: 6px 2px;
		}

		.stat:nth-child(n + 4) {
			display: none;
		}

		.s-value {
			font-size: 16px;
		}

		.calendar {
			margin: 8px 10px 10px;
			padding: 8px;
		}
	}
</style>
