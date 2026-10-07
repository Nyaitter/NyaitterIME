# NyaitterIME

ローマ字入力をローカルで日本語へ変換する JavaScript パッケージです。Mozc OSS の辞書と接続コストを使い、IMEと同様に候補経路を評価して第1候補を返します。

## Node.js

公開はGitHub Actionsの `Publish to npm` が行います。`package.json` のバージョンを更新し、同じバージョンの `vX.Y.Z` タグをpushすると、ビルド・テスト後にnpmへ公開します。手動実行も可能です。認証にはリポジトリのActions secret `NPM_TOKEN` を使用します。同じバージョンの再公開はできません。

npm側でステージ公開になった場合は、所有者がnpmのStaged Packagesで2FA承認する必要があります。承認なしで自動公開するには、npmのパッケージ設定でGitHub ActionsのTrusted Publisherを `Nyaitter / NyaitterIME / publish.yml` に設定してください。ワークフローはOIDC用の権限も設定済みです。

```js
const { convert, toHiragana, Japanizer } = require('nyaitter-ime');

convert('kyouhaiitenkidesune');
// => 今日はいい天気ですね

toHiragana('kyouhaiitenkidesune');
// => きょうはいいてんきですね

const ime = new Japanizer();
ime.convert('neko');
// => 猫
ime.toHiragana('neko');
// => ねこ
```

`toHiragana()` はローマ字をかなに変換します。辞書が利用できる場合は英単語辞書と日本語変換辞書を使って英語区間を判別し、ロード前は従来の大文字英字判定で動作します。句読点やハイフンも前後の言語に合わせて扱います。


## Browser / CDN

連続入力には `const session = ime.createSession(options)` を使用し、`session.convert(text)` に更新後の入力全文を渡してください。共通の接頭部の判定経路と辞書評価を再利用します。`session.reset()` で保持した結果を破棄できます。ブラウザでは `NyaitterIME.ready` 完了後に `NyaitterIME.createSession(options)` を呼べます。

`ignoredTexts` に文字列の配列を指定すると、一致する区間をかな・漢字・記号変換から除外します。`convert(text, { ignoredTexts: ['*', '#', '_', '~', '`'] })` のように呼び出すか、`new Japanizer({ ignoredTexts: ['OpenAI'] })` で初期設定できます。大文字小文字を区別し、重複する指定は最長一致を優先します。

UMD bundle は npm CDN から読み込めます。辞書を使う `convert()` と辞書による英語判別は `ready` の完了後に利用できます。ロード前の `toHiragana()` は同期で使えますが、英語判別は大文字表記を手がかりにします。

```html
<script src="https://cdn.jsdelivr.net/npm/nyaitter-ime@0.1.0/dist/nyaitter-ime.min.js"></script>
<script>
  console.log(NyaitterIME.toHiragana('neko')); // ねこ

  NyaitterIME.ready.then(() => {
    console.log(NyaitterIME.convert('kyouhaiitenkidesune'));
    // 今日はいい天気ですね
  });
</script>
```

辞書データは同じ npm パッケージから読み込まれます。変換処理にサーバー側APIは使いません。

## API

- `convert(text, options?)`: ローマ字から第1候補へ変換
- `toHiragana(text, options?)`: ローマ字をかなへ変換し、辞書が利用できる場合は英語区間も判別
- `new Japanizer(options?)`: インスタンスAPI。`convert()` と `toHiragana()` を提供
- `Romanizer`, `Converter`, `Dictionary`, `RuntimeDictionary`: 拡張用コンポーネント
- Browser bundle: `NyaitterIME.ready`, `NyaitterIME.convert()`, `NyaitterIME.toHiragana()`

## Development

```bash
npm run build
npm test
npm pack --dry-run
```

辞書を再生成する場合は、Mozc リポジトリを別途取得し、チェックアウト先を渡します。

```bash
npm run update-dict -- path/to/mozc
```

辞書の由来とライセンスは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) と [LICENSE-MOZC](LICENSE-MOZC) を参照してください。
