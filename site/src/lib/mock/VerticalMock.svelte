<!-- 縦書きプレビューの見本。原稿は EditorMock と同じ場面 -->
<div class="paper" aria-hidden="true">
	<div class="vertical">
		<p class="title">二</p>
		<p>　坂の上の古書店は、雨の日にだけ灯りをともす。</p>
		<p>
			　<ruby>栞<rt>しおり</rt></ruby
			>の挟まった頁をひらくと、そこには祖母の字で、私の知らない町の名前が書かれていた。
		</p>
		<p>　「この町へは、もう行けないのよ」</p>
		<p>　そう言って笑った顔を、私はいまでも覚えている。</p>
	</div>
	<p class="folio">— 12 —</p>
</div>

<style>
	.paper {
		position: relative;
		height: 340px;
		padding: 32px 28px 40px;
		border: 1px solid var(--color-border);
		border-radius: 4px 10px 10px 4px;
		background: var(--editor-background);
		box-shadow: var(--shadow-float);
		overflow: hidden;
	}

	/* 背: アプリのホームの表紙と同じ帯 */
	.paper::before {
		content: '';
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		width: 6px;
		background: var(--color-primary);
	}

	.vertical {
		height: 100%;
		writing-mode: vertical-rl;
		font-family: var(--font-serif);
		font-size: 15px;
		line-height: 2;
		letter-spacing: 0.08em;
		overflow: hidden;
	}

	.title {
		font-weight: 600;
		padding-top: 1em;
		margin-left: 1em;
	}

	ruby rt {
		font-size: 0.5em;
	}

	.folio {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 12px;
		text-align: center;
		font-family: var(--font-serif);
		font-size: 11px;
		color: var(--color-text-secondary);
	}
</style>
