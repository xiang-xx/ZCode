import { describe, expect, it } from "vitest";
import { isGuardedDeletionExemptInsideProject } from "../src/tool/handlers/guarded/project-exemption.js";

describe("Guarded project-local deletion exemption", () => {
  const root = {
    workspaceRoot: "/Users/xiang/projects/demo",
    workingDirectory: "/Users/xiang/projects/demo",
    dialect: "posix" as const,
  };

  it.each([
    "rm -rf build",
    "rm a b",
    "rm -r /Users/xiang/projects/demo/nested",
    "find . -type f -delete",
    "env A=1 rm -r dist",
  ])("exempts in-project deletion: %s", (command) => {
    expect(isGuardedDeletionExemptInsideProject({ ...root, command })).toBe(true);
  });

  it.each([
    "rm -rf /tmp/outside",
    "rm -rf ../other",
    "rm -rf /Users/xiang/projects/other",
    "rm -rf *.log",
    "rm -rf $TARGET",
    "git push --force",
    "dd if=/dev/zero of=/dev/disk0",
    "bash -c 'rm -rf build'",
  ])("keeps confirmation when containment is unproven: %s", (command) => {
    expect(isGuardedDeletionExemptInsideProject({ ...root, command })).toBe(false);
  });

  it("requires absolute project context", () => {
    expect(
      isGuardedDeletionExemptInsideProject({
        command: "rm -rf build",
        dialect: "posix",
        workingDirectory: "/Users/xiang/projects/demo",
      }),
    ).toBe(false);
    expect(
      isGuardedDeletionExemptInsideProject({
        command: "rm -rf build",
        dialect: "posix",
        workspaceRoot: "relative/project",
        workingDirectory: "/Users/xiang/projects/demo",
      }),
    ).toBe(false);
  });

  it("rejects when cwd itself is outside the project root", () => {
    expect(
      isGuardedDeletionExemptInsideProject({
        command: "rm -rf /Users/xiang/projects/demo/build",
        dialect: "posix",
        workspaceRoot: "/Users/xiang/projects/demo",
        workingDirectory: "/tmp",
      }),
    ).toBe(false);
  });
});
