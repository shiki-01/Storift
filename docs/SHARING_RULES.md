# 共有機能の Firestore ルール設計メモ(段階 2a)

データ配置のクライアント実装(段階 2b-2)は「データ配置の実装(ポインタ方式)」、招待リンク・ゲスト接続・権限の反映(段階 2b-3)は「招待リンク・ゲスト接続(段階 2b-3)」、シーン本文のリアルタイム共同編集の Firestore 配置(段階 3a)は末尾の「シーン本文の CRDT(段階 3a)」を参照。

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
shared/{pid}/presence/{uid}     {name, color, sceneId, cursor?, updatedAt}   在席情報(段階 3b)・カーソル(段階 4)
shared/{pid}/{type}/{id}[/{sub}/...]   type = projects, chapters, scenes, characters, plots, worldbuilding
```

## 権限表

| パス                                | read                   | create                                                            | update   | delete                                 |
| ----------------------------------- | ---------------------- | ----------------------------------------------------------------- | -------- | -------------------------------------- |
| 従来 6 コレクション                 | オーナー               | オーナー                                                          | オーナー | オーナー                               |
| `_config/ownerKey`                  | 常に拒否               | 未存在かつ同一 batch の `owners/{uid}` の key と一致              | オーナー | オーナー                               |
| `owners/{uid}`                      | オーナー / 自分        | 自分の uid かつ key が現在の ownerKey と一致(または bootstrap)    | 拒否     | オーナー                               |
| `shared/{pid}` (get)                | オーナー/メンバー/link | オーナー                                                          | オーナー | オーナー                               |
| `shared/{pid}` (list)               | オーナーのみ           | -                                                                 | -        | -                                      |
| `secrets/{role}`                    | 常に拒否               | オーナー                                                          | オーナー | オーナー                               |
| `members/{uid}`                     | 自分 / オーナー        | 自分の uid + 正しい secret + hasOnly(role,secret,joinedAt,name)   | オーナー | 自分 / オーナー                        |
| `presence/{uid}`                    | メンバー / オーナー    | 自分の uid かつメンバーまたはオーナー                             | 同左     | **オーナー** / 自分の uid かつメンバー |
| `shared/{pid}/{type}/{id}`          | オーナー/メンバー/link | オーナー or editor、`projectId == pid`(projects 型は `id == pid`) | 同左     | オーナー or editor                     |
| `shared/{pid}/{type}/{id}/{sub}/**` | オーナー/メンバー/link | オーナー or editor                                                | 同左     | 同左                                   |

未認証、および上記以外のパスはすべて拒否。

## オーナー bootstrap

- 初回端末: 1 batch で `_config/ownerKey {key}` と `owners/{uid} {key}` を作成。
- 2 台目以降: 現在の ownerKey と同じ key で `owners/{自分のuid}` を作成。
- 鍵のローテーション: オーナーが `_config/ownerKey` を update。旧鍵では新規登録できなくなる(登録済み端末は影響なし)。
- 失効: オーナーが `owners/{uid}` を delete。
- 先着: ownerKey 未作成の間は、最初に batch を commit した認証ユーザーがオーナーになる(仕様として許容)。デプロイ直後に速やかに登録すること。

## 検証済みの挙動(エミュレータ。件数は `bun run test:rules` の出力を参照)

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
- presence の内容(フィールド。段階 4 の `cursor` を含む)は検証していない。他のメンバーが任意の `cursor` を書いても、読む側が形を検証して無視する(表示に使う色も `hsl(…)` の形のものだけ)。
- presence の delete は、段階 2b-3 でオーナーも可にした(共有の停止・メンバー削除のあとに他人の在席情報を片付けるため)。create / update は従来どおり本人のみ。

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
- (段階 2b-2 時点)`shared/{pid}/presence/{uid}` の write は本人のみのため、オーナーは他人の presence 文書を削除できず、共有の停止・削除のあとも残った。段階 2b-3 でルールを「オーナーは delete 可」に変更し、全削除で他人の分も消せるようになった(旧ルールの Firebase では権限エラーになるため、全削除は権限エラーを無視して続ける)。
- projects 型の共有側コピーにも `projectId == pid` が要るため、コピーに `projectId` を足している(ゲスト側で読むときは無視すること)。
- 共有側の更新ログ(`scenes/{id}/updates|crdt`)は、全削除時にシーンごとに 2 回の一覧取得で消す(将来それらを使い始めたとき、シーン数が多いと読み取りが増える)。

### 未検証

- 実 Firestore・複数端末での動作(Emulator テストとユニットテストのみ)。
- メンバーの削除(失効)は、同じ秘密で再参加できる。再参加させないなら秘密の再生成も必要。

## 招待リンク・ゲスト接続(段階 2b-3)

招待された人(ゲスト)は、自分の Firebase とは別の「ホストの Firebase」へ接続する。ゲストは自分の Firebase 設定を持たなくてもよい。**ゲストのプロジェクトは、ゲストの主 Firebase には絶対に同期しない**(他人のデータをゲストのクラウドへ複製しない)。ルールの変更は presence の delete(上記)のみ。

### 招待リンク(`firebase/invite.ts`)

形式: `<base>/join#<payload>`。payload = base64url(JSON `{v:1, f:<Firebase設定6項目>, p:<pid>, r:'viewer'|'editor', s?:<秘密>, n?:<名前ヒント>}`)。

- `<base>`: Web 版は `location.origin`、デスクトップ版(Tauri)は公開アプリの URL(`invite.ts` の `PUBLIC_APP_URL`、既定 `https://app.storift.shiki-01.com`)。デスクトップ版で受け取ったリンクも、ホームの「共有リンクから参加」に貼り付けて同じ処理で参加する。
- `s`(秘密)は**トークン方式のときだけ**入れる。パスワード方式ではリンクに秘密を入れず、受け取った人が入力する。方式はオーナー側の `ProjectSharing.secretKinds`(`token` / `password`)に記録する。記録のない旧データは、生成トークンの形(43 文字の base64url)ならトークン、そうでなければパスワードとみなす(迷うときはパスワード側に倒し、誤ってパスワードをリンクに載せない)。
- `n`(プロジェクト名ヒント)は既定では含めない(発行時のチェックで含める)。
- フラグメントはサーバーへ送られない。`/join` は先にフラグメントをメモリへ読み取り、ルーターの初期化後(`afterNavigate`)に `replaceState` で URL・履歴から消す(直接読み込みでは初期化前に `replaceState` を呼べないため)。招待データ(`prepared`)は IndexedDB に渡すので `$state.raw` で保持する(`$state` の Proxy は `DataCloneError` になる)。デコードは不正入力で例外を投げず、`{ok:false, error}` を返す(日本語メッセージあり)。
- 注意: リンクを知る人は誰でも参加できる(パスワード方式はパスワードも必要)。漏れたら秘密を再生成する。再生成後は新しいリンクが必要で、**参加済みのメンバーは自動では失効しない**ので、必要ならメンバーを削除する。

### 参加フロー(`services/join.service.ts`、Firestore 操作は `firebase/join.ts`)

1. リンクを読む(`prepareJoin`)。主 Firebase の設定とリンクの設定を比較(projectId と apiKey が一致するか。`firebase/joinPolicy.ts` の `decideJoinRoute`):
   - 同じで、この端末のアクセスモードが `owner`: 「この Firebase のオーナー端末です。プロジェクトは通常の同期で開けます」と案内し、参加しない。
   - 同じで `legacy`(旧ルール): 共有に必要な新ルールが未適用と案内して止める。
   - 同じで `needs-owner`: 主 Firebase のインスタンスをゲストとして使う(`connectionId` なし)。
   - 同じだが判定できていない(`unknown`): 誤ってオーナー端末に参加しないよう、判定し直したうえでなお不明なら止める。
   - 別の Firebase(または主 Firebase 未設定): ホストへ接続する。名前付きアプリ `storift-conn-<hash>`(ホストごとに 1 つ)を初期化し、匿名サインインする。
   - ローカルに同じ ID のプロジェクトがある場合: この端末でオーナーのもの、ゲスト以外の通常のプロジェクトは参加しない(データを混ぜない)。ゲストとして参加済み(再参加)・退出してローカル専用にしたコピーは再利用する。
2. `shared/{pid}/members/{uid}` を `{role, secret, joinedAt, name?}` で作成(`joinSharedProject`)。ルールが `secrets/{role}` と照合する。既にメンバーなら何も書かず、すでに持っている役割を使う(メンバーの更新はオーナーのみ。役割を変えるにはオーナーがメンバーを削除する)。
3. `shared/{pid}` のメタ、`shared/{pid}/projects/{pid}`(プロジェクトのコピー)、全子要素を取得(`fetchSharedSnapshot`)。コピーの `projectId`(ルール用)と `sharing`(ホスト視点)は採用しない。
4. ローカル(Dexie)へ保存。プロジェクト ID = pid。`sharing: {pid, role, connectionId?, visibility, status: 'active', startedAt}`(secrets なし)。再参加は既存を再利用して、リモート優先でマージする(内容が違うローカルの版は履歴へ退避)。取得した版は同期の基準(base)として記録する。
5. 拒否の原因は日本語に分類する(`classifyJoinError`)。`permission-denied` は「パスワードが違う、または招待が無効です」。ただし旧ルールの Firebase でも同じ `permission-denied` になるため、拒否されたら `owners/{自分のuid}` を読んで旧ルールか判別し(`diagnoseDenied`)、旧ルールならルール未適用の案内にする。サインインの失敗(匿名認証が無効・承認済みドメイン未登録)や通信エラーも別の文言にする。

### 接続の保存と起動時の復元

Dexie スキーマ v4 で `connections` テーブル(`id, pid, status`)を追加(テーブルの追加のみで、既存データは変更しない)。`{id, firebaseConfig, pid, role, name?, status: 'active'|'revoked', createdAt, lastSyncAt?}`。`id` は (ホストの projectId・apiKey, pid) から決まる安定した値で、再参加で同じ接続を使い回す。端末ごとの情報で、同期の対象外。

起動時にバックグラウンドで active な接続ごとに Firebase アプリを初期化して `registerConnectionDb` する(`services/connection.service.ts`)。サインインは起動をブロックしない。認証状態は IndexedDB に永続化されるため、オフライン起動でも維持される。同期が実際に必要になったとき(取得・送信・購読)にサインインの完了を待ち、新規サインインできない(オフライン等)ときはその接続を飛ばす。

### ゲスト同期

- 差分取得・realtime(開いているプロジェクト)・アップロードを、2b-2 の SyncTarget(connectionId つきのキー `{connectionId}:shared/{pid}`)で動かす。排他(Mutex)・バックオフ・進捗・診断は既存のものを共用する。
- **主 Firebase の同期設定とは独立**: 主が未設定・同期無効・オーナー未登録でも、ゲストの同期は動く。送れない行き先(未登録の接続など)の変更はキューに残し、送れるものだけを送る。
- **主 Firebase からの除外**: ゲストのプロジェクト(接続あり・なし)と退出後のローカル専用のコピーは、プロジェクト文書も子要素も、主 Firebase へ送らず、主 Firebase からも取り込まない(取得の除外、キューに積まない、送信直前の確認の 3 段)。
- ゲストは最上位のポインタ・共有側のプロジェクトのコピーを書かない(オーナーだけが書く)。このため、ホストでのタイトル変更などはゲストへ自動では反映されない(参加時のコピーのまま。子要素は同期される)。

### 権限の反映

- viewer: アップロードしない。UI は読み取り専用(`utils/readOnly.ts` の `isReadOnlyProject`)。同期層の安全網として、キューに積まず、送信直前にも捨て、取得ではリモートが常に勝つ(混入したローカルの変更は履歴へ退避して上書き。ローカルにしか無いものも退避して取り除く)。
- editor: 通常どおり編集・送信。共有ダイアログにはオーナー操作を出さない(退出のみ)。
- 失効: permission-denied(メンバー削除・秘密無効・共有停止)を、送信・取得・購読のいずれかで検知したら、ローカルの `sharing.revokedAt` を立て、接続を `revoked` にして同期を止める。バナー「このプロジェクトへのアクセス権が無効です。ローカルのコピーは残ります」を表示し、読み取り専用になる。ローカルは削除しない。再参加(新しい招待リンク)で復帰できる。link 公開のプロジェクトでは、メンバーでなくなっても読み取りは続く(書き込みで検知される)。
- 退出: `members/{自分のuid}` と自分の presence を削除し、ローカルのコピーは「残す(共有解除して `localOnly`。どこにも同期しない)」か「削除」を選ぶ。通信できず退出できなかったときは、ローカルには何もしない。

### バックアップ・エクスポート

JSON のバックアップ/エクスポート(`backup.service.ts`、`export.service.ts`)は `project.sharing`(`secrets` を含む)を載せない。ゲストのプロジェクトは `localOnly` を付けて出力し、復元・取り込みしても自分のクラウドへ複製されないようにする。復元では、バックアップ側の `sharing` は採用せず、端末に既にある同じ ID のプロジェクトの共有の状態・`localOnly` は保つ。

### 検証済み(Emulator、`tests/rules/join-client.test.ts`)

正しいトークン/パスワードで参加でき、誤った秘密・存在しない pid・viewer の秘密で editor を名乗る場合は拒否される。参加後の取得、viewer の書き込み拒否、editor の書き込み成功、退出、オーナーによるメンバー削除後に permission-denied になること、旧ルールの判別。

### 未検証

- 実 Firestore・実機(複数端末、デスクトップ版)での動作。ホスト Firebase の承認済みドメイン・匿名認証の有効化が必要(FIRESTORE_SETUP.md)。
- ブラウザでの UI(閲覧専用の網羅性は、本文・章/シーン・人物・プロット・世界観・検索置換の主要な入口のみ。バージョン履歴の復元や AI パネルからの編集などは UI では止めておらず、同期層の安全網で共有側とは食い違わない)。

---

## シーン本文の CRDT(段階 3a)

共有プロジェクト(`sharing.status === 'active'`)のシーン本文(`Scene.content`)だけが対象。Yjs の `Y.Text`(名前 `content`、インデックスは UTF-16 コードユニット)として扱う。非共有プロジェクトは従来どおり。エディタ UI との結合(contenteditable・IME・undo・在席表示)は段階 3b(下の「エディタとの結合・在席表示(段階 3b)」)。

### データ配置(ルールは変更していない)

```
shared/{pid}/scenes/{sceneId}/crdt/snapshot     { state: Bytes, updatedAt: number, rev: number }
shared/{pid}/scenes/{sceneId}/updates/{autoId}  { update: Bytes, by: uid, clientId: number, createdAt: number(クライアント時刻 ms), n: number }
```

- `snapshot.state` は Y 文書の全状態(`encodeStateAsUpdate`)。`rev` は圧縮のたびに +1(初期は 0)。950,000 バイトを超える状態は書かない。
- `updates` は 1 文書 = 1 回の送信(連続した更新を `Y.mergeUpdates` でまとめたもの)。ペイロードは 500KB 以下になるよう文書を分ける(更新は個別にしか分けられない。単独で 950,000 バイトを超える更新は送らずエラー)。`n` は含まれる更新の件数メモ。
- 既存ルールの `shared/{pid}/{col}/{id}/{sub}/{rest=**}` で足りる: editor/owner は read・write(create / update / delete)、viewer・link 公開は read のみ。非メンバーは不可。Emulator(`tests/rules/crdt-client.test.ts`)で確認済み。
- 接続先の Firestore は SyncTarget のキー(`shared/{pid}`、ゲスト接続は `{connectionId}:shared/{pid}`)から解決する。

### 初期化の競合対策

最初に CRDT 化する端末は `runTransaction` で `crdt/snapshot` の有無を確認し、無ければ現在のローカル `content` から作った状態を書く。既にあれば作らず、それを読み込む(複数端末が同じ文字列から別々に初期化して本文が二重になるのを防ぐ)。トランザクションに負けた側のローカル `content` が CRDT の本文と違えば、上書きの前に `historyDB`(changeType `conflict`)へ退避してから CRDT の本文を採用する。閲覧者は snapshot を作れないので、snapshot がまだ無いシーンは従来の `content` のまま(開こうとすると理由 `no-snapshot` で失敗する)。

### 圧縮(コンパクション)

更新は冪等。取得済み(自分が適用済み)の updates 文書が動作中に 50 件以上、またはシーンを閉じる時に 10 件以上のとき、書き込み権限のある端末が自分の Y 文書の全状態を snapshot に書き(`rev + 1`)、**自分が適用済みの updates 文書だけ**を削除する。トランザクションで現在の `rev` が自分の知っている `rev` と一致することを確認し、一致しなければ書かない(古い圧縮が新しい snapshot を上書きしない)。削除は最初の 400 件を snapshot と同じトランザクションで、残りは snapshot の書き込み後にバッチで行う。

圧縮で消された updates を取りこぼしていた端末が追いつけるよう、開いている間は `crdt/snapshot` 文書も購読し、`rev` が進んだら適用する。

### 購読・時計のずれ

開いている間、`updates` を `createdAt > lastSeen - 5分` で購読する(added のみ処理)。端末間の時計のずれで取りこぼさないための余裕で、重複して届いても更新は冪等。`createdAt` は送信時刻(オフラインで溜めた更新は再送した時刻)で、1 文書ごとに +1 して順序を保つ。

### reconcile との関係

`crdtDocs`(Dexie v5)に行があるシーンでは、reconcile(3 者比較)で `content` と `characterCount` を比較せず、リモートの値でローカルを上書きしない(`reconcile.ts: CRDT_OWNED_KEYS / adoptOwnedFields / reconcileOwned`)。本文のミラー更新だけの差は競合にせず、ローカルの版が新しければ共有側の `scenes` 文書へ送る。題名・並び順などにも差があって競合になった場合は、ダイアログを出さず新しい方を採用する(ローカルが上書きされるときは履歴へ退避)。行の `targetKey` が今の行き先と違うとき(共有の停止・付け替え後)は CRDT として扱わない。

### 権限エラー

書き込み・圧縮・購読で permission-denied を受けたら再試行せず、そのシーンを読み取り専用にして `syncStore.error` で通知する。ゲストのプロジェクトでは 2b-3 の `revokeGuestAccess` も呼ぶ(アクセス失効として扱う)。未送信の更新はローカルに残す。

### 未検証

実 Firestore・複数端末・実機での動作。オフラインで書き込みが宙に浮いた場合の挙動(送信は 20 秒で打ち切り、バックオフして再送する。SDK のキューに残った書き込みと再送が重なると同じ更新の文書が重複するが、更新は冪等で、圧縮で片付く)。

## エディタとの結合・在席表示(段階 3b)

ルールの変更は無い。エディタの結合の挙動(IME・undo・フォールバック・既知の制限)は [SYNC_OPTIMIZATION.md](./SYNC_OPTIMIZATION.md) の「2f」。

### 在席情報(presence)

`shared/{pid}/presence/{uid}` に `{ name, color, sceneId, cursor, updatedAt }` を書く(`firebase/presence.ts`、送受信は `services/presence.service.ts`、判断は `crdt/presencePolicy.ts`)。ルールは 2a のまま(読み取り: メンバー/オーナー、作成・更新: 本人のみ、削除: 本人またはオーナー)で、フィールドの内容は検証しない。

- **書く**: 共有プロジェクトのエディタを開いたとき・開いているシーンが変わったとき・30 秒ごと(タブが見えている間。非表示から戻ったときもすぐ)。離脱時(`pagehide`・エディタを閉じたとき)は削除する(ベストエフォート。取りこぼしても 90 秒で表示から消える)。`updatedAt` は端末の時刻(`Date.now()`)。
- **読む**: エディタを開いている間だけ `presence` コレクション全体を購読する。`updatedAt` が 90 秒以内の他者だけを表示する(自分は除く)。ゲスト接続(`connectionId`)のときは、その接続の Firestore とサインイン中の uid を使う。権限エラー・通信エラーは黙って止める。
- **表示**: エディタのヘッダーに「他 N 人が閲覧中: 名前, …」(同じシーンを開いている人は強調)、シーン一覧の各シーンに相手の色の小さな点。他者のカーソル/選択範囲の表示は下の「他者のカーソル(段階 4)」。
- **表示名**: 設定画面「共有時の表示名」(`AppSettings.displayName`)。未設定ならオーナーは「オーナー」、ゲストは「ゲスト-<uid の先頭 4 文字>」。色は uid から決まる(同じ uid は常に同じ色)。参加時の `members/{uid}.name` にも同じ規則を使う(指定があればそれ、無ければ設定の表示名、無ければ既定)。
- **読み取り課金**: 在席の購読は、メンバー数×書き込み(30 秒ごと)の分だけ読み取りが増える(5 人で約 600 回/時間)。ルールの `isMember` 判定の `get()` も書き込みごとに 1 回かかる。

### 他者のカーソル(段階 4)

**ルールの変更は無い**(presence のフィールドは元々検証しておらず、`cursor` を足してもルールテストの結果は変わらない)。`cursor` は既存の presence 文書のフィールドとして書く。

- **形**: `cursor: { anchor, head } | null`。`anchor` / `head` は `Y.RelativePosition` を JSON にしたもの(`{ tname: 'content', item: { client, clock }, assoc }`。末尾は `item` 無し)。クラスのインスタンスを含まない素のオブジェクトにしてから書く(Firestore は ID クラスのインスタンスを受け付けない)。選択の向きは持たず、`anchor` = 選択の始点・`head` = 終点(キャレットは `head` に描く)。`null` はフォーカスが無い・送らない設定・シーンを開いていない。
- **書く**(`services/presence.service.ts`、間引きは `crdt/remoteCursor.ts` の `createCursorThrottle`): 選択の変化(`selectionchange`。入力・クリック・矢印キーを含む)を rAF でまとめ、**3 秒以上あけて**書く。間隔内の変化は最後の位置だけを trailing で送り、同じ位置は書かない。エディタがフォーカスを失って 0.6 秒たったら `null` を送る(これも間引きの対象)。30 秒ごとの在席の書き込み・シーン切り替えの書き込みにも最新の `cursor` を載せる(シーン切り替えでは `null`)。IME の変換中と、リモートの更新が DOM に入る前は座標がずれるので、送るのを待つ。
- **読む・描く**(`components/editor/RemoteCursors.svelte`): 既存の購読の結果から、自分を除き・90 秒以内で・同じシーンを開いていて・`cursor` を持つ人だけ描く(viewer も見える)。`Y.createAbsolutePositionFromRelativePosition` で今の絶対インデックスに直し(間に入った編集には追従する)、`locateTextOffset`(`textOffsetAt` と同じ数え方)で DOM 位置にして `Range.getClientRects` で矩形を取る。本文のレイアウトに影響しない `position:absolute` / `pointer-events:none` / `aria-hidden` のオーバーレイで、本文と一緒にスクロールする。キャレットは 2px の線、名前ラベルは位置が変わってから約 2 秒だけ濃く、その後は淡くする。再計算は rAF でまとめ、リモート更新・本文の DOM の変化・リサイズ・フォント/テーマ変更で行う。エディタが縦書き(`writing-mode` が `horizontal-tb` 以外)のときは描かない(現在のエディタ本文に縦書きは無く、プレビューのみ)。
- **設定**: 設定画面「共同編集のカーソル表示」の「他の人のカーソルを表示」(`AppSettings.showRemoteCursors`。既定オン、端末内の IndexedDB にだけ保存)。**オフの間は描画せず、自分のカーソルも送らない**(通信量の節約。相手からはカーソルが見えなくなるが、在席チップ・シーン一覧の点は変わらない)。エディタを開き直したときに反映される。

### crdtDocs の後始末

`crdtDocs` の行は、シーンの削除・章の削除・プロジェクトの削除(`db/*.ts`)と、共有の停止・退出・アクセス失効(`sceneText.service: discardProjectCrdtState`)のときに削除する。開いている文書は `DocManager.discard` で以後 購読・送信・保存・ミラーをしなくなる(`Scene.content` は残る)。共有の停止の前には開いているシーンの本文をミラー・送信する(`flushOpenSceneDocs`)。
