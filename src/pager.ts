/**
 * 输出内容：
 * - 管道/重定向时直接写入 stdout（方便 `wiki xx > xx.md`）
 * - 交互式终端且未禁用时，自动交给 less 分页（类似 git log）
 */
export async function output(text: string, usePager: boolean): Promise<void> {
  if (!text.endsWith("\n")) text += "\n";

  if (!usePager || !process.stdout.isTTY) {
    try {
      process.stdout.write(text);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EPIPE") process.exit(0);
      throw err;
    }
    return;
  }

  const pager = process.env.PAGER ?? "less";
  const args = pager.endsWith("less") ? ["-R", "-I"] : [];

  try {
    const proc = Bun.spawn({
      cmd: [pager, ...args],
      stdin: "pipe",
      stdout: "inherit",
      stderr: "inherit",
    });
    try {
      await proc.stdin.write(text);
      await proc.stdin.end();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EPIPE") process.exit(0);
      throw err;
    }
    await proc.exited;
  } catch {
    // 找不到分页器（例如部分 Windows 环境）时退化为直接输出
    process.stdout.write(text);
  }
}
