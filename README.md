# Election Map Studio — GitHub Pages prototype

ブラウザだけで選挙結果地図を作るための最小実装です。

## 起動

GitHub Pagesにこのフォルダをそのまま配置できます。

ローカルで確認する場合は、`file://` ではなく簡易HTTPサーバーを使ってください。

```bash
python -m http.server 8000
```

その後 `http://localhost:8000/` を開きます。

## 現在できること

- 岡山県をモチーフにした5選挙区サンプルを表示
- 政党別の着色
- 各選挙区の政党変更
- 地図クリックで政党を順番に切替
- GeoJSON FeatureCollection の読み込み
- 選挙区IDの自動判定 / Feature.id / properties.name / properties.code
- ズーム
- SVG書き出し
- 地図、政党、選挙結果を別データとして扱う基本構造

## 注意

同梱の `data/okayama-sample.geojson` はUI開発用の**架空・簡略化されたサンプル選挙区**です。
実際の衆議院選挙区境界ではありません。

実データを使う場合は、適切なライセンス・出典表示を確認したGeoJSON/TopoJSONに差し替えてください。

日本の行政区域データについては、国土地理院・国土交通省等を出典とする公開データがあります。
例:
- https://github.com/dataofjapan/land
- https://github.com/biskwikman/jpn-atlas
