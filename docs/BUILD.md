# ビルドガイド

このドキュメントでは、ettsumailer のビルド方法について説明します。

## 前提条件

- Rust (1.70 以上推奨)
- Node.js (LTS バージョン推奨)
- システム依存関係 (OS ごとに異なる)

## システム依存関係のインストール

### Ubuntu 24.04 / Debian 系

**注意**: このプロジェクトは Tauri v2 を使用しており、WebKit2GTK 4.1 をネイティブでサポートしています。
シンボリックリンクの作成は不要です。

```bash
# 必要なシステムライブラリをインストール
sudo apt-get update
sudo apt-get install -y \
    libwebkit2gtk-4.1-dev \
    build-essential \
    curl \
    wget \
    file \
    libssl-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev

**代替方法**: システム全体を変更せずに、現在のプロジェクトだけで対応する方法もありますが、
Tauri v1 のビルドシステムの制約により、現時点ではシンボリックリンクを使用する方法が
最も確実です。将来的には Tauri v2 への移行を検討することをお勧めします。

### その他の OS

その他の OS でのシステム依存関係については、[Tauri の公式ドキュメント](https://tauri.app/v1/guides/getting-started/prerequisites)を参照してください。

## ビルド手順

### 1. 依存関係のインストール

```bash
# Node.js の依存関係をインストール
npm install

# Rust の依存関係は cargo build 時に自動的にインストールされます
```

### 2. バックエンドのビルド (Rust/Tauri)

```bash
cd src-tauri
cargo build
```

リリースビルドの場合:

```bash
cd src-tauri
cargo build --release
```

### 3. フロントエンドのビルド

```bash
npm run build
```

### 4. アプリケーション全体のビルド

```bash
npm run tauri build
```

## 開発モード

開発中は以下のコマンドでホットリロード付きで起動できます:

```bash
npm run tauri dev
```

## トラブルシューティング

### ビルドスクリプトのコンパイルエラー

`quote`, `proc-macro2`, `serde` などのビルドスクリプトのコンパイルエラーが発生する場合、
これらは通常、より根本的な問題の結果として現れます。

**原因**: これらのクレートは Rust のマクロやシリアライゼーションに使用される基本的なライブラリです。
直接的な問題ではなく、システム依存関係 (特に GTK と WebKit 関連) の不足によって発生する
**連鎖的な失敗**です。GTK や WebKit のビルドスクリプトが先に失敗すると、それらに依存する
これらのクレートのビルドも失敗します。

**解決方法**: 上記の「システム依存関係のインストール」セクションを参照して必要なパッケージを
インストールしてください。特に以下を確認:

- `libwebkit2gtk-4.1-dev` がインストールされているか
- pkg-config が正しく動作しているか (`pkg-config --list-all | grep webkit` で確認)

## 参考資料

- [Tauri v2 Prerequisites](https://tauri.app/start/prerequisites/)
- [Rust Installation](https://www.rust-lang.org/tools/install)
