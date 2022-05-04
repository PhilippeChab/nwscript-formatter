import * as vscode from "vscode";
import cp = require("child_process");
import path = require("path");
import sax = require("sax");

import { getBinPath } from "./clangPath";

export const outputChannel =
  vscode.window.createOutputChannel("NWScript-Formatter");

function getPlatformString() {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "linux":
      return "linux";
    case "darwin":
      return "osx";
  }

  return "unknown";
}

export class NWScriptDocumentFormattingEditProvider
  implements
    vscode.DocumentFormattingEditProvider,
    vscode.DocumentRangeFormattingEditProvider
{
  public formatDocument(
    document: vscode.TextDocument
  ): Thenable<vscode.TextEdit[] | null> {
    return this.doFormatDocument(document, null, null, null);
  }

  public provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): Thenable<vscode.TextEdit[] | null> {
    return this.doFormatDocument(document, null, options, token);
  }

  public provideDocumentRangeFormattingEdits(
    document: vscode.TextDocument,
    range: vscode.Range,
    options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): Thenable<vscode.TextEdit[] | null> {
    return this.doFormatDocument(document, range, options, token);
  }

  private getEdits(
    document: vscode.TextDocument,
    xml: string,
    codeContent: string
  ): Thenable<vscode.TextEdit[] | null> {
    return new Promise((resolve, reject) => {
      const options = {
        trim: false,
        normalize: false,
        loose: true,
      };
      const parser = sax.parser(true, options);

      const edits: vscode.TextEdit[] = [];
      let currentEdit: { length: number; offset: number; text: string } | null;

      const codeBuffer = new Buffer(codeContent);
      // encoding position cache
      const codeByteOffsetCache = {
        byte: 0,
        offset: 0,
      };
      const byteToOffset = function (editInfo: {
        length: number;
        offset: number;
      }) {
        let offset = editInfo.offset;
        let length = editInfo.length;

        if (offset >= codeByteOffsetCache.byte) {
          editInfo.offset =
            codeByteOffsetCache.offset +
            codeBuffer.slice(codeByteOffsetCache.byte, offset).toString("utf8")
              .length;
          codeByteOffsetCache.byte = offset;
          codeByteOffsetCache.offset = editInfo.offset;
        } else {
          editInfo.offset = codeBuffer.slice(0, offset).toString("utf8").length;
          codeByteOffsetCache.byte = offset;
          codeByteOffsetCache.offset = editInfo.offset;
        }

        editInfo.length = codeBuffer
          .slice(offset, offset + length)
          .toString("utf8").length;

        return editInfo;
      };

      parser.onerror = (err) => {
        reject(err.message);
      };

      parser.onopentag = (tag) => {
        if (currentEdit) {
          reject("Malformed output.");
        }

        switch (tag.name) {
          case "replacements":
            return;

          case "replacement":
            currentEdit = {
              length: parseInt(tag.attributes["length"].toString()),
              offset: parseInt(tag.attributes["offset"].toString()),
              text: "",
            };
            byteToOffset(currentEdit);
            break;

          default:
            reject(`Unexpected tag ${tag.name}.`);
        }
      };

      parser.ontext = (text) => {
        if (!currentEdit) {
          return;
        }

        currentEdit.text = text;
      };

      parser.onclosetag = (tagName) => {
        if (!currentEdit) {
          return;
        }

        const start = document.positionAt(currentEdit.offset);
        const end = document.positionAt(
          currentEdit.offset + currentEdit.length
        );

        const editRange = new vscode.Range(start, end);

        edits.push(new vscode.TextEdit(editRange, currentEdit.text));
        currentEdit = null;
      };

      parser.onend = () => {
        resolve(edits);
      };

      parser.write(xml);
      parser.end();
    });
  }

  private getStyle() {
    let ret = vscode.workspace
      .getConfiguration("nwscript-formatter")
      .get<string>(`nwscript-formatter.style`);
    if (ret?.trim()) {
      return ret.trim();
    }

    ret = vscode.workspace
      .getConfiguration("nwscript-formatter")
      .get<string>("style");
    if (ret && ret.trim()) {
      return ret.trim();
    } else {
      return this.defaultConfigure.style;
    }
  }

  private getExecutablePath() {
    const platform = getPlatformString();
    const config = vscode.workspace.getConfiguration("nwscript-formatter");

    const platformExecPath = config.get<string>("executable." + platform);
    const defaultExecPath = config.get<string>("executable");
    const execPath = platformExecPath || defaultExecPath;

    if (!execPath) {
      return this.defaultConfigure.executable;
    }

    // replace placeholders, if present
    return execPath
      .replace(/\${workspaceRoot}/g, this.getWorkspaceRootPath()!)
      .replace(/\${workspaceFolder}/g, this.getWorkspaceFolder()!)
      .replace(/\${cwd}/g, process.cwd())
      .replace(/\${env\.([^}]+)}/g, (sub: string, envName: string) => {
        return process.env[envName]!;
      });
  }

  private getWorkspaceRootPath(): string | undefined {
    return vscode.workspace.workspaceFolders?.slice(0, 1)?.shift()?.name;
  }

  private getWorkspaceFolder(): string | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage(
        "Unable to get the location of nwscript-formatter executable - no active workspace selected."
      );
      return undefined;
    }

    if (!vscode.workspace.workspaceFolders) {
      vscode.window.showErrorMessage(
        "Unable to get the location of nwscript-formatter executable - no workspaces available."
      );
      return undefined;
    }

    const currentDocumentUri = editor.document.uri;
    let workspacePath = vscode.workspace.getWorkspaceFolder(currentDocumentUri);
    if (!workspacePath) {
      const fallbackWorkspace = vscode.workspace.workspaceFolders[0];
      vscode.window.showWarningMessage(
        `Unable to deduce the location of nwscript-formatter executable for file outside the workspace - expanding \${workspaceFolder} to "${fallbackWorkspace.name}" path.`
      );
      workspacePath = fallbackWorkspace;
    }
    return workspacePath.uri.path;
  }

  private doFormatDocument(
    document: vscode.TextDocument,
    range: vscode.Range | null,
    options: vscode.FormattingOptions | null,
    token: vscode.CancellationToken | null
  ): Thenable<vscode.TextEdit[] | null> {
    return new Promise((resolve, reject) => {
      const formatCommandBinPath = getBinPath(this.getExecutablePath());
      const codeContent = document.getText();

      const formatArgs = [
        "-output-replacements-xml",
        `-style=${this.getStyle()}`,
      ];

      if (range) {
        let offset = document.offsetAt(range.start);
        let length = document.offsetAt(range.end) - offset;

        // fix charater length to byte length
        length = Buffer.byteLength(codeContent.substr(offset, length), "utf8");
        // fix charater offset to byte offset
        offset = Buffer.byteLength(codeContent.substr(0, offset), "utf8");

        formatArgs.push(`-offset=${offset}`, `-length=${length}`);
      }

      let workingPath = this.getWorkspaceRootPath();
      if (!document.isUntitled || !workingPath) {
        workingPath = path.dirname(document.fileName);
      }

      let stdout = "";
      let stderr = "";
      const child = cp.spawn(formatCommandBinPath, formatArgs, {
        cwd: workingPath,
      });
      child.stdin.end(codeContent);
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", (err) => {
        if (err && (<any>err).code === "ENOENT") {
          vscode.window.showInformationMessage(
            `The ${formatCommandBinPath} command is not available.  Please check your nwscript-formatter.executable user setting and ensure it is installed.`
          );
          return resolve(null);
        }
        return reject(err);
      });
      child.on("close", (code) => {
        try {
          if (stderr.length !== 0) {
            outputChannel.show();
            outputChannel.clear();
            outputChannel.appendLine(stderr);
            return reject("Cannot format due to syntax errors.");
          }

          if (code !== 0) {
            return reject();
          }

          return resolve(this.getEdits(document, stdout, codeContent));
        } catch (e) {
          reject(e);
        }
      });

      if (token) {
        token.onCancellationRequested(() => {
          child.kill();
          reject("Cancelation requested.");
        });
      }
    });
  }

  private defaultConfigure = {
    executable: "nwscript-formatter",
    style: "file",
  };
}

export function activate(ctx: vscode.ExtensionContext): void {
  const formatter = new NWScriptDocumentFormattingEditProvider();
  const mode = { language: "nwscript", scheme: "file" };

  ctx.subscriptions.push(
    vscode.languages.registerDocumentRangeFormattingEditProvider(
      mode,
      formatter
    )
  );
  ctx.subscriptions.push(
    vscode.languages.registerDocumentFormattingEditProvider(mode, formatter)
  );
}
