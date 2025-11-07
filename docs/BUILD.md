# ビルドガイド

このドキュメントでは、ettsumailer のビルド方法について説明します。

## 前提条件

- Rust (1.70 以上推奨)
- Node.js (LTS バージョン推奨)
- システム依存関係 (OS ごとに異なる)

## システム依存関係のインストール

### Ubuntu 24.04 / Debian 系

```bash
# 必要なシステムライブラリをインストール
sudo apt-get update
sudo apt-get install -y \
    libgtk-3-dev \
    libwebkit2gtk-4.1-dev \
    libappindicator3-dev \
    librsvg2-dev \
    patchelf \
    libsoup2.4-dev

# WebKit2GTK 4.0 互換性のためのシンボリックリンクを作成
# (Tauri v1 は WebKit2GTK 4.0 を期待しているが、Ubuntu 24.04 には 4.1 しかないため)
# 以下のスクリプトは自動的にアーキテクチャを検出します

ARCH=$(dpkg --print-architecture)
PKG_CONFIG_DIR="/usr/lib/${ARCH}-linux-gnu/pkgconfig"
LIB_DIR="/usr/lib/${ARCH}-linux-gnu"

# シンボリックリンクを作成する前に必要なファイルが存在するか確認
if [ ! -f "${PKG_CONFIG_DIR}/javascriptcoregtk-4.1.pc" ]; then
    echo "エラー: javascriptcoregtk-4.1.pc が見つかりません。libwebkit2gtk-4.1-dev をインストールしてください。"
    exit 1
fi

sudo ln -sf ${PKG_CONFIG_DIR}/javascriptcoregtk-4.1.pc \
    ${PKG_CONFIG_DIR}/javascriptcoregtk-4.0.pc
sudo ln -sf ${PKG_CONFIG_DIR}/webkit2gtk-4.1.pc \
    ${PKG_CONFIG_DIR}/webkit2gtk-4.0.pc
sudo ln -sf ${PKG_CONFIG_DIR}/webkit2gtk-web-extension-4.1.pc \
    ${PKG_CONFIG_DIR}/webkit2gtk-web-extension-4.0.pc

sudo ln -sf ${LIB_DIR}/libjavascriptcoregtk-4.1.so \
    ${LIB_DIR}/libjavascriptcoregtk-4.0.so
sudo ln -sf ${LIB_DIR}/libwebkit2gtk-4.1.so \
    ${LIB_DIR}/libwebkit2gtk-4.0.so
```

**注意**: 上記のシンボリックリンクはシステム全体に影響を与える可能性があります。
他のアプリケーションが WebKit2GTK 4.0 を期待している場合、問題が発生する可能性があります。

シンボリックリンクを削除する場合:
```bash
ARCH=$(dpkg --print-architecture)
PKG_CONFIG_DIR="/usr/lib/${ARCH}-linux-gnu/pkgconfig"
LIB_DIR="/usr/lib/${ARCH}-linux-gnu"

sudo rm -f ${PKG_CONFIG_DIR}/javascriptcoregtk-4.0.pc
sudo rm -f ${PKG_CONFIG_DIR}/webkit2gtk-4.0.pc
sudo rm -f ${PKG_CONFIG_DIR}/webkit2gtk-web-extension-4.0.pc
sudo rm -f ${LIB_DIR}/libjavascriptcoregtk-4.0.so
sudo rm -f ${LIB_DIR}/libwebkit2gtk-4.0.so

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

- `libgtk-3-dev` がインストールされているか
- `libwebkit2gtk-4.1-dev` がインストールされているか
- pkg-config が正しく動作しているか (`pkg-config --list-all | grep gtk` で確認)

### WebKit2GTK のバージョン問題

Ubuntu 24.04 などの新しいディストリビューションでは WebKit2GTK 4.0 が削除され 4.1 のみが提供されています。
Tauri v1 は 4.0 を期待しているため、上記のシンボリックリンクの作成が必要です。

## 参考資料

- [Tauri Prerequisites](https://tauri.app/v1/guides/getting-started/prerequisites)
- [Rust Installation](https://www.rust-lang.org/tools/install)
