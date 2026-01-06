---
trigger: always_on
---

### 1. 開発環境の前提 (Environment Context)

* **Framework:** Google Antigravity
* **Host OS:** Windows (WSL2 / Docker Desktop)
* **Container Service:** `app` (Docker Compose)
* **Access URL:** `http://localhost:5175`
* **Volume Policy:** `node_modules` はコンテナ側の匿名ボリュームで管理されており、ホスト側とは同期されません（仕様です）。

### 2. エージェントの行動ルール (Agent Commands)

Agentは開発サーバーの起動、パッケージ操作、テストのすべてを **Dockerコマンド経由** で実行してください。ホスト側の `npm` は絶対に使用しないでください。

#### 🛠️ 基本操作

* **コンテナの起動:** `docker compose up -d`
* **コンテナの停止:** `docker compose down`
* **ログの監視:** `docker compose logs -f app`
* **コンテナ内へのコマンド実行:** `docker compose exec app <command>`

#### 📦 パッケージ管理

* **追加/更新:** 必ず `docker compose exec app npm install <package-name>` を使用してください。
* **注意:** これにより `/app/node_modules` (匿名ボリューム) が更新されます。ホスト側のエディタで型定義エラーが出る場合は、ユーザーにホスト側での `npm install` を促すか、Agentが並行して実行してください。

#### 🔍 動作確認と検証 (Verification)

* **Browser Agent の活用:** コード変更後は Antigravity の **Browser Agent** を起動し、 `http://localhost:5175` にアクセスして UI の正常性を確認してください。
* **ホットリロード:** `CHOKIDAR_USEPOLLING=true` が設定されているため、通常は自動反映されます。反映されない場合は `docker compose restart app` を試行してください。

### 3. 推奨ワークフロー (Workflow Strategy)

1. **Planning:** タスク開始前に `Implementation Plan` を作成し、どの Docker コマンドを使用するか明記する。
2. **Execute:** `docker compose exec` を用いて、環境の差異（Windows vs Linux）を無視して一貫した実行を行う。
3. **Verify:** ターミナルの終了ステータスだけでなく、実際に `Browser Agent` で描画を確認する。
