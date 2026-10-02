import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

/**
 * 这些元素对纯文本阅读没有价值，甚至会破坏 Markdown 排版：
 * 样式/脚本、编辑按钮、消歧义提示、信息框、导航模板、分类链接、图片等。
 */
const REMOVE_SELECTORS: string[] = [
  "title",
  "style",
  "link",
  "meta",
  "script",
  "noscript",
  "template",

  ".mw-editsection",
  ".mw-editsection-like",
  ".hatnote",
  ".hatnote-navigation",
  ".dablink",

  ".infobox",
  ".infobox-v3",
  "table.infobox",
  ".sidebar",
  "table.metadata",
  ".side-box",

  ".navbox",
  ".navbox-styles",
  ".navbox-inner",
  ".navbox-title",
  ".navframe",
  ".vertical-navbox",

  ".ambox",
  ".cmbox",
  ".ombox",
  ".fmbox",
  ".tmbox",

  "#catlinks",
  ".catlinks",
  ".printfooter",
  "#siteSub",
  "#contentSub",
  ".mw-empty-elt",
  ".noprint",
  ".reference-accessdate",
  ".magnify",

  "img",
  "video",
  "audio",
  "source",
];

/** 把 Wikipedia Parsoid HTML 清理并转换为 Markdown */
export async function htmlToMarkdown(
  html: string,
  lang: string,
  options: { noLink?: boolean } = {},
): Promise<string> {
  const noLink = options.noLink ?? false;

  // 1. 用 bun 内置的 HTMLRewriter 流式清理 DOM
  let rewriter = new HTMLRewriter();
  for (const selector of REMOVE_SELECTORS) {
    rewriter = rewriter.on(selector, {
      element: (el) => {
        el.remove();
      },
    });
  }

  // 2. 把相对链接补全为绝对链接
  rewriter = rewriter.on("a[href]", {
    element(el) {
      let href = el.getAttribute("href");
      if (!href) return;

      if (href.startsWith("//")) {
        href = "https:" + href;
      } else if (href.startsWith("./")) {
        // Parsoid 风格相对链接：./页面名[#锚点]
        href = `https://${lang}.wikipedia.org/wiki/${href.slice(2)}`;
      } else if (href.startsWith("/wiki/") || href.startsWith("/w/")) {
        href = `https://${lang}.wikipedia.org${href}`;
      } else {
        return;
      }
      el.setAttribute("href", href);
    },
  });

  const cleaned = await rewriter.transform(new Response(html)).text();

  // 3. HTML -> Markdown
  const td = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  });
  td.use(gfm); // 支持 GFM 表格、删除线、任务列表等

  // gfm 的表格规则在表格带 <caption> 时会误判并保留原始 HTML，
  // 因此在其后注册更高优先级的表格规则（addRule 会 unshift 到规则队首）
  td.addRule("wikiTable", {
    filter: (node) =>
      node.nodeName === "TABLE" &&
      Boolean((node as HTMLTableElement).rows?.[0]),
    replacement: (content, node) => {
      const caption = node.querySelector("caption")?.textContent?.trim();
      const body = content.replace(/\n{3,}/g, "\n\n").trim();
      const header = caption ? `**${caption}**\n\n` : "";
      return `\n\n${header}${body}\n\n`;
    },
  });

  // 覆盖 gfm 的单元格规则：GFM 单元格内不允许换行（<br> 用 <br> 表示），
  // 转义单元格内的竖线
  td.addRule("tableCell", {
    filter: ["th", "td"],
    replacement: (content, node) => {
      const index = Array.prototype.indexOf.call(
        node.parentNode!.childNodes,
        node,
      );
      const text = content
        .replace(/\s*\n\s*/g, "<br>")
        .replace(/\|/g, "\\|")
        .trim();
      return `${index === 0 ? "| " : " "}${text} |`;
    },
  });

  // 覆盖 gfm 的行规则：自行判断标题行并生成分隔线（不依赖会被 caption 干扰的 isFirstTbody）
  td.addRule("tableRow", {
    filter: "tr",
    replacement: (content, node) => {
      const table = node.closest("table") as HTMLTableElement | null;
      const cells = Array.from(node.children).filter(
        (n) => n.nodeName === "TH" || n.nodeName === "TD",
      );
      const isHeading =
        table?.rows[0] === node &&
        cells.length > 0 &&
        cells.every((n) => n.nodeName === "TH");
      const border = "| " + cells.map(() => "---").join(" | ") + " |";
      return `\n${content}${isHeading ? "\n" + border : ""}`;
    },
  });

  // caption 文本由表格规则统一处理，递归时静默，避免重复
  td.addRule("tableCaption", {
    filter: "caption",
    replacement: () => "",
  });

  // 引用角标：noLink 时输出纯文本 [n]，否则输出干净的 [n](url)
  td.addRule("refCitation", {
    filter: (node) =>
      node.nodeName === "SUP" &&
      Boolean(
        node.classList?.contains("mw-ref") ||
          node.classList?.contains("reference"),
      ),
    replacement: (_content, node) => {
      const anchor = node.querySelector("a");
      const href = anchor?.getAttribute("href") ?? "";
      // textContent 本身带有 [ ]，去掉后再统一包裹
      const text = (anchor?.textContent ?? "")
        .replace(/[[\]\s]/g, "")
        .trim();
      if (noLink) return text ? `[${text}]` : "";
      return href ? `[${text}](${href})` : text;
    },
  });

  // noLink：所有链接只保留文本内容，不输出 Markdown 链接语法
  if (noLink) {
    td.addRule("plainAnchor", {
      filter: "a",
      replacement: (content) => content,
    });
  }

  // 删掉图片后残留的空链接
  td.addRule("emptyAnchor", {
    filter: (node) =>
      node.nodeName === "A" && !(node.textContent ?? "").trim(),
    replacement: () => "",
  });

  let md = td.turndown(cleaned);

  // 4. 收尾：去除行尾空白、压缩多余空行
  md = md
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return md;
}
