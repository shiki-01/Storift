# 共有機能の Firestore ルール設計メモ(段階 2a)

データ配置のクライアント実装(段階 2b-2)は末尾の「データ配置の実装(ポインタ方式)」を参照。

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

## データ配置の実装(ポインタ方式、段階 2b-2)

共有中のプロジェクトは、最上位の `projects/{pid}` 文書だけを「ポインタ」として残し、子要素(chapters, scenes, characters, plots, worldbuilding)は `shared/{pid}/{type}/{id}` にだけ置く。

```
projects/{pid}                  ポインタ。プロジェクト本体 + sharing(secrets 付き。オーナーのみ読める)
shared/{pid}                    メタ {visibility, name, ownerUid, updatedAt}
shared/{pid}/secrets/{role}     {value}   クライアントからは読めない(list も不可)
shared/{pid}/projects/{pid}     ゲストが参照するプロジェクトのコピー。sharing.secrets を除く。projectId = pid を付ける
shared/{pid}/{type}/{id}        子要素。projectId == pid(元々子要素が持つ値がそのまま満たす)
```

- **pid = プロジェクト ID**。プロジェクト ID は `uuid` の v4(暗号論的乱数)で生成される。ただしサンプル作品など固定 ID のものがあるため、`isUnguessableProjectId`(UUID v4 の形式)を満たさない ID は共有を開始できない。
- ローカル(Dexie)の `Project.sharing` が状態を持つ: `{pid, role, connectionId?, visibility, status: 'active'|'migrating'|'error', secrets?, startedAt, migration?: 'start'|'stop'}`。Dexie のスキーマ版は変更なし(索引不要)。`migration` は移行の向き(再開時の判断に使う。仕様の型への追加)。`status: 'error'` は型にだけあり、現在は設定しない。
- ポインタの `sharing` は、共有の開始・停止・管理の専用処理だけが書く。通常のアップロードは `sharing` を送らない(共有を知らない古い端末が書き戻すのを防ぐ)。他端末の共有開始/停止は、取得したポインタから `adoptSharing` の規則でローカルに反映する。
- 秘密はオーナー端末のローカルとポインタの `sharing.secrets` にだけ持つ。共有側のコピー・メタには入れない。

### 共有の開始(`firebase/sharing.ts: startSharing`、`services/sharing.service.ts`)

1. 保留中の変更をフラッシュ(未送信の primary 向け変更が残っていれば開始しない)
2. ローカルを `migrating`(`migration: 'start'`、秘密もここで確定)で保存
3. `shared/{pid}` メタ → secrets → ポインタを `migrating` で書く(他端末が「子要素が無い」と誤って削除しないため。仕様の手順より早くポインタを書く)
4. プロジェクトと全子要素を `shared/{pid}/…` へコピー(ローカルと最上位の新しい方を採用。コピー先が新しければ上書きしない。500 件/約 4MB で分割)
5. **共有側を読み戻して確認**できたものだけ、最上位の子要素を削除(確認できなければ `VerifyError` で止まり、何も消さない)
6. ポインタを `active` に、共有側のコピーも書く。7. ローカルを `active` に

起動時に `migrating` が残っていれば、`resumeSharingMigrations` が自動で再開する(バックグラウンド)。ダイアログの「続きを実行」からも再開できる。

### 共有の停止

`migrating`(`stop`)にし、保留中の変更を送って共有側を取り込み(参加者の編集を失わないため)、共有側の子要素を最上位へ書き戻して読み戻し確認 → `shared/{pid}` 配下を全削除 → ポインタの `sharing` を除去 → ローカル更新。ローカルに未送信の編集が残るものは、最上位へ再送する。プロジェクトの削除は、共有中なら先に `shared/{pid}` 配下を削除する(`deleteProjectSharing`)。

### ルールとの突き合わせで分かったこと(ルールは変更していない)

- `shared/{pid}/secrets` は list もできない(`read: if false`)ため、全削除では役割名(viewer / editor)を指定して削除する。
- `shared/{pid}/presence/{uid}` の write は本人のみのため、**オーナーは他人の presence 文書を削除できない**。共有の停止・削除のあとも、他人の presence 文書が残る(在席情報だけで、メンバーでなくなれば読めない)。必要ならルールで「オーナーは削除可」にすること。
- projects 型の共有側コピーにも `projectId == pid` が要るため、コピーに `projectId` を足している(ゲスト側で読むときは無視すること)。
- 共有側の更新ログ(`scenes/{id}/updates|crdt`)は、全削除時にシーンごとに 2 回の一覧取得で消す(将来それらを使い始めたとき、シーン数が多いと読み取りが増える)。

### 未検証

- 実 Firestore・複数端末での動作(Emulator テストとユニットテストのみ)。
- メンバーの削除(失効)は、同じ秘密で再参加できる。再参加させないなら秘密の再生成も必要。
