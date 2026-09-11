# Election Map Studio v2

GitHub Pages向けの静的な選挙結果地図ジェネレーターです。

## v2で追加したもの

- 選挙結果の設定方式を「当選者を直接設定」と「得票数から自動計算」から選択
- 小選挙区：最多得票
- 複数人区：上位得票
- 比例代表：D'Hondt方式
- 選挙区あたり議席数を変更可能
- 複数人区・比例区で、各議席を色付きボールとして地図上に表示
- SVG書き出し時にもボールを含めて保存
- 既存のGeoJSON読み込み・ズーム機能を維持

## GitHub Pages

`index.html` がリポジトリのルートに来るように配置してください。

```text
repo/
├── index.html
├── app.js
├── style.css
├── README.md
├── .nojekyll
└── data/
    ├── parties.json
    └── okayama-sample.geojson
```

Settings → Pages → Build and deployment → Deploy from a branch → `main` → `/ (root)`。

## 注意

現在の岡山県サンプルの地図は動作確認用の簡略化データです。実際の選挙区境界ではありません。

また、比例代表の配分は現在「選挙区単位のD'Hondt」を実装したデモです。将来的に全国比例、ブロック比例、名簿、当選者名、惜敗率、得票率などへ拡張できます。

ローカルで直接 `file://` から開くと `fetch()` が制限される場合があります。必要ならローカルHTTPサーバーを使ってください。

```bash
python -m http.server 8000
```
