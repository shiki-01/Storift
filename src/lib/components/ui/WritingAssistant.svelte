<script lang="ts">
	import { parseRuby, rubyToHtml, removeRuby, normalizeRuby } from '$lib/utils/ruby';
	import Modal from './Modal.svelte';
	import Button from './Button.svelte';
	import Icon from './Icon.svelte';

	interface Props {
		text?: string;
	}

	let { text = $bindable('') }: Props = $props();

	let activeTab = $state<'formatting' | 'ruby'>('formatting');
	let rubyPreview = $state('');
	let showRubyPreview = $state(false);

	// 段落先頭の字下げを適用
	function applyIndentation() {
		const lines = text.split('\n');
		const indentedLines = lines.map((line) => {
			// 空行はそのまま
			if (line.trim() === '') return line;
			// すでに全角スペースまたは半角スペースで始まっている場合はスキップ
			if (line.startsWith('　') || line.startsWith(' ')) return line;
			// 記号で始まる行（会話文「」など）はスキップ
			if (/^[「『（【〈《]/.test(line)) return line;
			// その他の行は全角スペースを追加
			return '　' + line;
		});
		text = indentedLines.join('\n');
	}

	// 字下げを削除
	function removeIndentation() {
		const lines = text.split('\n');
		const unindentedLines = lines.map((line) => {
			// 行頭の全角スペースまたは半角スペースを削除
			return line.replace(/^[　 ]+/, '');
		});
		text = unindentedLines.join('\n');
	}

	// ルビプレビュー
	function previewRuby() {
		rubyPreview = rubyToHtml(text);
		showRubyPreview = true;
	}

	// ルビを削除
	function removeRubyFromText() {
		text = removeRuby(text);
	}

	// ルビを統一
	function normalizeRubyFormat() {
		text = normalizeRuby(text);
	}

	// 統計情報
	let stats = $derived({
		paragraphs: text.split('\n').filter((line) => line.trim() !== '').length,
		indentedParagraphs: text.split('\n').filter((line) => /^[　 ]/.test(line)).length
	});
</script>

<div class="flex flex-direction:column gap:24">
	<!-- タブ -->
	<div class="flex gap:4 bg:theme-background-secondary r:8 p:4">
		<button
			class="flex:1 flex align-items:center justify-content:center gap:8 p:12 r:6 font:14 font-weight:500 cursor:pointer transition:all|0.2s border:none {activeTab === 'formatting' ? 'bg:$(theme.primary) fg:white' : 'bg:transparent fg:theme-text hover:bg:theme-background'}"
			onclick={() => (activeTab = 'formatting')}
		>
			<Icon name="text-increase" class="w:18px" />
			テキスト整形
		</button>
		<button
			class="flex:1 flex align-items:center justify-content:center gap:8 p:12 r:6 font:14 font-weight:500 cursor:pointer transition:all|0.2s border:none {activeTab === 'ruby' ? 'bg:$(theme.primary) fg:white' : 'bg:transparent fg:theme-text hover:bg:theme-background'}"
			onclick={() => (activeTab = 'ruby')}
		>
			<Icon name="abc" class="w:18px" />
			ルビ
		</button>
	</div>

	{#if activeTab === 'formatting'}
		<!-- テキスト整形 -->
		<div class="flex flex-direction:column gap:20">
			<!-- 字下げ -->
			<div>
				<span class="display:block font-weight:500 m:0|0|12|0 fg:theme-text">段落の字下げ</span>
				<p class="font:13 fg:theme-text-secondary m:0|0|12|0">
					段落の先頭に全角スペースを挿入します。会話文（「」で始まる行）はスキップされます。
				</p>
				<div class="flex gap:8">
					<Button size="sm" onclick={applyIndentation}>
						<span class="flex align-items:center gap:6">
							<Icon name="indent-increase" class="w:16px" />
							字下げを適用
						</span>
					</Button>
					<Button size="sm" variant="secondary" onclick={removeIndentation}>
						<span class="flex align-items:center gap:6">
							<Icon name="indent-decrease" class="w:16px" />
							字下げを削除
						</span>
					</Button>
				</div>
			</div>

			<!-- 統計情報 -->
			<div class="b:1|solid|theme-border r:8 p:16 bg:theme-background-secondary">
				<div class="font:12 font-weight:500 mb:12 fg:theme-text-secondary">現在の状態</div>
				<div class="flex gap:24">
					<div>
						<div class="font:24 font-weight:600 fg:theme-text">{stats.paragraphs}</div>
						<div class="font:12 fg:theme-text-secondary">段落数</div>
					</div>
					<div>
						<div class="font:24 font-weight:600 fg:theme-text">{stats.indentedParagraphs}</div>
						<div class="font:12 fg:theme-text-secondary">字下げ済み</div>
					</div>
				</div>
			</div>
		</div>
	{:else}
		<!-- ルビ -->
		<div class="flex flex-direction:column gap:20">
			<!-- 対応記法 -->
			<div>
				<span class="display:block font-weight:500 m:0|0|12|0 fg:theme-text">対応記法</span>
				<div class="b:1|solid|theme-border r:8 p:16 bg:theme-background-secondary font:13 fg:theme-text-secondary">
					<p class="m:0|0|8|0"><code class="bg:theme-background px:6 py:2 r:4">｜親文字《ルビ》</code> — 任意の文字列にルビ</p>
					<p class="m:0|0|8|0"><code class="bg:theme-background px:6 py:2 r:4">漢字《かんじ》</code> — 漢字のみにルビ</p>
					<p class="m:0"><code class="bg:theme-background px:6 py:2 r:4">《《傍点》》</code> — 傍点を付ける</p>
				</div>
			</div>

			<!-- ルビ操作 -->
			<div>
				<span class="display:block font-weight:500 m:0|0|12|0 fg:theme-text">ルビ操作</span>
				<div class="flex gap:8 flex-wrap">
					<Button size="sm" onclick={previewRuby}>
						<span class="flex align-items:center gap:6">
							<Icon name="eye" class="w:16px" />
							プレビュー
						</span>
					</Button>
					<Button size="sm" variant="secondary" onclick={normalizeRubyFormat}>
						<span class="flex align-items:center gap:6">
							<Icon name="tool" class="w:16px" />
							表記統一
						</span>
					</Button>
					<Button size="sm" variant="secondary" onclick={removeRubyFromText}>
						<span class="flex align-items:center gap:6">
							<Icon name="trash" class="w:16px" />
							ルビ削除
						</span>
					</Button>
				</div>
			</div>

			<!-- 使い方のヒント -->
			<div class="b:1|solid|theme-border r:8 p:16 bg:theme-background-secondary">
				<div class="font:12 font-weight:500 mb:8 fg:theme-text-secondary">使い方のヒント</div>
				<p class="font:13 fg:theme-text-secondary m:0">
					例：<code class="bg:theme-background px:6 py:2 r:4">｜紅蓮の炎《ヘルフレイム》</code>と入力すると、プレビューでルビが表示されます。
				</p>
			</div>
		</div>
	{/if}
</div>

<!-- ルビプレビューモーダル -->
{#if showRubyPreview}
	<Modal title="ルビプレビュー" onClose={() => (showRubyPreview = false)}>
		<div
			class="ruby-preview p:24"
			style="writing-mode: vertical-rl; text-orientation: mixed; line-height: 2;"
		>
			{@html rubyPreview}
		</div>
	</Modal>
{/if}

<style>
	.ruby-preview {
		min-height: 300px;
		font-size: 18px;
		background: var(--color-background-secondary, #f9fafb);
		border-radius: 8px;
	}

	.ruby-preview :global(ruby) {
		ruby-position: over;
	}

	.ruby-preview :global(rt) {
		font-size: 0.6em;
	}
</style>
