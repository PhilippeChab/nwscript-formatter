import { some as asyncSome } from "async";
import { workspace } from "vscode";

import type { TextDocument } from "vscode";

import { defaultConfiguration } from "../defaultConfiguration";

export default async (document: TextDocument): Promise<boolean> => {
  return new Promise((resolve, _) => {
    const ignoredPaths =
      workspace.getConfiguration("nwscript-formatter").get<Array<string>>("ignoredPaths") || defaultConfiguration.ignoredPaths;

    const isIgnoredFile = async (path: string) => {
      return (await workspace.findFiles(path)).some((file) => file.fsPath === document.uri.fsPath);
    };

    asyncSome(ignoredPaths, isIgnoredFile, (_, isIgnored) => {
      resolve(Boolean(isIgnored));
    });
  });
};
