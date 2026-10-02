# wiki

一个在终端里查看 Wikipedia 的小命令行工具：输入 `wiki xx`，自动搜索 xx 对应的维基页面，
抓取内容并格式化为 Markdown 后显示。使用 TypeScript 编写，通过 Bun 编译为单个可执行文件。

## 特性

- 🔎 关键词自动搜索（全文搜索，取最匹配的页面）
- 📝 页面转换为干净的 Markdown：标题、列表、GFM 表格、引用角标、绝对链接
- 🌐 多语言支持（默认简体中文，`--lang` 可切换；中文支持简/繁服务端转换）
- 📖 交互式终端下自动调用 `less` 分页；管道/重定向时输出纯文本
- ✨ 支持仅看摘要（`--summary`）

## 环境要求

- 构建：[Bun](https://bun.sh) 1.1+
- 运行：依赖系统 `curl` 发起网络请求（macOS / Linux / Windows 10+ 均自带）

> 说明：Wikimedia CDN 会基于 TLS/HTTP2 指纹拦截 Bun/Node 的原生 fetch（403），
> 因此本工具统一通过系统 curl 请求。

## 构建

```bash
bun install
bun run build
```

产物为当前目录下的 `wiki` 单文件可执行程序（macOS 上会自动做一次 ad-hoc 代码签名）。

## 使用

```bash
./wiki 人工智能
./wiki TypeScript --lang en
./wiki 量子力学 | less
./wiki Rust -l en -s
./wiki 黑洞 --no-link
```

也可以放进 PATH，例如：

```bash
sudo ln -s "$PWD/wiki" /usr/local/bin/wiki
wiki 黑洞
```

### 选项

| 选项 | 说明 |
| --- | --- |
| `-l, --lang <代码>` | 指定语言版本，默认 `zh`（简体中文）。指定 `zh-tw`/`zh-hant`/`zh-hk`/`zh-mo` 则为繁体中文；其他如 `en` / `ja` / `fr` |
| `-s, --summary` | 仅显示摘要 |
| `--no-link` | 只展示纯文本内容，不生成任何 Markdown 链接 |
| `--no-pager` | 不分页，直接输出全部内容 |
| `-h, --help` | 显示帮助 |
| `-v, --version` | 显示版本号 |

## 开发

```bash
bun run dev 人工智能            # 直接以 TS 源码运行
bunx tsc --noEmit              # 类型检查
```

## 项目结构

```
src/
  index.ts    CLI 入口：参数解析、拼装输出
  wiki.ts     Wikipedia API：搜索、页面内容、摘要（中文通过 action API 的 variant 参数做简/繁转换）
  http.ts     基于系统 curl 的 HTTP 传输层
  format.ts   HTML 清理（HTMLRewriter）与 Markdown 转换（turndown）
  pager.ts    less 分页 / 直接输出
```
