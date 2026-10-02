/**
 * HTTP 传输层。
 *
 * 注意：Wikimedia 的 CDN 会基于 TLS/HTTP2 指纹拦截 Bun/Node 的原生 fetch
 * （返回 403 Too Many Reqs），而系统 curl 可以正常访问。
 * 因此统一通过系统 curl 发起请求（macOS / Linux / Windows 10+ 均自带）。
 */

const USER_AGENT = "wiki-cli/1.0 (terminal wikipedia reader)";
const STATUS_MARKER = "__WIKI_CLI_STATUS__";

export interface HttpResponse {
  status: number;
  body: string;
}

export async function httpGet(
  url: string,
  accept: string,
): Promise<HttpResponse> {
  let proc: Bun.Subprocess;
  try {
    const cmd: string[] = [
        "curl",
        "-sS",
        "-L",
        "--compressed",
        "--max-time",
        "30",
        "-H",
        `User-Agent: ${USER_AGENT}`,
        "-H",
        `Accept: ${accept}`,
      ];
    cmd.push(
      // 在 body 末尾追加状态码，便于同时拿到响应体和状态码
      "-w",
      `\n${STATUS_MARKER}%{http_code}`,
      url,
    );
    proc = Bun.spawn({
      cmd,
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (err) {
    throw new Error(
      `无法启动 curl（${(err as Error).message}），请确认系统已安装 curl`,
    );
  }

  const stdout = proc.stdout as ReadableStream<Uint8Array>;
  const stderr = proc.stderr as ReadableStream<Uint8Array>;

  const [raw, errText, exitCode] = await Promise.all([
    new Response(stdout).text(),
    new Response(stderr).text(),
    proc.exited,
  ]);

  const markerIndex = raw.lastIndexOf(STATUS_MARKER);
  if (exitCode !== 0 || markerIndex === -1) {
    throw new Error(errText.trim() || `curl 请求失败（退出码 ${exitCode}）`);
  }

  const status = Number(raw.slice(markerIndex + STATUS_MARKER.length));
  const body = raw.slice(0, markerIndex - 1); // 去掉状态码前的换行

  return { status, body };
}
