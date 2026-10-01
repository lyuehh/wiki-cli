import { httpGet } from "./http.ts";

/**
 * 与 Wikipedia API 交互：搜索页面、获取页面 HTML、获取摘要。
 * 文档：https://www.mediawiki.org/wiki/API
 */

export interface ResolvedLang {
  /** 维基百科子域名语言，如 zh / en / ja */
  host: string;
  /** MediaWiki 中文变体代码（zh-cn / zh-tw ...），无变体时为 null */
  variant: string | null;
  /** 发给服务端触发变体转换的 Accept-Language 值 */
  acceptLanguage: string | null;
}

/**
 * 把用户传入的语言代码解析为「维基子域名 + 中文变体」。
 * 中文维基的原始内容繁简混杂，需要显式请求变体才能得到简体/繁体。
 */
export function resolveLang(input: string): ResolvedLang {
  const code = input.trim().toLowerCase();

  if (code === "zh" || code.startsWith("zh-")) {
    // 默认 zh 按「简体（大陆用词）」处理
    const variantMap: Record<string, string> = {
      zh: "zh-cn",
      "zh-cn": "zh-cn",
      "zh-sg": "zh-sg",
      "zh-hans": "zh-hans",
      "zh-tw": "zh-tw",
      "zh-hk": "zh-hk",
      "zh-mo": "zh-mo",
      "zh-hant": "zh-hant",
    };
    const variant = variantMap[code] ?? "zh-cn";

    const isHans = variant === "zh-cn" || variant === "zh-sg" || variant === "zh-hans";
    const primaryMap: Record<string, string> = {
      "zh-cn": "zh-CN",
      "zh-sg": "zh-SG",
      "zh-hans": "zh-Hans",
      "zh-tw": "zh-TW",
      "zh-hk": "zh-HK",
      "zh-mo": "zh-MO",
      "zh-hant": "zh-Hant",
    };
    const primary = primaryMap[variant];
    const fallback = isHans ? "zh-Hans" : "zh-Hant";

    return {
      host: "zh",
      variant,
      acceptLanguage: `${primary},${fallback};q=0.9,zh;q=0.8`,
    };
  }

  return { host: code, variant: null, acceptLanguage: null };
}

export interface WikiPageMeta {
  /** 规范的页面标题（可直接用于 URL） */
  key: string;
  title: string;
  description?: string;
  url: string;
  lang: ResolvedLang;
}

export interface WikiSummary {
  title: string;
  description?: string;
  extract: string;
  url: string;
}

async function getJson(lang: ResolvedLang, url: string): Promise<any> {
  const { status, body } = await httpGet(
    url,
    "application/json",
    lang.acceptLanguage ?? undefined,
  );
  if (status < 200 || status >= 300) {
    throw new Error(`HTTP ${status}`);
  }
  return JSON.parse(body);
}

/** 通过全文搜索接口找到最匹配的一个页面 */
export async function searchPage(
  query: string,
  lang: ResolvedLang,
): Promise<WikiPageMeta | null> {
  const endpoint = `https://${lang.host}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
    query,
  )}&srlimit=1&srprop=&format=json&formatversion=2`;

  let data: any;
  try {
    data = await getJson(lang, endpoint);
  } catch (err) {
    throw new Error(
      `访问 ${lang.host}.wikipedia.org 失败（${(err as Error).message}），请检查网络`,
    );
  }

  const page = data?.query?.search?.[0];
  if (!page) return null;

  return {
    key: page.title as string,
    title: page.title as string,
    url: `https://${lang.host}.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
    lang,
  };
}

/** 获取页面的 Parsoid HTML（语义化结构，适合转换为 Markdown） */
export async function fetchPageHtml(meta: WikiPageMeta): Promise<string> {
  const url = `https://${meta.lang.host}.wikipedia.org/api/rest_v1/page/html/${encodeURIComponent(
    meta.key,
  )}?redirect=true`;

  const { status, body } = await httpGet(
    url,
    "text/html; charset=utf-8",
    meta.lang.acceptLanguage ?? undefined,
  );
  if (status < 200 || status >= 300) {
    throw new Error(`获取页面内容失败：HTTP ${status}`);
  }
  return body;
}

/** 获取页面摘要（extract） */
export async function fetchSummary(meta: WikiPageMeta): Promise<WikiSummary> {
  const url = `https://${meta.lang.host}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
    meta.key,
  )}?redirect=true`;

  const data: any = await getJson(meta.lang, url);
  return {
    title: data.title ?? meta.title,
    description: data.description ?? meta.description,
    extract: data.extract ?? "",
    url: data.content_urls?.desktop?.page ?? meta.url,
  };
}
