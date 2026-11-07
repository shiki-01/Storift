# ブランド素材

Storift のロゴとアイコンの置き場所、色、使い方、作り直し方。

## 構成

シンボルは「羽根(ペン)と火花」。文字 "Storift"(ワードマーク)と組み合わせたものをロゴと呼ぶ。

| 素材                                         | 場所                                                      | 用途                                                    |
| -------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| 原本(無加工。編集しない)                     | `static/brand/storift-logo.svg`                           | すべての派生元。README(明るい背景)                      |
| 明色版ロゴ                                   | `static/brand/storift-logo-light.svg`                     | 暗い背景(README のダーク表示など)                       |
| シンボルのみ                                 | `static/brand/storift-mark(-light).svg`                   | 小さく置く場所                                          |
| ワードマークのみ                             | `static/brand/storift-wordmark(-light).svg`               | 文字だけが要る場所                                      |
| アプリアイコン(全面塗り / 角丸 / マスカブル) | `static/brand/app-icon*.svg`                              | apple-touch-icon / PWA / maskable                       |
| デスクトップ用の原画(macOS / Windows)        | `static/brand/app-icon-macos.svg`、`app-icon-windows.svg` | `tauri icon` の入力の元(下の「デスクトップ版アイコン」) |
| favicon                                      | `static/favicon.svg`、`static/favicon.ico`                | タブ。SVG は OS の明暗で色が変わる                      |
| PWA・iOS 用 PNG                              | `static/favicon/*.png`                                    | `manifest.webmanifest`・`app.html`                      |
| デスクトップ版アイコン                       | `src-tauri/icons/*`                                       | `tauri.conf.json` の `bundle.icon`                      |
| Tauri の元画像(1024px、透過 PNG)             | `scripts/app-icon-macos.png`、`app-icon-windows.png`      | `tauri icon` の入力                                     |
| サイト用                                     | `site/static/favicon*`、`site/static/og.png`              | サイトの favicon と OG 画像                             |

画面に出すロゴは、インライン SVG のコンポーネント(アプリ: `src/lib/components/ui/Logo.svelte`、サイト: `site/src/lib/Logo.svelte`)。羽根と文字は `--color-primary`、火花は `--color-accent` で塗るので、テーマに追従する。`variant="mark" | "full"`、`size`(高さ px)、`title`(あれば `role="img"` で読み上げ、なければ装飾として隠す)を取る。原本の path を貼ってあるので、原本を差し替えたら、2 つの `Logo.svelte` も更新する(`src/lib/utils/brandAssets.test.ts` が食い違いを検出する)。

## 色

原本の紺 `#354B67` とオレンジ `#B96247` を、アプリのテーマ(`src/lib/stores/theme.svelte.ts`)の色に寄せている。

| 役割                        | 明るい背景                              | 暗い背景  | 元になった色                           |
| --------------------------- | --------------------------------------- | --------- | -------------------------------------- |
| 羽根・文字(藍)              | `#33507a`                               | `#9db3d1` | ライト / ダークテーマの `primary`      |
| 火花(朱)                    | `#b4543a`                               | `#d98a6e` | ライト / ダークテーマの `accent`       |
| アプリアイコンの地          | `#34507a` → `#1f3050`(縦グラデーション) |           | 藍を暗くしたもの                       |
| アプリアイコンの羽根 / 火花 | `#f6f4ef` / `#e9a383`                   |           | 紙色 / 暗い地の上で 4.5:1 以上になる朱 |

原本の `#B96247` は紙色の背景(`#f6f4ef`)の上で約 3.9:1 と 4.5:1 に届かないため、`#b4543a` に寄せた。

## 使い方

- 最小サイズ: シンボルは高さ 16px、ロゴ(シンボル + 文字)は高さ 20px まで。それより小さい場所ではシンボルだけを使う。
- 余白: シンボルの高さの 1/4 以上を、周りに空ける。
- アプリアイコン: シンボルは中央に幅 68%(OS が角を丸めても切れない範囲。デスクトップ版はタイル幅に対する割合)。マスカブルは中心の直径 80% の円に収める(幅 56%)。
- してはいけないこと: 色の置き換え(上の表以外)、引き伸ばし・回転、羽根と火花の位置関係を変える、文字だけを別の書体で組み直す、影や縁取りを付ける、コントラストの低い背景に置く。

## デスクトップ版アイコン

macOS と Windows では角の扱いが違うので、原画を 2 つに分けている。どちらも 1024×1024 の透過キャンバスで、背景(縦グラデーション)・羽根・火花の色と形は共通。

|            | macOS(`app-icon-macos.svg`)                                             | Windows / Linux(`app-icon-windows.svg`)                                                    |
| ---------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 使う先     | `icon.icns`(Dock・Finder)                                               | `icon.png`、`32x32.png` など各サイズの PNG、`Square*Logo.png`、`StoreLogo.png`、`icon.ico` |
| タイル     | 824×824 を中央に置き、周囲 100px は透明(Big Sur 以降のアイコングリッド) | 944×944(余白は片側 40px)                                                                   |
| 角         | 連続曲線(squircle、Figma の corner smoothing 60%)、半径 186             | 同じ連続曲線、半径 208(タイル幅の約 22%)                                                   |
| シンボル幅 | タイル幅の 68%(全面塗りと同じ割合)                                      | タイル幅の 72%                                                                             |
| 影         | 下へ 12px・ぼかし 24px・黒 30%                                          | なし(OS が付ける)                                                                          |

- macOS は OS が角を丸めない(原画の形がそのままアイコンになる)ので、余白と影まで含めて原画に描く。余白がないと、他のアプリより大きく見える。
- Windows は余白が大きいとタスクバーやエクスプローラーで小さく見えるので、余白を少なくしている。影は OS 側の描画に任せる。
- `icon.ico` は 16/24/32/48/64/128/256。`tauri icon` の縮小ではなく、各サイズを SVG から直接描いている(16px の角に色つきの薄い残りが出るのと、128px が入らないのを避けるため)。32px 以下は羽根が潰れないよう、余白と角丸を抑えてシンボルをタイル幅の 80% に大きくしている。
- `apple-touch-icon`(iOS が自分でマスクする)とマスカブルは全面塗りのまま。PWA の `purpose: "any"` は `app-icon-rounded.svg`。

## 作り直し

```sh
bun run icons
```

`scripts/build-icons.mjs` が、原本から派生 SVG、PWA / サイト / favicon の PNG と ICO、OG 画像、`scripts/app-icon-macos.png` / `app-icon-windows.png`、`src-tauri/icons/*` を作り直す。`tauri icon` は原画ごとに別の一時ディレクトリで 2 回走らせ、`icon.icns` は macOS 版、`icon.ico` は直接描いたもの、それ以外の PNG は Windows 版を `src-tauri/icons/` に置く(モバイル向けの出力は置かない)。Playwright の Chromium を使う(`playwright install` は不要な環境が前提)。配色や余白を変えるときは、スクリプト先頭の `COLORS` と、各アイコンの `margin` / `radius` / `widthRatio` を直す。
