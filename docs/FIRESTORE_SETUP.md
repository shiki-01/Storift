# Firestore セットアップガイド

## 重要な変更

このアプリは**共有コレクション方式**を使用しています。
同じFirebase設定を使用するすべてのブラウザ・端末で、データがリアルタイムに同期されます。

## データ構造

```
projects/
  {projectId}/
    - id
    - title
    - description
    - createdAt
    - updatedAt
    - syncedAt
    - _lastModifiedBy

chapters/
  {chapterId}/
    - id
    - projectId
    - title
    - ...

scenes/
  {sceneId}/
    - id
    - chapterId
    - projectId
    - content
    - ...
```

ユーザー別の分離はなく、認証済みであれば全データにアクセスできます。

## セキュリティルールの設定

Firebase Consoleで以下の手順を実行してください:

1. **Firebase Console** (https://console.firebase.google.com/) を開く
2. プロジェクトを選択
3. 左メニューから **Firestore Database** を選択
4. **ルール** タブをクリック
5. リポジトリの [`firestore.rules`](../firestore.rules) の内容をコピー＆ペースト(アプリは読み込まないため、Console への貼り付けが必要です。以下は同じ内容です):

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    // 同期に使うコレクションだけを、認証済みユーザー(匿名認証を含む)に許可する。
    // ユーザーごとの分離はしない。同じ Firebase 設定を読み込んだ端末が同じデータを共有する。
    match /{collection}/{document=**} {
      allow read, write: if request.auth != null
        && collection in ['projects', 'chapters', 'scenes', 'characters', 'plots', 'worldbuilding'];
    }
    // 上記以外は拒否される(既定)
  }
}
```

認証済み(匿名認証を含む)で、同期に使う 6 つのコレクションだけを許可し、それ以外は拒否します。事前に Authentication で「匿名」プロバイダを有効にしてください。

6. **公開** をクリック

## 動作確認

1. ChromeとEdgeで同じFirebase設定を入力
2. 両方とも「保存して開始」をクリック
3. 片方のブラウザでプロジェクトを作成
4. もう片方のブラウザに即座に表示されることを確認

## トラブルシューティング

### データが同期されない場合

1. **ブラウザのDevToolsを開く** (F12)
2. **Console** タブを確認してエラーメッセージを探す
3. よくあるエラー:
   - `Missing or insufficient permissions` → Firestoreルールが正しく設定されていない
   - `Auth not initialized` → ページをリロードしてみる

## セキュリティについて

現在の実装では、同じFirebase設定を持つすべてのユーザーがデータを共有します。
これは個人用途や信頼できるメンバー間での使用を想定しています。

より強固なアクセス制御が必要な場合は、以下のいずれかを実装してください:

1. **メール/パスワード認証**: ユーザーごとにデータを分離
2. **招待制システム**: プロジェクトごとにアクセス権限を管理
3. **共有キー**: プロジェクトごとに共有キーを設定し、キーを持つユーザーのみアクセス可能

## 開発者向け情報

### リアルタイム同期の仕組み

1. `setupRealtimeSync()` が `onSnapshot()` でコレクション全体を監視
2. Firestoreで変更があると即座にコールバックが呼ばれる
3. ローカルのIndexedDBとStoreを更新
4. UIが自動的に再レンダリング

### オフライン対応

Firestoreの `persistentLocalCache` により、オフライン時も以下が可能:

- ローカルキャッシュからの読み取り
- 変更の一時保存（オンライン復帰時に自動同期）
- 競合の自動解決
