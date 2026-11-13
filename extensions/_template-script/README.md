# スクリプト拡張のひな形

スクリプト拡張(`kind: script`)のひな形です。書き方・API・投稿の流れは [docs/SCRIPT_API.md](../../docs/SCRIPT_API.md) を見てください。

- `manifest.json`: 拡張の宣言(権限・プライバシー)。`id` はフォルダ名と同じにします
- `main.js`: スクリプト本体(1 ファイルだけ。200KB まで)。隔離された Web Worker で動き、`storift` オブジェクトを使います
- `sdk.d.ts`: `storift` の型定義(エディタの補完用。投稿しても実行されません)

`extensions/<id>/` にコピーして、`bun run validate:extensions` で検証してから PR を出します。
