# NyaitterIME

NyaitterIME は、ローマ字を日本語へ変換する JavaScript パッケージです。

入力は端末内で処理され、変換のために外部 API へ文章を送信しません。Node.js とブラウザの両方で利用できます。

```text
kyouhaiitenkidesune
↓
今日はいい天気ですね
```

## インストール

```bash
npm install nyaitter-ime
```

## 基本的な使い方

### Node.js

```js
const { convert, toHiragana } = require('nyaitter-ime');

console.log(convert('kyouhaiitenkidesune'));
// 今日はいい天気ですね

console.log(toHiragana('kyouhaiitenkidesune'));
// きょうはいいてんきですね
```

ES Modules でも利用できます。

```js
import { convert, toHiragana } from 'nyaitter-ime';
```

### ブラウザ / CDN

```html
<script src="https://cdn.jsdelivr.net/npm/nyaitter-ime@0.1.3/dist/nyaitter-ime.min.js"></script>
<script>
  NyaitterIME.ready.then(() => {
    console.log(NyaitterIME.convert('kyouhaiitenkidesune'));
    // 今日はいい天気ですね
  });
</script>
```

辞書を使う `convert()` は `NyaitterIME.ready` の完了後に呼び出してください。

`toHiragana()` は辞書の読み込み前でも利用できます。

```js
console.log(NyaitterIME.toHiragana('neko'));
// ねこ
```

## 主な機能

### 日本語変換

`convert()` はローマ字入力をかなへ変換し、辞書から第1候補を返します。

```js
convert('saikinnnekowonadetayo');
// 最近猫を撫でたよ
```

Mozc OSS の辞書データと接続コストを利用しています。

### ひらがな変換

`toHiragana()` はローマ字をひらがなへ変換します。

```js
toHiragana('neko');
// ねこ
```

英単語は可能な範囲でそのまま残します。

```js
convert('saikinOpenAIhaDotswokoukaisita');
// 最近OpenAIはDotsを公開した
```

句読点や `-` などの記号も、前後が日本語か英語かに合わせて変換します。

### カスタム辞書

独自の読みと表記を追加できます。

```js
const { convert } = require('nyaitter-ime');

const result = convert('nyaitter', {
  customDictionary: [
    { reading: 'にゃいったー', surface: 'Nyaitter' }
  ]
});
```

`reading` はひらがなまたはカタカナで指定できます。`cost` を指定すると候補の優先度も調整できます。値が小さいほど優先されます。

### 変換しない文字列

Markdown 記号や固有の文字列など、変換対象から外したい文字列は `ignoredTexts` で指定できます。

```js
convert('text#tag', {
  ignoredTexts: ['#', '*', '_', '~', '`']
});
```

大文字と小文字は区別されます。指定が重なる場合は長い文字列が優先されます。

### 連続入力

入力中の文字列を繰り返し変換する場合は `createSession()` を使います。前回までの解析結果を再利用するため、長い入力でも処理量を抑えられます。

```js
const { createSession } = require('nyaitter-ime');

const session = createSession();

session.convert('ne');
session.convert('neko');
// 猫

session.reset();
```

ブラウザでは `NyaitterIME.ready` の完了後に利用できます。

```js
await NyaitterIME.ready;
const session = NyaitterIME.createSession();
```

## Japanizer

設定をまとめて再利用したい場合は `Japanizer` を使えます。

```js
const { Japanizer } = require('nyaitter-ime');

const ime = new Japanizer({
  ignoredTexts: ['#'],
  customDictionary: [
    { reading: 'にゃいったー', surface: 'Nyaitter' }
  ]
});

ime.convert('nyaitter');
ime.toHiragana('neko');
```

## API

- `convert(text, options?)` — ローマ字を日本語へ変換します。
- `toHiragana(text, options?)` — ローマ字をひらがなへ変換します。
- `createSession(options?)` — 連続入力向けの変換セッションを作成します。
- `new Japanizer(options?)` — 設定を保持する変換インスタンスを作成します。
- `Romanizer` — ローマ字からかなへの変換を扱います。
- `Converter` — 辞書を使った候補選択を扱います。
- `Dictionary` / `RuntimeDictionary` — 辞書を扱います。

ブラウザ版では `NyaitterIME.ready`、`NyaitterIME.convert()`、`NyaitterIME.toHiragana()`、`NyaitterIME.createSession()` を利用できます。

## 開発

```bash
npm run build
npm test
npm run pack:check
```

辞書を再生成する場合は Mozc のチェックアウト先を指定します。

```bash
npm run update-dict -- path/to/mozc
```

## ライセンス

NyaitterIME 本体は MIT License で公開されています。

辞書などの第三者由来データについては [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)、[LICENSE-MOZC](LICENSE-MOZC)、[LICENSE-ESDB](LICENSE-ESDB) を参照してください。
