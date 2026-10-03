# Date Reco：PC での最初の準備（1回だけ。途中で止まっても、もう一度実行すれば続きから進む）
#  1. GAS プロジェクトを作って公開する（clasp create → push → deploy）
#  2. ブラウザで承認してもらう（setup を ▶実行）
#  3. config.js に /exec の URL を入れて GitHub に送る
#  4. 自動デプロイ用の GitHub Secrets と GitHub Pages を設定する（gh があれば自動、無ければ案内）
# ID・URL は アプリURL.txt（.gitignore 済み）に控える。
# 使い方：このフォルダで  powershell -ExecutionPolicy Bypass -File .\setup-pc.ps1

# 外部コマンド（clasp・git・gh）の失敗は $LASTEXITCODE で見る（Stop にすると、PowerShell 5.1 では標準エラーへの出力だけで止まるため）
$ErrorActionPreference = 'Continue'
$Repo = 'hirokode/date-reco'
$Root = $PSScriptRoot
$Gas = Join-Path $Root 'gas'
$MemoFile = Join-Path $Root 'アプリURL.txt'
$ClaspRc = Join-Path $HOME '.clasprc.json'
$Utf8 = New-Object System.Text.UTF8Encoding($false)

function Step($msg) { Write-Host ''; Write-Host "== $msg ==" -ForegroundColor Cyan }
function Pause-Until($msg) { Read-Host "$msg`n終わったら Enter を押してください" | Out-Null }
function Memo($key) {
  if (-not (Test-Path $MemoFile)) { return $null }
  $line = [IO.File]::ReadAllLines($MemoFile, $Utf8) | Where-Object { $_ -like "${key}: *" } | Select-Object -First 1
  if ($line) { return $line.Substring($key.Length + 2).Trim() }
  return $null
}

if (-not (Get-Command clasp -ErrorAction SilentlyContinue)) { throw 'clasp が見つかりません。npm install -g @google/clasp を実行してから、もう一度試してください' }
if (-not (Test-Path $ClaspRc)) { throw 'clasp にログインしていません。clasp login を実行してから、もう一度試してください' }

# ---------- 1. GAS プロジェクトを作って公開する ----------
Set-Location $Gas
if (-not (Test-Path '.clasp.json')) {
  Step 'GAS プロジェクトを作ります'
  $manifest = [IO.File]::ReadAllText((Join-Path $Gas 'appsscript.json'), $Utf8)
  clasp create --type webapp --title 'Date Reco' --rootDir .
  if ($LASTEXITCODE -ne 0) { throw 'clasp create に失敗しました' }
  # clasp create は appsscript.json を空のものに置きかえるので、元に戻す
  [IO.File]::WriteAllText((Join-Path $Gas 'appsscript.json'), $manifest, $Utf8)
}
$ScriptId = (Get-Content '.clasp.json' -Raw | ConvertFrom-Json).scriptId

Step 'コードを GAS に送ります'
clasp push -f
if ($LASTEXITCODE -ne 0) { throw 'clasp push に失敗しました' }

$DeployId = Memo 'デプロイID'
if ($DeployId) {
  Step '公開を更新します（URL は変わりません）'
  clasp deploy -i $DeployId -d 'setup-pc'
  if ($LASTEXITCODE -ne 0) { throw 'clasp deploy に失敗しました' }
} else {
  Step 'ウェブアプリとして公開します'
  $out = (clasp deploy -d '最初の公開' 2>&1 | Out-String)
  Write-Host $out
  if ($out -notmatch '(AKfy[\w-]{20,})') { throw 'デプロイIDが読み取れませんでした（上の表示を確認してください）' }
  $DeployId = $Matches[1]
}
$ApiUrl = "https://script.google.com/macros/s/$DeployId/exec"
[IO.File]::WriteAllText($MemoFile, "スクリプトID: $ScriptId`r`nデプロイID: $DeployId`r`nAPI_URL: $ApiUrl`r`nアプリ: https://hirokode.github.io/date-reco/`r`n", $Utf8)

# ---------- 2. 承認（ブラウザでしかできない） ----------
function Test-Api {
  try { return ((Invoke-WebRequest -Uri $ApiUrl -UseBasicParsing -TimeoutSec 60).Content -match '"app":"date-reco"') } catch { return $false }
}
if (-not (Test-Api)) {
  Step 'ブラウザで承認してください'
  Start-Process "https://script.google.com/d/$ScriptId/edit"
  Write-Host '開いた Apps Script の画面で：'
  Write-Host '  1. 上の関数の選択で「setup」を選んで ▶実行'
  Write-Host '  2. 「権限を確認」→ 自分のアカウント → 「詳細」→「Date Reco（安全ではないページ）に移動」→「許可」'
  Write-Host '  3. 下の実行ログに「準備ができました」と出たら完了'
  Pause-Until ''
  if (-not (Test-Api)) { Write-Host '※ まだ API が応答しません。数分おいて、もう一度このスクリプトを実行してください' -ForegroundColor Yellow; exit 1 }
}
Write-Host 'API の応答を確認しました' -ForegroundColor Green

# ---------- 3. config.js に URL を入れて GitHub に送る ----------
Set-Location $Root
$cfgPath = Join-Path $Root 'config.js'
$cfg = "// GAS ウェブアプリの /exec URL。画面が読むため公開される（共通ルール §6 の例外）`nwindow.APP_CONFIG = {`n  API_URL: `"$ApiUrl`"`n};`n"
if ([IO.File]::ReadAllText($cfgPath, $Utf8) -ne $cfg) { [IO.File]::WriteAllText($cfgPath, $cfg, $Utf8) }
# 前回コミットに失敗していても送れるように、ファイルではなく git の状態で決める
if (git status --porcelain -- config.js) {
  Step 'config.js に URL を入れて GitHub に送ります'
  git add config.js
  git commit -m 'config.js に GAS の URL を設定'
  if ($LASTEXITCODE -ne 0) { throw 'git commit に失敗しました（git config --global user.name / user.email を設定して、もう一度実行してください）' }
}
git push origin main
if ($LASTEXITCODE -ne 0) { throw 'git push に失敗しました（GitHub へのログインを確認して、もう一度実行してください）' }

# ---------- 4. GitHub Secrets と GitHub Pages ----------
$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($gh) { gh auth status *> $null; if ($LASTEXITCODE -ne 0) { $gh = $null } }
if ($gh) {
  Step 'GitHub Secrets と GitHub Pages を設定します'
  cmd /c "gh secret set CLASPRC_JSON -R $Repo < `"$ClaspRc`""
  gh secret set GAS_SCRIPT_ID -R $Repo --body $ScriptId
  gh secret set GAS_DEPLOYMENT_ID -R $Repo --body $DeployId
  gh api -X POST "repos/$Repo/pages" -f 'source[branch]=main' -f 'source[path]=/' *> $null
} else {
  Step 'GitHub Secrets を3つ登録してください（値はクリップボードに入れます）'
  $secrets = @(
    @{ Name = 'CLASPRC_JSON'; Value = [IO.File]::ReadAllText($ClaspRc) },
    @{ Name = 'GAS_SCRIPT_ID'; Value = $ScriptId },
    @{ Name = 'GAS_DEPLOYMENT_ID'; Value = $DeployId }
  )
  foreach ($s in $secrets) {
    Set-Clipboard -Value $s.Value
    Start-Process "https://github.com/$Repo/settings/secrets/actions/new"
    Pause-Until "Name に「$($s.Name)」と入れ、Secret 欄に貼り付け（Ctrl+V）て「Add secret」"
  }
  Set-Clipboard -Value ' '
  Step 'GitHub Pages をオンにしてください'
  Start-Process "https://github.com/$Repo/settings/pages"
  Pause-Until '「Branch」を main・/(root) にして「Save」'
}

Step '完了'
Write-Host '1〜2分後に、スマホで https://hirokode.github.io/date-reco/ を開いてください' -ForegroundColor Green
