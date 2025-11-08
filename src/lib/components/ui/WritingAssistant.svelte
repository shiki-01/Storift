<script lang="ts">
	import { proofread, getProofreadingSummary, applyProofreadingSuggestion, type ProofreadingIssue } from '$lib/utils/proofreading';
	import { parseRuby, rubyToHtml, removeRuby, normalizeRuby } from '$lib/utils/ruby';
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';
	import Icon from './Icon.svelte';

	interface Props {
		text?: string;
	}

	let { text = $bindable('') }: Props = $props();

	let activeTab = $state<'proofreading' | 'ruby'>('proofreading');
	let issues = $state<ProofreadingIssue[]>([]);
	let selectedIssue = $state<ProofreadingIssue | null>(null);
	let rubyPreview = $state('');
	let showRubyPreview = $state(false);

	// 校閲を実行
	const runProofreading = () => {
		issues = proofread(text);
	}

	// 修正を適用
	function applySuggestion(issue: ProofreadingIssue) {
		if (issue.suggestion) {
			text = applyProofreadingSuggestion(text, issue);
			// 再チェック
			issues = proofread(text);
		}
	}

	// すべての修正を適用
	const applyAllSuggestions = () => {
		const suggestedIssues = issues.filter(i => i.suggestion);
		let newText = text;
		
		// 後ろから適用
		const sorted = [...suggestedIssues].sort((a, b) => b.position.start - a.position.start);
		for (const issue of sorted) {
			newText = applyProofreadingSuggestion(newText, issue);
		}
		
		text = newText;
		issues = proofread(newText);
	}

	// ルビプレビュー
	const previewRuby = () => {
		rubyPreview = rubyToHtml(text);
		showRubyPreview = true;
	}

	// ルビを削除
	const removeRubyFromText = () => {
		text = removeRuby(text);
	}

	// ルビを統一
	const normalizeRubyFormat = () => {
		text = normalizeRuby(text);
	}

	// 重要度別の色
	function getSeverityColor(severity: string): string {
		switch (severity) {
			case 'error': return 'red';
			case 'warning': return 'orange';
			case 'info': return 'blue';
			default: return 'gray';
		}
	}

	// 統計情報
	let summary = $derived(getProofreadingSummary(issues));
</script>

<div class="writing-assistant bg:white r:12 shadow:0|2|8|rgba(0,0,0,0.1) overflow:hidden">
	<!-- タブスイッチャー -->
	<div class="flex border-bottom:1|solid|gray-200">
		<button
			class="flex flex:grow gap:.5em py:12 px:24 font:14 font:semibold cursor:pointer border:none transition:all|0.2s {activeTab === 'proofreading' ? 'bg:blue-50 fg:blue-600 border-bottom:2|solid|blue-600' : 'bg:white fg:gray-600 hover:bg:gray-50'}"
			onclick={() => activeTab = 'proofreading'}
		>
			<Icon name="pencil-bolt" class="w:20px" /> 校閲
			{#if issues.length > 0}
				<span class="ml:8 px:6 py:2 bg:red-100 fg:red-600 r:full font:12">
					{issues.length}
				</span>
			{/if}
		</button>
		<button
			class="flex flex:grow gap:.5em py:12 px:24 font:14 font:semibold cursor:pointer border:none transition:all|0.2s {activeTab === 'ruby' ? 'bg:blue-50 fg:blue-600 border-bottom:2|solid|blue-600' : 'bg:white fg:gray-600 hover:bg:gray-50'}"
			onclick={() => activeTab = 'ruby'}
		>
			<Icon name="abc" class="w:20px" /> ルビ
		</button>
	</div>

	<!-- コンテンツ -->
	<div class="p:24">
		{#if activeTab === 'proofreading'}
			<div class="proofreading-panel">
				<div class="flex align-items:center justify-content:space-between mb:16">
					<h3 class="font:16 font:bold fg:gray-900">文章校閲</h3>
					<div class="flex gap:8">
						<Button class="flex flex:row gap:.5em" size="sm" variant="secondary" onclick={runProofreading}>
							<Icon name="search" /> チェック実行
                        </Button>
						{#if issues.length > 0}
							<Button class="flex flex:row gap:.5em" size="sm" variant="primary" onclick={applyAllSuggestions}>
								<Icon name="sparkles" /> すべて修正
							</Button>
						{/if}
					</div>
				</div>

				{#if issues.length === 0}
					<div class="text-align:center py:32 fg:gray-400">
						<p class="font:14">問題は見つかりませんでした</p>
						<p class="font:12 mt:8">「チェック実行」ボタンで文章を校閲できます</p>
					</div>
				{:else}
					<!-- サマリー -->
					<div class="bg:gray-50 r:8 p:12 mb:16 flex gap:16">
						<div class="text-align:center">
							<div class="font:20 font:bold fg:gray-900">{summary.total}</div>
							<div class="font:12 fg:gray-600">合計</div>
						</div>
						<div class="text-align:center">
							<div class="font:20 font:bold fg:red-600">{summary.bySeverity.error || 0}</div>
							<div class="font:12 fg:gray-600">エラー</div>
						</div>
						<div class="text-align:center">
							<div class="font:20 font:bold fg:orange-600">{summary.bySeverity.warning || 0}</div>
							<div class="font:12 fg:gray-600">警告</div>
						</div>
						<div class="text-align:center">
							<div class="font:20 font:bold fg:blue-600">{summary.bySeverity.info || 0}</div>
							<div class="font:12 fg:gray-600">情報</div>
						</div>
					</div>

					<!-- 問題リスト-->
					<div class="space-y:8 max-h:400 overflow-y:auto">
						{#each issues as issue}
							<button
								type="button"
								class="w:full border:1|solid|gray-200 r:8 p:12 hover:bg:gray-50 transition:all|0.2s cursor:pointer text-align:left"
								onclick={() => selectedIssue = issue}
							>
								<div class="flex align-items:start gap:12">
									<div class="w:4 h:4 r:full bg:{getSeverityColor(issue.severity)}-500 mt:4"></div>
									<div class="flex-grow">
										<div class="font:14 fg:gray-900 mb:4">{issue.message}</div>
										<div class="font:12 fg:gray-600 mb:8">
											<code class="bg:gray-100 px:6 py:2 r:4">{issue.original}</code>
											{#if issue.suggestion}
												→ <code class="bg:green-100 px:6 py:2 r:4">{issue.suggestion}</code>
											{/if}
										</div>
										{#if issue.suggestion}
											<Button size="sm" variant="secondary" onclick={() => applySuggestion(issue)}>
												修正を適用
											</Button>
										{/if}
									</div>
								</div>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{:else}
			<div class="ruby-panel">
				<div class="flex align-items:center justify-content:space-between mb:16">
					<h3 class="font:16 font:bold fg:gray-900">ルビ（ふりがな）</h3>
				</div>

				<div class="space-y:12">
					<div>
						<h4 class="font:14 font:semibold fg:gray-700 mb:8">対応記法</h4>
						<div class="bg:gray-50 r:8 p:12 font:12 fg:gray-600">
							<p class="mb:4">• 漢字《かんじ》</p>
							<p class="mb:4">• 漢字（かんじ）</p>
							<p class="mb:4">• 漢字[かんじ]</p>
							<p>• |漢字《かんじ》</p>
						</div>
					</div>

					<div class="flex gap:8 flex-wrap">
						<Button class="flex flex:row gap:.5em" size="sm" variant="secondary" onclick={previewRuby}>
							<Icon name="eye" /> プレビュー
						</Button>
						<Button class="flex flex:row gap:.5em" size="sm" variant="secondary" onclick={normalizeRubyFormat}>
							<Icon name="tool" /> 表記統一
						</Button>
						<Button class="flex flex:row gap:.5em" size="sm" variant="secondary" onclick={removeRubyFromText}>
							<Icon name="trash" /> ルビ削除
						</Button>
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>

<!-- ルビプレビューモーダル -->
{#if showRubyPreview}
	<Modal title="ルビプレビュー" onClose={() => showRubyPreview = false}>
		<div class="ruby-preview p:24" style="writing-mode: vertical-rl; text-orientation: upright; line-height: 2;">
			{@html rubyPreview}
		</div>
	</Modal>
{/if}

<style>
	.writing-assistant {
		min-width: 300px;
		max-width: 500px;
	}

	.ruby-preview {
		min-height: 300px;
		font-size: 18px;
		background: #f9fafb;
		border-radius: 8px;
	}

	.ruby-preview :global(ruby) {
		ruby-position: over;
	}

	.ruby-preview :global(rt) {
		font-size: 0.6em;
	}
</style>

