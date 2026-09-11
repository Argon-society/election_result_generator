# Election Map Studio — Premium Prototype

GitHub Pagesで動作する静的な選挙結果地図ジェネレーターです。

## v3 Premiumで重点的に改善

- UIを全面整理：5段階の設定フロー、状態表示、レスポンシブ対応
- GeoJSONのクリック読み込み＋ドラッグ＆ドロップ
- 得票数入力 / 当選者直接設定を明確に切替
- 小選挙区・複数人区・比例代表
- 比例代表：D'Hondt / Sainte-Laguë
- 議席ボール表示、選挙区名、得票率表示の個別ON/OFF
- 地図選択時の強調表示
- ズーム、100%リセット、地図フィット
- SVG書き出し時に表示用CSSもSVG内部へ埋め込み
- LF固定用 `.gitattributes`

## 配置

`index.html` をGitHubリポジトリのルートに置きます。

```text
repo/
├── index.html
├── app.js
├── style.css
├── .gitattributes
├── .nojekyll
└── data/
    ├── parties.json
    └── okayama-sample.geojson
```

## 注意

現在の岡山県サンプルはデモ用の簡略化GeoJSONであり、実際の選挙区境界ではありません。

また、比例代表の現在の計算は「各GeoJSON選挙区を比例単位とする」デモ実装です。全国比例・ブロック比例、名簿式、候補者別結果、惜敗率などは今後の拡張対象です。

ローカルで `file://` から直接開くと、ブラウザのfetch制限によりデータを読み込めない場合があります。ローカルHTTPサーバーを使用してください。

```bash
python -m http.server 8000
```
