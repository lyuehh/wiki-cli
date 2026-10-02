import { httpGet } from "./http.ts";

/**
 * 与 Wikipedia API 交互：搜索页面、获取页面 HTML、获取摘要。
 * 文档：https://www.mediawiki.org/wiki/API
 */

export interface ResolvedLang {
  /** 维基百科子域名语言，如 zh / en / ja */
  host: string;
  /**
   * MediaWiki 中文变体代码，仅支持两种：
   *   - zh-cn：简体中文（默认）
   *   - zh-tw：繁体中文
   * 非中文语言为 null。
   */
  variant: string | null;
}

/**
 * 把用户传入的语言代码解析为「维基子域名 + 中文变体」。
 *
 * 中文维基的原始内容繁简混杂，必须通过 action API 的 variant 参数做服务端转换，
 * 才能得到纯简体或纯繁体（等价于浏览器访问 /zh-cn/ 或 /zh-tw/ 路径）。
 *
 * 按需求约定：
 *   - 默认（zh 及其它中文变体）一律按「简体中文 zh-cn」处理；
 *   - 仅当明确指定繁体（zh-tw / zh-hant / zh-hk / zh-mo）时使用「繁体中文 zh-tw」；
 *   - 其它语言（en / ja / fr ...）直接作为子域名，不做变体转换。
 */
export function resolveLang(input: string): ResolvedLang {
  const code = input.trim().toLowerCase();

  if (code === "zh" || code.startsWith("zh-") || code.startsWith("zh_")) {
    // 繁体相关的变体统一归到 zh-tw，其余（含简体、未知变体）归到 zh-cn
    const traditional = new Set([
      "zh-tw",
      "zh-hant",
      "zh-hk",
      "zh-mo",
      "zh_tw",
      "zh_hant",
      "zh_hk",
      "zh_mo",
    ]);
    const variant = traditional.has(code) ? "zh-tw" : "zh-cn";
    return { host: "zh", variant };
  }

  return { host: code, variant: null };
}

export interface WikiPageMeta {
  /** 规范的页面标题（可直接用于 URL） */
  key: string;
  title: string;
  description?: string;
  url: string;
  lang: ResolvedLang;
}

export interface WikiPageContent {
  /** 已按变体转换的内容 HTML */
  html: string;
  /** 已按变体转换的显示标题 */
  title: string;
}

export interface WikiSummary {
  title: string;
  description?: string;
  extract: string;
  url: string;
}

async function getJson(url: string): Promise<any> {
  const { status, body } = await httpGet(url, "application/json");
  if (status < 200 || status >= 300) {
    throw new Error(`HTTP ${status}`);
  }
  return JSON.parse(body);
}

/** 去掉 displaytitle 里的 HTML 标签，得到纯文本标题 */
function stripTags(html: string | undefined): string {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

/** 构造对外展示的页面 URL：中文带变体时用 /zh-cn/ 或 /zh-tw/ 路径 */
function pageUrl(lang: ResolvedLang, key: string): string {
  const title = encodeURIComponent(key);
  if (lang.variant) {
    return `https://${lang.host}.wikipedia.org/${lang.variant}/${title}`;
  }
  return `https://${lang.host}.wikipedia.org/wiki/${title}`;
}

/** 通过全文搜索接口找到最匹配的一个页面 */
export async function searchPage(
  query: string,
  lang: ResolvedLang,
): Promise<WikiPageMeta | null> {
  const params = new URLSearchParams({
    action: "query",
    list: "search",
    srsearch: query,
    srlimit: "1",
    srprop: "",
    format: "json",
    formatversion: "2",
  });
  if (lang.variant) params.set("variant", lang.variant);

  const endpoint = `https://${lang.host}.wikipedia.org/w/api.php?${params}`;

  let data: any;
  try {
    data = await getJson(endpoint);
  } catch (err) {
    throw new Error(
      `访问 ${lang.host}.wikipedia.org 失败（${(err as Error).message}），请检查网络`,
    );
  }

  const page = data?.query?.search?.[0];
  if (!page) return null;

  const key = page.title as string;
  return {
    key,
    title: key,
    url: pageUrl(lang, key),
    lang,
  };
}

/**
 * 获取页面内容 HTML（经 action=parse 做变体转换，保证纯简体/纯繁体）。
 * 同时返回转换后的显示标题。
 */
export async function fetchPageHtml(meta: WikiPageMeta): Promise<WikiPageContent> {
  const params = new URLSearchParams({
    action: "parse",
    page: meta.key,
    prop: "text|displaytitle",
    format: "json",
    formatversion: "2",
    redirects: "true",
  });
  if (meta.lang.variant) params.set("variant", meta.lang.variant);

  const url = `https://${meta.lang.host}.wikipedia.org/w/api.php?${params}`;

  const { status, body } = await httpGet(url, "application/json");
  if (status < 200 || status >= 300) {
    throw new Error(`获取页面内容失败：HTTP ${status}`);
  }

  const parse = JSON.parse(body)?.parse;
  if (!parse?.text) {
    throw new Error("获取页面内容失败：返回数据为空");
  }

  return {
    html: parse.text as string,
    title: stripTags(parse.displaytitle) || (parse.title as string) || meta.title,
  };
}

/** 获取页面摘要（intro extract，经 variant 转换） */
export async function fetchSummary(meta: WikiPageMeta): Promise<WikiSummary> {
  const params = new URLSearchParams({
    action: "query",
    prop: "extracts|description",
    exintro: "1",
    explaintext: "1",
    titles: meta.key,
    redirects: "1",
    format: "json",
    formatversion: "2",
  });
  if (meta.lang.variant) params.set("variant", meta.lang.variant);

  const url = `https://${meta.lang.host}.wikipedia.org/w/api.php?${params}`;

  // extracts 接口会转换正文，但标题和（来自 Wikidata 的）description 不随 variant 转换，
  // 因此（仅中文变体时）在拿到数据后补做一次文本转换。
  const data = await getJson(url);

  const page = data?.query?.pages?.[0];
  if (!page) {
    throw new Error("获取摘要失败：返回数据为空");
  }

  const key = (page.title as string) ?? meta.key;
  let title = key || meta.title;
  let description: string | undefined = page.description ?? meta.description;

  if (meta.lang.variant) {
    const [convTitle, convDesc] = await convertTexts(meta.lang, [
      title,
      description ?? "",
    ]);
    if (convTitle) title = convTitle;
    if (description && convDesc) description = convDesc;
  }

  return {
    title,
    description,
    extract: page.extract ?? "",
    url: pageUrl(meta.lang, key),
  };
}

/**
 * 用 action=parse 的通用 wikitext 转换能力，把任意文本按变体转换
 * （字符级 + 地区词，如 软件↔軟體）。失败时原样返回。
 */
async function convertTexts(
  lang: ResolvedLang,
  texts: string[],
): Promise<string[]> {
  const SEP = "\n@@WIKI_CLI_SEP@@\n";
  const joined = texts.join(SEP);

  const params = new URLSearchParams({
    action: "parse",
    prop: "text",
    contentmodel: "wikitext",
    disablelimitreport: "1",
    text: joined,
    format: "json",
    formatversion: "2",
  });
  if (lang.variant) params.set("variant", lang.variant);

  const url = `https://${lang.host}.wikipedia.org/w/api.php?${params}`;
  try {
    const data = await getJson(url);
    const html = data?.parse?.text as string | undefined;
    if (!html) return texts;
    const plain = stripTags(html);
    const parts = plain.split(/\s*@@WIKI_CLI_SEP@@\s*/);
    return texts.map((orig, i) => parts[i]?.trim() || orig);
  } catch {
    return texts;
  }
}
