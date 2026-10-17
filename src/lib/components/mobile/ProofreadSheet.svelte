<script lang="ts">
	import Sheet from './Sheet.svelte';
	import { confirmDialog, toast } from '$lib/stores/toast.svelte';
	import {
		proofread,
		getProofreadingSummary,
		applyProofreadingSuggestion,
		applyAllSuggestions,
		type ProofreadingIssue
	} from '$lib/utils/proofreading';

	interface Props {
		open?: boolean;
		/** 校正する本文 */
		text: string;
		/** 修正を適用した本文を受け取る */
		onChange: (text: string) => void;
		/** 指摘箇所へ移動する */
		onJump: (start: number, end: number) => void;
	}

	let { open = $bindable(false), text, onChange, onJump }: Props = $props();

	let issues = $derived(open ? proofread(text) : []);
	let summary = $derived(getProofreadingSummary(issues));
	let fixable = $derived(issues.filter((i) => i.suggestion).length);

	const severityLabels: Record<ProofreadingIssue['severity'], string> = {
		error: '誤り',
		warning: '要確認',
		info: '提案'
	};

	/** 指摘箇所の前後を少し含めた抜粋 */
	function excerpt(issue: ProofreadingIssue): { before: string; hit: string; after: string } {
		const { start, end } = issue.position;
		const hit = text.slice(start, Math.min(end, start + 40));
		return {
			before: text.slice(Math.max(0, start - 12), start).replace(/\n/g, ' '),
			hit: hit.replace(/\n/g, ' '),
			after: text.slice(end, end + 12).replace(/\n/g, ' ')
		};
	}

	function applyOne(issue: ProofreadingIssue) {
		onChange(applyProofreadingSuggestion(text, issue));
	}

	async function applyAll() {
		const ok = await confirmDialog({
			title: '修正候補をすべて適用',
			message: `${fixable}件の修正候補を本文に適用します。内容は適用前に確認してください。`,
			confirmText: '適用する'
		});
		if (!ok) return;
		onChange(applyAllSuggestions(text, issues));
		toast.success(`${fixable}件を修正しました`);
	}

	function jump(issue: ProofreadingIssue) {
		open = false;
		// シートが閉じてからエディタを操作する
		setTimeout(() => onJump(issue.position.start, issue.position.end), 80);
	}
</script>

<Sheet bind:open title="校正" size="full">
	<div class="proof">
		{#if issues.length === 0}
			<p class="clean">指摘はありません</p>
			<p class="note">誤字・表記ゆれ・長すぎる文などを簡易的にチェックしています。</p>
		{:else}
			<div class="summary">
				<span>{summary.total}件</span>
				{#if summary.bySeverity.warning}<span class="warn">要確認 {summary.bySeverity.warning}</span
					>{/if}
				{#if summary.bySeverity.info}<span>提案 {summary.bySeverity.info}</span>{/if}
				{#if fixable > 0}
					<button class="apply-all" onclick={applyAll}>修正候補をすべて適用 ({fixable})</button>
				{/if}
			</div>

			<ul class="issues">
				{#each issues as issue, i (issue.position.start + ':' + issue.message + ':' + i)}
					{@const ex = excerpt(issue)}
					<li class="issue">
						<button class="jump" onclick={() => jump(issue)}>
							<span class="head">
								<span class="badge {issue.severity}">{severityLabels[issue.severity]}</span>
								<span class="message">{issue.message}</span>
							</span>
							<span class="context">
								{ex.before}<mark>{ex.hit}</mark>{ex.after}
							</span>
						</button>
						{#if issue.suggestion}
							<button class="fix" onclick={() => applyOne(issue)}>
								「{issue.suggestion}」に直す
							</button>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</Sheet>

<style>
	.proof {
		padding: 0 16px 24px;
	}

	.clean {
		margin: 32px 0 8px;
		text-align: center;
		font-size: 16px;
		font-weight: 600;
	}

	.note {
		margin: 0;
		text-align: center;
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.summary {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px 12px;
		margin-bottom: 8px;
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.summary .warn {
		color: var(--color-warning);
	}

	.apply-all {
		margin-left: auto;
		height: 32px;
		padding: 0 12px;
		border: 1px solid var(--color-border);
		border-radius: 8px;
		background: var(--color-background);
		color: var(--color-primary);
		font-size: 13px;
		cursor: pointer;
	}

	.issues {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.issue {
		border-bottom: 1px solid var(--color-border);
		padding: 4px 0 10px;
	}

	.jump {
		display: flex;
		flex-direction: column;
		gap: 4px;
		width: 100%;
		padding: 8px 0 4px;
		border: none;
		background: transparent;
		color: var(--color-text);
		text-align: left;
		cursor: pointer;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.badge {
		flex: none;
		padding: 1px 8px;
		border-radius: 999px;
		font-size: 11px;
		background: var(--color-surface);
		color: var(--color-text-secondary);
	}

	.badge.warning {
		background: color-mix(in srgb, var(--color-warning) 18%, transparent);
		color: var(--color-warning);
	}

	.badge.error {
		background: color-mix(in srgb, var(--color-error) 18%, transparent);
		color: var(--color-error);
	}

	.message {
		font-size: 14px;
	}

	.context {
		font-size: 13px;
		line-height: 1.7;
		color: var(--color-text-secondary);
		overflow-wrap: anywhere;
	}

	.context mark {
		background: color-mix(in srgb, var(--color-warning) 28%, transparent);
		color: var(--color-text);
		border-radius: 3px;
	}

	.fix {
		height: 32px;
		padding: 0 12px;
		border: none;
		border-radius: 8px;
		background: color-mix(in srgb, var(--color-primary) 14%, var(--color-background));
		color: var(--color-primary);
		font-size: 13px;
		cursor: pointer;
	}
</style>
