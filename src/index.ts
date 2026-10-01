import { searchPage, fetchPageHtml, fetchSummary, resolveLang } from "./wiki.ts";
import { htmlToMarkdown } from "./format.ts";
import { output } from "./pager.ts";

// 下游（如 head、less）提前关闭管道时静默退出，这是标准 CLI 行为
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") process.exit(0);
  });
}

const VERSION = "1.0.0";

const HELP = `wiki — 在终端里查看 Wikipedia，内容格式化为 Markdown

用法：
  wiki <关键词...>
  wiki [选项] <关键词...>

选项：
  -l, --lang <代码>   指定语言版本（默认：zh，自动转为简体）
                     中文变体：zh-cn（简）/ zh-tw（繁）/ zh-hk / zh-hans / zh-hant
                     其他语言：en / ja / fr ...
  -s, --summary       仅显示摘要
      --no-pager      不分页，直接输出全部内容（也可通过管道重定向）
  -h, --help          显示本帮助
  -v, --version       显示版本号

示例：
  wiki 人工智能
  wiki TypeScript --lang en
  wiki 量子力学 | less
  wiki Rust -l en -s
`;

interface CliOptions {
  query: string;
  lang: string;
  summary: boolean;
  pager: boolean;
}

function parseArgs(argv: string[]): CliOptions | "help" | "version" {
  let lang = "zh";
  let summary = false;
  let pager = true;
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        return "help";
      case "-v":
      case "--version":
        return "version";
      case "-s":
      case "--summary":
        summary = true;
        break;
      case "--no-pager":
        pager = false;
        break;
      case "-l":
      case "--lang": {
        const value = argv[++i];
        if (!value) throw new Error(`选项 ${arg} 需要一个语言代码，例如 --lang en`);
        lang = value;
        break;
      }
      default:
        if (arg.startsWith("--lang=")) {
          lang = arg.slice("--lang=".length);
        } else {
          rest.push(arg);
        }
    }
  }

  const query = rest.join(" ").trim();
  if (!query) return "help";

  return { query, lang, summary, pager };
}

// 仅在交互式终端下上色，保证管道输出干净
const useColor = Boolean(process.stdout.isTTY);
const bold = (s: string) => (useColor ? `\x1b[1m${s}\x1b[22m` : s);
const dim = (s: string) => (useColor ? `\x1b[2m${s}\x1b[22m` : s);

async function run(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (parsed === "version") {
    console.log(VERSION);
    return;
  }

  const lang = resolveLang(parsed.lang);
  const meta = await searchPage(parsed.query, lang);
  if (!meta) {
    console.error(`未在 ${lang.host} 维基百科中找到与“${parsed.query}”相关的页面。`);
    console.error(`提示：试试其他语言，例如  wiki "${parsed.query}" --lang en`);
    process.exit(1);
  }

  let body: string;

  if (parsed.summary) {
    const s = await fetchSummary(meta);
    body = [
      `# ${bold(s.title)}`,
      s.description ? `*${s.description}*` : "",
      s.extract,
      `---\n${dim(s.url)}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  } else {
    const html = await fetchPageHtml(meta);
    const markdown = await htmlToMarkdown(html, meta.lang.host);
    body = [
      `# ${bold(meta.title)}`,
      meta.description ? `*${meta.description}*` : "",
      markdown,
      `---\n${dim(meta.url)}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  await output(body, parsed.pager);
}

run().catch((err: unknown) => {
  console.error(`错误：${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
