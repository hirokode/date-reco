# Date Reco（AGENTS.md：このアプリ専用のルール）

共通ルールは `ai-rules/CODING_RULES.md`（正本 `hirokode/ai-rules` のコピー）。
このファイルには「このアプリにしか当てはまらないこと」だけを書く。

## アプリの概要

ふたり（アルバムのメンバー）でデートの思い出（写真・場所・日時・タイトル・ジャンル・費用・メモ）を記録し、地図と一覧で振り返る PWA。
**釣りの記録アプリ「Tsuri Reco」（hirokode/tsuri-reco）をコピーして作った。** 仕組み（招待トークン・GAS・スプシ・Drive）はそのまま。

### Tsuri Reco から引き継いだ列の使い方（列名は変えていない）

| 列 | このアプリでの意味 |
|---|---|
| catches（シート） | 思い出（1件＝1か所の思い出） |
| species | タイトル（必須） |
| method | ジャンル（食事・カフェ など） |
| weight_g | 費用（円） |
| memo | 思い出メモ |
| angler_member_id | 記録した人（画面では選ばない） |
| size_cm・count・tide_name・tide_events・bait・hits | 使わない（count は常に1） |
| trips（シート）・trip_id | 使わない（釣行の機能は画面から外した） |

- js/tide.js・js/astro.js・js/trip.js と app.js の潮表・釣行の画面はコードに残っているが、タブから外していて使わない（潮位表のデータ data/tide/ は持っていない）
- 同じ GitHub Pages（hirokode.github.io）に Tsuri Reco もいるので、**localStorage のキーは `dr.`、キャッシュ名は `date-` で始める**（Tsuri Reco の `tr.`・`shell-`・`img-` とぶつけない）

## 構成

```
スマホのブラウザ ── GitHub Pages（index.html / app.js / style.css / config.js / sw.js）
                      │ fetch（POST, Content-Type: text/plain）
                      ▼
               GAS ウェブアプリ（gas/）
                      │
                      ├─ スプレッドシート（albums / members / catches）
                      └─ Google Drive（アルバムごとの写真フォルダ）
```

- 画面は GitHub Pages（`https://hirokode.github.io/date-reco/`）。`google.script.run` は使えないので `fetch` で `/exec` を呼ぶ
- `config.js` の `API_URL`（`/exec` のURL）は画面が読むため公開される。**共通ルール §6 の例外として、この値だけはコミットしてよい**
- ライブラリ（Leaflet など）は CDN 読み込み。ビルド工程は作らない

## 認証（招待トークン方式）

- **合言葉方式（NEW_APP.md）は使わない。** リポジトリが Public なので、画面側に共通の秘密を置かない
- アルバムのメンバーごとにトークン（ランダム文字列）を発行し、招待リンク `?invite=<トークン>` で配る
- 画面はトークンを localStorage に保存し、API を呼ぶたびに送る
- GAS は毎リクエストでトークンを検証し、**そのトークンが属するアルバムのデータだけ**を返す・変更する
- トークンはスプレッドシートの members シートにだけある。コード・コミット・チャットに実際の値を書かない

## ファイル構成

| ファイル | 役割 |
|---|---|
| index.html | 画面の骨組み（CDN のライブラリは SRI 付きで読み込む） |
| style.css | 見た目 |
| js/app.js | 画面の切り替え（`#/…`）と各画面の処理 |
| js/api.js | GAS の呼び出し・端末（localStorage）への保存 |
| js/photos.js | 撮影日時の読み取り・圧縮・写真URLの組み立て（1か所） |
| js/map.js | Leaflet の地図（レイヤー切替・クラスタ・長押し・ピン指定） |
| config.js | GAS の `/exec` URL（API_URL）だけを書く |
| sw.js / manifest.json / icons/ | PWA（ホーム画面追加・画像キャッシュ） |
| gas/Code.js | doGet / doPost・API の振り分け・`setup()` |
| gas/Api.js | 各 API の中身・トークン確認・入力チェック |
| gas/Db.js | スプシ・Drive フォルダの自動作成と読み書き |
| gas/Photos.js | 写真の保存（EXIF などのメタデータを取り除いてから保存） |
| .claude/launch.json | ローカル確認用サーバー（`python -m http.server 8123`） |
| .github/workflows/deploy-gas.yml | gas/ の変更を main に入れると自動で push＋既存デプロイ上書き |
| ai-rules/CODING_RULES.md | 共通ルールのコピー |
| setup-pc.ps1 | PC での最初の準備（GAS 作成・公開・承認の案内・config.js・Secrets・Pages）。何度実行してもよい |

## デプロイ

- 最初の1回だけ：PC で `setup-pc.ps1` を実行する（GAS プロジェクトの作成〜GitHub Secrets・Pages の設定まで）

- 画面：main に入ると GitHub Pages に1〜2分で反映
- サーバー：`gas/` の変更が main に入ると GitHub Actions が `clasp push` → `clasp deploy -i <本番デプロイID>` を実行
- 手元（PC）で直接やる場合：`cd "C:\Users\hiro2\dev\apps\date-reco\gas"; clasp push -f; if ($?) { clasp deploy -i <デプロイID> -d "<変更メモ>" }`
- デプロイIDなどの実際の値は `アプリURL.txt`（.gitignore 済み）と GitHub Secrets にだけある
- 画面（app.js など）を変えたら `sw.js` の `CACHE_VERSION` を上げる（古い画面がキャッシュに残らないように）

## スクリプトプロパティ

どちらも初回リクエスト時に GAS が自動で作って保存する。手で設定する必要はない。

| 名前 | 中身 |
|---|---|
| SPREADSHEET_ID | データ保存用スプレッドシートのID |
| ROOT_FOLDER_ID | 写真保存用 Drive フォルダ（アルバム別フォルダの親）のID |

## スプレッドシートの構成

| シート | 列 |
|---|---|
| albums | album_id, name, created_at, drive_folder_id, icon_photo |
| members | member_id, album_id, display_name, token, joined_at |
| catches | catch_id, album_id, caught_at, lat, lng, place_name, species, size_cm, weight_g, count, angler_member_id, tide_name, tide_events, method, bait, memo, photo_ids, created_by, created_at, updated_by, updated_at, deleted, hits, trip_id, loc_source, draft |
| trips | trip_id, album_id, member_id, started_at, ended_at, start_lat, start_lng, end_lat, end_lng, points, auto_ended, created_at, updated_at, deleted |

- ID は UUID。削除は論理削除（deleted=true）
- tide_events・photo_ids・icon_photo・hits・points は JSON 文字列
- 写真は {f, t, at}（f＝原寸・t＝サムネの Drive ファイルID、at＝撮影時刻（あれば）。位置は持たない）
- loc_source は位置の出どころ（このアプリでは manual＝手動だけ）。draft は使わない
- 位置（lat・lng）と場所名（place_name）は思い出1件につき1つ

## このアプリ固有のルール

- 列を増やすときは `gas/` のヘッダー定義と既存シートの見出し行の両方を更新する（既存の列の順番は変えない）
- 写真の位置情報（EXIF の GPS）は使わない。位置は地図・現在地・緯度経度で手動で決める
- 写真の表示URLの組み立ては `js/photos.js` の `photoUrl()` にまとめる（将来の保存先移行に備えるため）
- 写真は位置情報を使わない・残さない。画面側は canvas で描き直して EXIF を落とし、GAS 側でも `stripJpegMetadata_()` で取り除いてから保存する
- ユーザーが入力した文字を画面に出すときは必ず `esc()` を通す（トークンを盗まれないように）
- API を追加・変更したら、トークンの確認（`auth_()`）で「そのアルバムのデータだけ」になっているか確かめる
- 画面とサーバーを同時に変えるときは、新しい画面が古いサーバーを呼んでも壊れないように作る

## スマホ（クラウド版）から頼まれたときの進め方

ユーザーは「〇〇を直して」のような普段の言葉だけで頼む。次の流れを、確認を待たずに最後まで自動で行う。

1. 依頼内容を実装する（画面を変えたら sw.js の CACHE_VERSION を上げる）
2. 構文チェックをする（js/*.js・sw.js・gas/*.js を node --check）
3. claude/… ブランチにコミットして push し、Pull Request を作る
4. PR を main にマージする
5. 反映を確認する（GitHub Pages の更新、gas/ を変えたときは Actions「GASにデプロイ」が成功したか）
6. 最後に「何を変えたか」と「スマホでどう確認すればよいか」を短く伝える

ただし、次の場合はマージの前に必ずユーザーに確認する：
- スプレッドシートの列の変更や、既存データの書き換えを伴うとき
- 認証（招待トークン）の仕組みを変えるとき
- GAS に新しい権限（oauthScopes）が必要になるとき → PC で setup を ▶実行して承認し直す必要があるため、その手順も伝える

Actions が失敗したら、ログを読んで直せるものは直して、もう一度 PR を作る。
認証エラー（clasp の認証切れ）の場合だけは直せないので、PC での clasp login と CLASPRC_JSON の再登録をユーザーに依頼する。
