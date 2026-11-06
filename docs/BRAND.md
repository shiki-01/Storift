# ブランド素材

Storift のロゴとアイコンの置き場所、色、使い方、作り直し方。

## 構成

シンボルは「羽根(ペン)と火花」。文字 "Storift"(ワードマーク)と組み合わせたものをロゴと呼ぶ。

| 素材                                         | 場所                                         | 用途                                     |
| -------------------------------------------- | -------------------------------------------- | ---------------------------------------- |
| 原本(無加工。編集しない)                     | `static/brand/storift-logo.svg`              | すべての派生元。README(明るい背景)       |
| 明色版ロゴ                                   | `static/brand/storift-logo-light.svg`        | 暗い背景(README のダーク表示など)        |
| シンボルのみ                                 | `static/brand/storift-mark(-light).svg`      | 小さく置く場所                           |
| ワードマークのみ                             | `static/brand/storift-wordmark(-light).svg`  | 文字だけが要る場所                       |
| アプリアイコン(全面塗り / 角丸 / マスカブル) | `static/brand/app-icon*.svg`                 | Tauri・apple-touch-icon / PWA / maskable |
| favicon                                      | `static/favicon.svg`、`static/favicon.ico`   | タブ。SVG は OS の明暗で色が変わる       |
| PWA・iOS 用 PNG                              | `static/favicon/*.png`                       | `manifest.webmanifest`・`app.html`       |
| デスクトップ版アイコン                       | `src-tauri/icons/*`                          | `tauri.conf.json` の `bundle.icon`       |
| Tauri の元画像(1024px)                       | `scripts/app-icon.png`                       | `tauri icon` の入力                      |
| サイト用                                     | `site/static/favicon*`、`site/static/og.png` | サイトの favicon と OG 画像              |

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
- アプリアイコン: シンボルは中央に幅 68%(OS が角を丸めても切れない範囲)。マスカブルは中心の直径 80% の円に収める(幅 56%)。
- してはいけないこと: 色の置き換え(上の表以外)、引き伸ばし・回転、羽根と火花の位置関係を変える、文字だけを別の書体で組み直す、影や縁取りを付ける、コントラストの低い背景に置く。

## 作り直し

```sh
bun run icons
```

`scripts/build-icons.mjs` が、原本から派生 SVG、PWA / サイト / favicon の PNG と ICO、OG 画像、`scripts/app-icon.png`、`src-tauri/icons/*`(`tauri icon`。モバイル向けの出力は削除)を作り直す。Playwright の Chromium を使う(`playwright install` は不要な環境が前提)。配色や余白を変えるときは、スクリプト先頭の `COLORS` と各 `widthRatio` を直す。
