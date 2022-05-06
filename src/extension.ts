import { languages } from "vscode";
import type { ExtensionContext } from "vscode";

import NWScriptDocumentFormattingEditProvider from "./NWScriptFormatter";

export function activate(ctx: ExtensionContext): void {
  const formatter = new NWScriptDocumentFormattingEditProvider();
  const mode = { language: "nwscript", scheme: "file" };

  ctx.subscriptions.push(languages.registerDocumentRangeFormattingEditProvider(mode, formatter));
  ctx.subscriptions.push(languages.registerDocumentFormattingEditProvider(mode, formatter));
}
