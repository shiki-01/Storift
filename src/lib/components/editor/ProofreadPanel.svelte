<script lang="ts">
	import {
		proofread,
		getProofreadingSummary,
		applyProofreadingSuggestion,
		applyAllSuggestions
	} from '$lib/utils/proofreading';
	import type { ProofreadingIssue } from '$lib/utils/proofreading';
	import Button from '$lib/components/ui/Button.svelte';

	interface Props {
		/** 校正対象の本文 */
		text: string;
		/** 修正を適用した本文を受け取る */
		onApply: (newText: string) => void;
	}

	let { text, onApply }: Props = $props();

	const issues = $derived(proofread(text));
	const summary = $derived(getProofreadingSummary(issues));
	const fixable = $derived(issues.filter((i) => i.suggestion));

	const typeLabels: Record<ProofreadingIssue['type'], string> = {
		typo: '誤字',
		redundancy: '冗長',
		style: '文体',
		grammar: '文法',
		suggestion: '提案'
	};

	const severityClasses: Record<ProofreadingIssue['severity'], string> = {
		error: 'fg:theme-error',
		warning: 'fg:theme-warning',
		info: 'fg:theme-info'
	};

	// 周辺の文脈を表示する
	function contextOf(issue: ProofreadingIssue): string {
		const start = Math.max(0, issue.position.start - 10);
		const end = Math.min(text.length, issue.position.end + 10);
		return text.slice(start, end).replace(/\n/g, ' ');
	}
</script>

<div class="flex flex-direction:column gap:16">
	<div class="flex justify-content:space-between align-items:center gap:12">
		<p class="m:0 font:14 fg:theme-text-secondary" aria-live="polite">
			{#if issues.length === 0}
				指摘事項はありません
			{:else}
				{summary.total}件の指摘（修正候補あり: {fixable.length}件）
			{/if}
		</p>
		<Button
			size="sm"
			variant="secondary"
			disabled={fixable.length === 0}
			onclick={() => onApply(applyAllSuggestions(text, issues))}
		>
			修正候補をすべて適用
		</Button>
	</div>

	{#if issues.length > 0}
		<ul class="list-style:none m:0 p:0 flex flex-direction:column gap:8 max-h:50vh overflow-y:auto">
			{#each issues as issue, i (i)}
				<li class="b:1|solid|theme-border r:8 p:12 flex justify-content:space-between gap:12">
					<div class="min-w:0">
						<div class="font:12 font-weight:600 {severityClasses[issue.severity]}">
							{typeLabels[issue.type]}
						</div>
						<div class="font:14 fg:theme-text">{issue.message}</div>
						<div class="font:12 fg:theme-text-secondary mt:4 overflow-wrap:anywhere">
							…{contextOf(issue)}…
						</div>
						{#if issue.suggestion}
							<div class="font:12 fg:theme-text mt:4">
								「{issue.original}」→「{issue.suggestion}」
							</div>
						{/if}
					</div>
					{#if issue.suggestion}
						<Button
							size="sm"
							variant="secondary"
							class="white-space:nowrap align-self:flex-start"
							onclick={() => onApply(applyProofreadingSuggestion(text, issue))}
						>
							適用
						</Button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
