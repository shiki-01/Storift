# 共有機能の Firestore ルール設計メモ(段階 2a)

`firestore.rules` は、従来の「認証済みなら全開放」から request.auth.uid ベースの厳格モードに置き換わった(破壊的変更)。
認証は匿名認証のまま。ルールテストは `bun run test:rules`(Firebase Emulator 使用、`tests/rules/`)。
既存の `bun run test` はエミュレータ不要でルールテストを拾わない。

`docs/FIRESTORE_SETUP.md` は段階 2b-1 で更新済み(オーナー鍵・設定コード・旧ルール互換)。

## データ構造

```
projects / chapters / scenes / characters / plots / worldbuilding   従来コレクション(ネスト含む)
owners/{uid}                    {key}              オーナー端末の登録
_config/ownerKey                {key}              オーナー鍵(クライアント read 不可)
shared/{pid}                    {visibility: 'private'|'link', name, ...}
shared/{pid}/secrets/{role}     {value}            role = viewer | editor
shared/{pid}/members/{uid}      {role, secret, joinedAt?, name?}
shared/{pid}/presence/{uid}
shared/{pid}/{type}/{id}[/{sub}/...]   type = projects, chapters, scenes, characters, plots, worldbuilding
```

## 権限表

| パス                                | read                   | create                                                            | update   | delete             |
| ----------------------------------- | ---------------------- | ----------------------------------------------------------------- | -------- | ------------------ |
| 従来 6 コレクション                 | オーナー               | オーナー                                                          | オーナー | オーナー           |
| `_config/ownerKey`                  | 常に拒否               | 未存在かつ同一 batch の `owners/{uid}` の key と一致              | オーナー | オーナー           |
| `owners/{uid}`                      | オーナー / 自分        | 自分の uid かつ key が現在の ownerKey と一致(または bootstrap)    | 拒否     | オーナー           |
| `shared/{pid}` (get)                | オーナー/メンバー/link | オーナー                                                          | オーナー | オーナー           |
| `shared/{pid}` (list)               | オーナーのみ           | -                                                                 | -        | -                  |
| `secrets/{role}`                    | 常に拒否               | オーナー                                                          | オーナー | オーナー           |
| `members/{uid}`                     | 自分 / オーナー        | 自分の uid + 正しい secret + hasOnly(role,secret,joinedAt,name)   | オーナー | 自分 / オーナー    |
| `presence/{uid}`                    | メンバー / オーナー    | 自分の uid かつメンバーまたはオーナー(update/delete も同様)       | 同左     | 同左               |
| `shared/{pid}/{type}/{id}`          | オーナー/メンバー/link | オーナー or editor、`projectId == pid`(projects 型は `id == pid`) | 同左     | オーナー or editor |
| `shared/{pid}/{type}/{id}/{sub}/**` | オーナー/メンバー/link | オーナー or editor                                                | 同左     | 同左               |

未認証、および上記以外のパスはすべて拒否。

## オーナー bootstrap

- 初回端末: 1 batch で `_config/ownerKey {key}` と `owners/{uid} {key}` を作成。
- 2 台目以降: 現在の ownerKey と同じ key で `owners/{自分のuid}` を作成。
- 鍵のローテーション: オーナーが `_config/ownerKey` を update。旧鍵では新規登録できなくなる(登録済み端末は影響なし)。
- 失効: オーナーが `owners/{uid}` を delete。
- 先着: ownerKey 未作成の間は、最初に batch を commit した認証ユーザーがオーナーになる(仕様として許容)。デプロイ直後に速やかに登録すること。

## 検証済みの挙動(エミュレータ、61 テスト)

- `shared` コレクションの list: オーナーのみ可。非オーナーは(`visibility` 条件付きでも)拒否する。link 公開のプロジェクトを列挙されると、pid を知らなくてもデータを読めてしまうため。プロジェクトは pid を指定した get で個別に取得する。
- ルールは複数 match の OR 評価。`shared/{pid}/{col}/{id}` と、サブコレクション以下用の `shared/{pid}/{col}/{id}/{sub}/{rest=**}` に分け、col を type に限定したため、secrets / members / presence に抜け道はない。
- **`{rest=**}`は 0 セグメントにも一致する。**`{id}/{rest=**}`と書くと文書`{id}` 自身にも一致し、projectId 検証付きの個別 match を迂回できた(テストで検出)。`{sub}/{rest=**}` で回避している。
- 未認証だと `visibility=='link'` の条件だけで read が通ってしまうため、link 条件には `signedIn()` を明示している。
- 秘密文書が存在しない PJ への参加は拒否される。viewer 秘密で role=editor は拒否。
- bootstrap で ownerKey と owners の key が不一致、または他人の uid を登録する batch は拒否される。

## コスト(読み取り課金)

ルール内の `get()` / `exists()` / `getAfter()` / `existsAfter()` は文書読み取りとして課金される(同一リクエスト内の同一文書は 1 回)。
`isOwner()` は 1 回の exists、メンバー判定・ロール取得・link 判定で追加の読み取りが発生する。
共有データの書き込み 1 件あたり、数回(owners の exists、members の exists/get、メタの get)の読み取りが上乗せされる。

## 未検証・既知の制限

- 課金される読み取り回数の実測はしていない(上記は仕様に基づく説明)。
- 本番 Firebase への適用、クライアント実装との結合は未検証。
- 匿名認証の uid は端末・ブラウザデータ消去で変わる。再参加・再登録が必要。
- `owners/{uid}` の key はクライアントが保持する前提の共有秘密。オーナー同士は互いを区別しない。
- members の `secret` フィールドは文書に残るため、オーナーと本人は参加に使った秘密を読める。秘密をローテーションしても既存メンバーは失効しない(オーナーが members を delete する)。
- link 公開ではメタの列挙と全データの read が誰にでも可能(URL を知らなくても、PJ ID が分かれば読める)。
- ネスト(updates/crdt)文書にはスキーマ検証(projectId 等)をしていない。
- presence の内容(フィールド)は検証していない。
