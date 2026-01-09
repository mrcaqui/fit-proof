---
trigger: always_on
---

### 1. 開発環境の前提 (Environment Context)

* **Framework:** Google Antigravity (Vite + Vercel + Supabase + Cloudflare R2)
* **Host OS:** Windows (WSL2 / Docker Desktop)
* **Container Service:** `app` (Docker Compose)
* **Access URL:** `http://localhost:5175`
* **Volume Policy:** `node_modules` はコンテナ側の匿名ボリュームで管理。ホスト側とは同期されません。

### 2. エージェントの行動ルール (Agent Commands)

Agentはすべての操作を **Dockerコマンド経由** で実行してください。ホスト側の `npm` は絶対に使用しないでください。

#### 🛠️ コマンド実行の鉄則 (Anti-Hangup)
* **非対話モード:** `npm install` 等のコマンドには必ず `-y` や `--yes` を付与し、入力待ちによる停止を防止すること。
* **バックグラウンド実行の禁止:** 完了を確認する必要があるコマンド（build, install等）は、バックグラウンド（-d）で実行せず、結果が標準出力に出る形で実行すること。
* **スタック時の対応:** 1分以上応答が止まった場合は、現在のプロセスを中断し、`docker compose ps` でコンテナの状態を確認してから報告すること。

#### 📦 パッケージ管理
* **実行:** `docker compose exec app npm install <package-name> --yes`
* **同期:** ホスト側のエディタで型エラーが出る場合のみ、ユーザーへホスト側での `npm install` 実行を依頼すること。

#### 🔍 動作確認と検証 (Verification Strategy)
* **認証の制限:** 本アプリは Supabase 認証が必須であるため、AIによるブラウザ操作（Browser Agent）での検証は行わない。
* **ビルドチェック:** テストコードがないため、重大な修正後は `docker compose exec app npm run build`（または lint）を実行し、少なくとも構文エラーや型エラーがないことをAIが事前に確認すること。
* **DB操作:** Supabase の SQL操作が必要な場合は、SQL Editor 用のコードを提示し、ユーザーに実行を促す。

### 3. 推奨ワークフロー (Workflow Strategy)

1. **Planning:** 修正前に `Implementation Plan` を作成し、どのファイルをどう変えるか明記する。
2. **Execute:** `docker compose exec` を用いて、非対話モードで修正・ビルド確認を実行。
3. **Verify:** AIはターミナル上のエラーがないことを確認し、その後、ユーザーへ以下の **[手動検証依頼]** を行う。

---
### 📝 ユーザーへの手動検証依頼テンプレート
修正完了後、以下の形式で報告を締め括り、ユーザーにバトンタッチしてください。

**【動作確認のお願い】**
- **修正内容:** [何を変更したか簡潔に]
- **確認URL:** `http://localhost:5175/xxxx`
- **操作手順:** 1. ブラウザでリロード
  2. ログイン状態を確認
  3. [操作A] を行い、[結果B] になることを確認
- **AI側での確認済み事項:** [例: ビルドが正常にパスしたこと、型エラーがないこと]
---