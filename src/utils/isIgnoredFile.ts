import { join } from "path";
import { existsSync, lstatSync } from "fs";
import { workspace } from "vscode";
import type { TextDocument } from "vscode";

export default (workspaceRootPath: string | undefined, document: TextDocument) => {
  if (!workspaceRootPath) {
    return false;
  }

  const ignoredPaths = workspace.getConfiguration("nwscript-formatter").get<Array<string>>("ignoredPaths");

  return ignoredPaths?.some((ignoredSubPath) => {
    const path = join(workspaceRootPath, ignoredSubPath);

    if (existsSync(path)) {
      const currentFilePath = document.uri.fsPath;

      if ((lstatSync(path).isDirectory() && currentFilePath.includes(path)) || currentFilePath === path) {
        return true;
      }
    }
  });
};
