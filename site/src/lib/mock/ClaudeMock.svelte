<!-- デスクトップ版の Claude Code パネルで、編集案を差分として確かめる場面 -->
<div class="panel" aria-hidden="true">
	<p class="q">祖母の台詞、もう少し間を置きたい</p>
	<p class="a">
		読点の位置を「もう」の後ろへ移すと、言い淀む間が生まれます。次のように直す案です。
	</p>
	<div class="edit">
		<p class="edit-head"><span>第一章 / 二</span><span class="tag">未反映</span></p>
		<p class="diff">
			「この町へは<del>、</del>もう<ins>、</ins>行けないのよ」
		</p>
		<div class="actions">
			<span class="b secondary">却下</span>
			<span class="b primary">反映</span>
		</div>
	</div>
</div>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 16px;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: var(--color-background);
		box-shadow: var(--shadow-float);
		font-size: 12.5px;
		line-height: 1.7;
		user-select: none;
	}

	.q {
		align-self: flex-end;
		max-width: 85%;
		padding: 8px 12px;
		border-radius: 10px;
		background: var(--color-surface);
	}

	.a {
		color: var(--color-text);
	}

	.edit {
		border: 1px solid var(--color-border);
		border-radius: 10px;
		background: var(--editor-background);
		overflow: hidden;
	}

	.edit-head {
		display: flex;
		justify-content: space-between;
		padding: 8px 12px;
		border-bottom: 1px solid var(--color-border);
		font-size: 11.5px;
		color: var(--color-text-secondary);
	}

	.tag {
		color: var(--color-accent);
	}

	.diff {
		padding: 12px;
		font-family: var(--font-serif);
		font-size: 14px;
	}

	del {
		color: var(--color-accent);
		background: color-mix(in srgb, var(--color-accent) 12%, transparent);
	}

	ins {
		text-decoration: none;
		color: var(--color-success);
		background: color-mix(in srgb, var(--color-success) 14%, transparent);
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 0 12px 12px;
	}

	.b {
		display: inline-flex;
		align-items: center;
		height: 28px;
		padding: 0 12px;
		border: 1px solid transparent;
		border-radius: 8px;
		font-size: 12px;
	}

	.b.primary {
		background: var(--color-primary);
		color: var(--color-background);
	}

	.b.secondary {
		border-color: var(--color-border);
	}
</style>
