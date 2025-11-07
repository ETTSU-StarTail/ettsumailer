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
sudo ln -sf /usr/lib/x86_64-linux-gnu/pkgconfig/javascriptcoregtk-4.1.pc \
    /usr/lib/x86_64-linux-gnu/pkgconfig/javascriptcoregtk-4.0.pc
sudo ln -sf /usr/lib/x86_64-linux-gnu/pkgconfig/webkit2gtk-4.1.pc \
    /usr/lib/x86_64-linux-gnu/pkgconfig/webkit2gtk-4.0.pc
sudo ln -sf /usr/lib/x86_64-linux-gnu/pkgconfig/webkit2gtk-web-extension-4.1.pc \
    /usr/lib/x86_64-linux-gnu/pkgconfig/webkit2gtk-web-extension-4.0.pc

sudo ln -sf /usr/lib/x86_64-linux-gnu/libjavascriptcoregtk-4.1.so \
    /usr/lib/x86_64-linux-gnu/libjavascriptcoregtk-4.0.so
sudo ln -sf /usr/lib/x86_64-linux-gnu/libwebkit2gtk-4.1.so \
    /usr/lib/x86_64-linux-gnu/libwebkit2gtk-4.0.so
```

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
システム依存関係 (特に GTK と WebKit 関連) が不足している可能性があります。
上記の「システム依存関係のインストール」セクションを参照して必要なパッケージをインストールしてください。

### WebKit2GTK のバージョン問題

Ubuntu 24.04 などの新しいディストリビューションでは WebKit2GTK 4.0 が削除され 4.1 のみが提供されています。
Tauri v1 は 4.0 を期待しているため、上記のシンボリックリンクの作成が必要です。

## 参考資料

- [Tauri Prerequisites](https://tauri.app/v1/guides/getting-started/prerequisites)
- [Rust Installation](https://www.rust-lang.org/tools/install)
