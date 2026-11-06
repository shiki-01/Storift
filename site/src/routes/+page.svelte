<script lang="ts">
	import Seo from '$lib/Seo.svelte';
	import Logo from '$lib/Logo.svelte';
	import Icon from '$lib/Icon.svelte';
	import AppDemo from '$lib/demo/AppDemo.svelte';
	import TryWriting from '$lib/TryWriting.svelte';
	import Gallery from '$lib/Gallery.svelte';
	import ThemePicker from '$lib/ThemePicker.svelte';
	import AiDemo from '$lib/AiDemo.svelte';
	import { onMount } from 'svelte';
	import { APP_URL, RELEASES_URL } from '$lib/config';
	import { getAutoOpen, hasUsedEditor, setAutoOpen } from '$lib/editorLink';

	const keep = [
		{
			icon: 'offline',
			title: 'オフラインで開ける',
			body: '一度読み込めば、通信がなくても起動します。原稿は端末の中に保存されます。'
		},
		{
			icon: 'sync',
			title: '自分の Firebase で同期',
			body: '複数の端末で書くときは、ご自身の Firebase プロジェクトを保管先にします。'
		},
		{
			icon: 'history',
			title: '版を残して戻せる',
			body: '書いた内容の履歴を残し、以前の状態へ戻せます。同期で上書きされる版も自動で控えます。'
		},
		{
			icon: 'export',
			title: '好きな形式で書き出す',
			body: 'TXT・Markdown・DOCX・PDF・EPUB・JSON。投稿サイトにも、印刷にも。'
		}
	] as const;

	// エディタで作品を作ったことがある人だけに、次回から自動でエディタを開くか尋ねる
	let askAutoOpen = $state(false);

	onMount(() => {
		if (!hasUsedEditor()) return;
		// エディタ側から「サイトを見る」で来たときは移動しない
		let fromApp = false;
		try {
			fromApp =
				!!document.referrer && new URL(document.referrer).origin === new URL(APP_URL).origin;
		} catch {
			// 参照元が読めなければ、通常の訪問として扱う
		}
		if (fromApp) return;
		const mode = getAutoOpen();
		if (mode === 'on') location.replace(APP_URL);
		else if (mode === null) askAutoOpen = true;
	});

	function answerAutoOpen(on: boolean) {
		setAutoOpen(on);
		askAutoOpen = false;
		if (on) location.assign(APP_URL);
	}

	const covers = ['雨の日の栞', '灯台守の手紙', '最初の一行'];
</script>

<Seo />

{#if askAutoOpen}
	<div class="auto-open" role="dialog" aria-label="エディタを自動で開く">
		<p>
			エディタで作品を作成済みです。次回から、このサイトを開いたときに自動でエディタを開きますか？
			<span>エディタの設定からいつでも変更できます。</span>
		</p>
		<div class="auto-open-actions">
			<button class="btn primary" onclick={() => answerAutoOpen(true)}>自動で開く</button>
			<button class="btn secondary" onclick={() => answerAutoOpen(false)}>開かない</button>
		</div>
	</div>
{/if}

<section class="hero">
	<div class="wrap">
		<div class="hero-head">
			<div class="hero-text">
				<div class="brand"><Logo height={40} /></div>
				<h1>小説を書くための、<br />ひとつの場所。</h1>
				<p class="lead">
					原稿、プロット、人物、設定資料、進捗。ばらばらになりがちな物語の材料を、作品ごとにひとつにまとめる執筆アプリです。
				</p>
			</div>
			<div class="hero-cta">
				<div class="cta">
					<a class="btn primary" href={APP_URL}>エディタを開く</a>
					<a class="btn secondary" href="/guide">使い方を見る</a>
				</div>
				<p class="note">ブラウザで動きます。インストールは不要です。</p>
			</div>
		</div>
		<AppDemo />
	</div>
</section>

<section class="block" id="write">
	<div class="wrap">
		<div class="copy wide">
			<p class="label"><Icon name="write" size={16} />書く</p>
			<h2>打った記法が、そのまま組まれる。</h2>
			<p>
				｜漢字《かんじ》でルビ、《《強調》》で傍点。日本語の小説に必要な記法は、本文にそのまま書けます。下の枠で試せます。
			</p>
		</div>
		<TryWriting />
	</div>
</section>

<section class="block" id="organize">
	<div class="wrap">
		<div class="copy wide">
			<p class="label"><Icon name="plot" size={16} />整理する</p>
			<h2>物語の材料は、原稿のすぐ隣に。</h2>
			<p>
				筋書きはプロットに、登場人物は人物の頁と相関図に、世界のきまりごとは設定資料に。どれも作品ごとに保管され、執筆の途中でも左のレールからすぐ開けます。
			</p>
		</div>
		<Gallery />
	</div>
</section>

<section class="block" id="theme">
	<div class="wrap split">
		<div class="copy">
			<p class="label"><Icon name="palette" size={16} />配色</p>
			<h2>紙の色を、選んで書く。</h2>
			<p>
				配色は「和紙」「墨」「古書」「夜」の四つ。選ぶと、このサイトもアプリと同じ色に変わります。
			</p>
		</div>
		<ThemePicker />
	</div>
</section>

<section class="block" id="keep">
	<div class="wrap">
		<div class="copy wide">
			<p class="label"><Icon name="offline" size={16} />守る</p>
			<h2>原稿は、手元に残る。</h2>
			<p>
				書いたものはまず端末の中に保存されます。どこに置くか、いつ書き出すかを、書き手が決められるようにしています。
			</p>
		</div>
		<ul class="keep">
			{#each keep as k (k.title)}
				<li>
					<span class="keep-icon"><Icon name={k.icon} /></span>
					<h3>{k.title}</h3>
					<p>{k.body}</p>
				</li>
			{/each}
		</ul>
	</div>
</section>

<section class="block" id="desktop">
	<div class="wrap split">
		<div class="copy">
			<p class="label">
				<Icon name="ai" size={16} />推敲する<span class="badge">デスクトップ版</span>
			</p>
			<h2>推敲の相談相手を、画面の横に。</h2>
			<p>
				Windows・macOS・Linux 向けのデスクトップ版では、執筆画面の横に AI
				のパネルを開けます。Claude Code・OpenAI 互換 API・Anthropic API・Gemini・Ollama から選べます。表記ゆれや設定の食い違いを作品全体から探したり、選んだ一文について相談したりできます。
			</p>
			<p>
				本文を書き換える案は差分で示され、反映するかどうかは一件ずつ自分で決めます。既定は「提案のみ」で、設定で選ばない限り原稿が書き換わることはありません。右の見本で押してみてください。
			</p>
			<p class="small">
				Claude Code を使う場合は、Claude Code のインストールとログインが必要です。使用量と料金は、選んだサービスのご自身のアカウントに計上されます。
			</p>
			<div class="cta">
				<a class="btn secondary" href={RELEASES_URL}>
					<Icon name="desktop" size={18} />デスクトップ版を入手
				</a>
			</div>
		</div>
		<div class="figure">
			<AiDemo />
		</div>
	</div>
</section>

<section class="closing">
	<div class="wrap closing-inner">
		<div class="shelf" aria-hidden="true">
			{#each covers as c (c)}
				<div class="cover"><span>{c}</span></div>
			{/each}
		</div>
		<div>
			<h2>まずは一作品、書きはじめる。</h2>
			<p>
				エディタを開き、作品の名前を決めれば準備は終わりです。迷ったときは<a href="/guide">使い方</a
				>と<a href="/faq">Q&amp;A</a>を見てください。
			</p>
			<div class="cta">
				<a class="btn primary" href={APP_URL}>エディタを開く</a>
				<a class="btn secondary" href="/features">機能の一覧</a>
			</div>
		</div>
	</div>
</section>

<style>
	.auto-open {
		position: fixed;
		left: 50%;
		bottom: 20px;
		z-index: 60;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px 20px;
		width: min(640px, calc(100% - 32px));
		padding: 14px 16px;
		transform: translateX(-50%);
		border: 1px solid var(--color-border);
		border-radius: 14px;
		background: var(--color-background);
		box-shadow: var(--shadow-float);
		font-size: 14px;
		line-height: 1.6;
	}

	.auto-open p {
		flex: 1 1 260px;
		margin: 0;
	}

	.auto-open span {
		display: block;
		font-size: 12px;
		color: var(--color-text-secondary);
	}

	.auto-open-actions {
		display: flex;
		gap: 8px;
	}
	/* ===== 冒頭 ===== */
	.hero {
		padding: 56px 0 72px;
	}

	.hero-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		justify-content: space-between;
		gap: 24px 48px;
		margin-bottom: 32px;
	}

	.hero-text {
		flex: 1 1 26rem;
		max-width: 40rem;
	}

	.brand {
		margin-bottom: 20px;
		color: var(--color-primary);
	}

	h1 {
		font-size: clamp(1.9rem, 4.4vw, 2.9rem);
		line-height: 1.35;
		letter-spacing: 0.03em;
	}

	.lead {
		margin-top: 16px;
		color: var(--color-text-secondary);
	}

	.cta {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
	}

	.note {
		margin-top: 10px;
		font-size: 12.5px;
		color: var(--color-text-secondary);
	}

	/* ===== 各節 ===== */
	.block {
		padding: 72px 0;
		border-top: 1px solid var(--color-border);
	}

	.split {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
		gap: 56px;
		align-items: center;
	}

	.copy {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.copy.wide {
		max-width: 44rem;
		margin-bottom: 32px;
	}

	.copy .cta {
		margin-top: 8px;
	}

	/* アプリの画面上部と同じく、アイコン + 短い名前で節を示す */
	.label {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		color: var(--color-text-secondary);
	}

	.label :global(svg) {
		color: var(--color-primary);
	}

	.badge {
		margin-left: 6px;
		padding: 0 8px;
		border: 1px solid var(--color-border);
		border-radius: 999px;
		font-size: 11.5px;
	}

	h2 {
		font-size: clamp(1.35rem, 2.6vw, 1.7rem);
		letter-spacing: 0.03em;
	}

	.copy > p:not(.label) {
		color: var(--color-text-secondary);
	}

	.copy .small {
		font-size: 13px;
	}

	.figure {
		min-width: 0;
	}

	/* 守る: アプリの進捗画面の数字カードと同じ形 */
	.keep {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 12px;
	}

	.keep li {
		padding: 20px;
		border: 1px solid var(--color-border);
		border-radius: 12px;
		background: var(--color-surface);
	}

	.keep-icon {
		display: inline-flex;
		color: var(--color-primary);
	}

	.keep h3 {
		margin-top: 10px;
		font-size: 15px;
	}

	.keep p {
		margin-top: 6px;
		font-size: 13.5px;
		color: var(--color-text-secondary);
	}

	/* ===== 締め ===== */
	.closing {
		padding: 72px 0;
		border-top: 1px solid var(--color-border);
	}

	.closing-inner {
		display: flex;
		align-items: center;
		gap: 56px;
	}

	.closing h2 {
		margin-bottom: 10px;
	}

	.closing p {
		color: var(--color-text-secondary);
	}

	.closing .cta {
		margin-top: 24px;
	}

	.shelf {
		flex: none;
		display: flex;
		gap: 10px;
	}

	/* アプリのホームに並ぶ作品の表紙と同じ形 */
	.cover {
		position: relative;
		display: flex;
		justify-content: center;
		width: 104px;
		aspect-ratio: 3 / 4;
		padding: 14px 8px 8px 14px;
		border: 1px solid var(--color-border);
		border-radius: 4px 8px 8px 4px;
		background: var(--editor-background);
		box-shadow: var(--shadow-float);
		transition: transform 0.2s cubic-bezier(0.2, 0.7, 0.2, 1);
	}

	.cover:hover {
		transform: translateY(-6px);
	}

	.cover::before {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		width: 5px;
		background: var(--color-primary);
	}

	.cover span {
		writing-mode: vertical-rl;
		font-family: var(--font-serif);
		font-size: 14px;
		font-weight: 600;
		letter-spacing: 0.14em;
	}

	@media (max-width: 960px) {
		.split {
			grid-template-columns: minmax(0, 1fr);
			gap: 32px;
		}

		.keep {
			grid-template-columns: 1fr 1fr;
		}

		.closing-inner {
			flex-direction: column;
			align-items: flex-start;
			gap: 32px;
		}
	}

	@media (max-width: 760px) {
		.hero {
			padding: 32px 0 48px;
		}

		.block,
		.closing {
			padding: 48px 0;
		}

		.keep {
			grid-template-columns: minmax(0, 1fr);
		}

		.cover {
			width: 88px;
		}
	}
</style>
