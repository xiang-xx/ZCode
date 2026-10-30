import { isAbsolute, normalize, relative, resolve, sep } from "node:path";
import type { ExecutionShellSelection } from "@zcode/contracts";
import { analyzeBashCommand } from "../bash-command-parser.js";
import { analyzeCmdCommand } from "./cmd.js";
import { optionTable, parseOptions } from "./options.js";
import { unwrapCommand } from "./wrappers.js";
import { commandBasename, type CommandWord } from "./word.js";

const RM = optionTable(
  "-r -R --recursive -f --force -i -I --one-file-system --preserve-root --no-preserve-root -v --verbose -d --dir --help --version",
  "",
  "--interactive",
);

/**
 * 自主模式（guarded）下：危险命令的删除目标若全部落在当前项目根内，则跳过单次确认。
 * 无法静态证明（动态展开、未引用 glob、缺上下文、非删除类规则）时保持确认。
 */
export function isGuardedDeletionExemptInsideProject(options: {
  command: string;
  dialect: ExecutionShellSelection["dialect"];
  workspaceRoot?: string;
  workingDirectory?: string;
}): boolean {
  const root = normalizeAbsolute(options.workspaceRoot);
  const cwd = normalizeAbsolute(options.workingDirectory);
  if (!root || !cwd) return false;
  if (!isPathInsideRoot(cwd, root)) return false;
  if (options.command.length > 10_000 || options.dialect === "legacy-shell") return false;

  const windows = options.dialect === "cmd" || options.dialect === "git-bash";
  let commands: CommandWord[][];
  if (options.dialect === "cmd") {
    const analysis = analyzeCmdCommand(options.command);
    if (analysis.unsupported) return false;
    commands = analysis.commands;
  } else {
    const analysis = analyzeBashCommand(options.command);
    if (analysis.hasParseErrors || analysis.hasUnsupportedSyntax) return false;
    commands = analysis.commands.map((command) => command.words);
  }

  let sawDeletion = false;
  for (const invocation of commands) {
    const words = unwrapCommand(invocation, windows);
    if (!words?.[0]) return false;
    const name = commandBasename(words[0], windows);
    if (!name) return false;
    const targets = collectDeletionTargets(name, words.slice(1), options.dialect);
    if (targets === "not-deletion") continue;
    if (targets === "unknown") return false;
    sawDeletion = true;
    for (const target of targets) {
      if (target.dynamic || target.hasUnquotedGlob) return false;
      if (!isPathInsideRoot(resolvePath(target.value, cwd), root)) return false;
    }
  }
  return sawDeletion;
}

function collectDeletionTargets(
  name: string,
  args: CommandWord[],
  dialect: ExecutionShellSelection["dialect"],
): CommandWord[] | "not-deletion" | "unknown" {
  if (name === "rm" && dialect !== "cmd") {
    const targets = parseOptions(args, RM, { ordering: "stop-at-operand", unknown: "continue" });
    return targets.operands.length > 0 ? targets.operands : "unknown";
  }
  if (dialect === "cmd" && ["rd", "rmdir", "del", "erase"].includes(name)) {
    const targets = args.filter((word) => word.dynamic || !word.value.startsWith("/"));
    return targets.length > 0 ? targets : "unknown";
  }
  if (dialect !== "cmd" && name === "find") {
    const starts: CommandWord[] = [];
    for (const word of args) {
      if (!word.dynamic && (word.value.startsWith("-") || word.value === "!" || word.value === "(")) {
        break;
      }
      starts.push(word);
    }
    return starts.length > 0 ? starts : [DOT_PATH];
  }
  if ((dialect === "cmd" || dialect === "git-bash") && name === "robocopy") {
    const paths = args.filter(
      (word) =>
        word.dynamic ||
        !word.value.startsWith("/") ||
        (dialect === "git-bash" && /^\/[a-z]\//i.test(word.value)),
    );
    return paths.length >= 2 ? paths.slice(0, 2) : "unknown";
  }
  // git / dd / mount / mkfs / rsync / interpreters：本轮不按路径豁免。
  return "not-deletion";
}

const DOT_PATH: CommandWord = {
  value: ".",
  dynamic: false,
  hasUnquotedGlob: false,
  start: 0,
  end: 0,
};

function normalizeAbsolute(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = normalize(value);
  return isAbsolute(normalized) ? normalized : undefined;
}

function resolvePath(candidate: string, cwd: string): string {
  return isAbsolute(candidate) ? normalize(candidate) : resolve(cwd, candidate);
}

function isPathInsideRoot(candidate: string, root: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath));
}
