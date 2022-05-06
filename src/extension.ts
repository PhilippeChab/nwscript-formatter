import * as sax from "sax";
import { spawn } from "child_process";
import { dirname, join } from "path";
import { existsSync, lstatSync } from "fs";
import { window, workspace, languages, TextEdit, Range } from "vscode";

import type {
  DocumentFormattingEditProvider,
  DocumentRangeFormattingEditProvider,
  TextDocument,
  FormattingOptions,
  CancellationToken,
  ExtensionContext,
} from "vscode";

import getBinPath from "./clangPath";
import byteToOffset from "./byteToOffset";

export const outputChannel = window.createOutputChannel("NWScript-Formatter");

const defaultConfiguration = {
  executable: "nwscript-formatter",
  style: "file",
};

const getPlatformString = () => {
  switch (process.platform) {
    case "win32":
      return "windows";
    case "linux":
      return "linux";
    case "darwin":
      return "osx";
  }

  return "unknown";
};

export class NWScriptDocumentFormattingEditProvider
  implements
    DocumentFormattingEditProvider,
    DocumentRangeFormattingEditProvider
{
  public provideDocumentFormattingEdits(
    document: TextDocument,
    options: FormattingOptions,
    token: CancellationToken
  ): Thenable<TextEdit[] | null> {
    return this.doFormatDocument(document, null, options, token);
  }

  public provideDocumentRangeFormattingEdits(
    document: TextDocument,
    range: Range,
    options: FormattingOptions,
    token: CancellationToken
  ): Thenable<TextEdit[] | null> {
    return this.doFormatDocument(document, range, options, token);
  }

  private getWorkspaceRootPath(): string | undefined {
    return workspace.rootPath;
  }

  private getWorkspaceFolder(): string | undefined {
    const editor = window.activeTextEditor;
    if (!editor) {
      window.showErrorMessage(
        "Unable to get the location of nwscript-formatter executable - no active workspace selected."
      );
      return undefined;
    }

    if (!workspace.workspaceFolders) {
      window.showErrorMessage(
        "Unable to get the location of nwscript-formatter executable - no workspaces available."
      );
      return undefined;
    }

    const currentDocumentUri = editor.document.uri;
    let workspacePath = workspace.getWorkspaceFolder(currentDocumentUri);
    if (!workspacePath) {
      const fallbackWorkspace = workspace.workspaceFolders[0];
      window.showWarningMessage(
        `Unable to deduce the location of nwscript-formatter executable for file outside the workspace - expanding \${workspaceFolder} to "${fallbackWorkspace.name}" path.`
      );
      workspacePath = fallbackWorkspace;
    }

    return workspacePath.uri.path;
  }

  private getExecutablePath() {
    const platform = getPlatformString();
    const config = workspace.getConfiguration("nwscript-formatter");

    const platformExecPath = config.get<string>("executable." + platform);
    const defaultExecPath = config.get<string>("executable");
    const execPath = platformExecPath || defaultExecPath;

    if (!execPath) {
      return defaultConfiguration.executable;
    }

    const workspaceRootPath = this.getWorkspaceRootPath();
    const workspaceFolder = this.getWorkspaceFolder();
    if (workspaceRootPath && workspaceFolder) {
      return execPath
        .replace(/\${workspaceRoot}/g, workspaceRootPath)
        .replace(/\${workspaceFolder}/g, workspaceFolder)
        .replace(/\${cwd}/g, process.cwd())
        .replace(/\${env\.([^}]+)}/g, (_: string, envName: string) => {
          return process.env[envName] || "";
        });
    } else {
      return execPath;
    }
  }

  private getStyle() {
    const style = workspace
      .getConfiguration("nwscript-formatter")
      .get<string>("style");

    if (style && style.trim()) {
      return style.trim();
    } else {
      return defaultConfiguration.style;
    }
  }

  private getEdits(
    document: TextDocument,
    xml: string,
    codeContent: string
  ): Thenable<TextEdit[] | null> {
    return new Promise((resolve, reject) => {
      const parser = sax.parser(true, {
        trim: false,
        normalize: false,
      });

      const edits: TextEdit[] = [];
      let currentEdit: { length: number; offset: number; text: string } | null;

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
            byteToOffset(codeContent, currentEdit);
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

        const editRange = new Range(start, end);

        edits.push(new TextEdit(editRange, currentEdit.text));
        currentEdit = null;
      };

      parser.onend = () => {
        resolve(edits);
      };

      parser.write(xml);
      parser.end();
    });
  }

  private doFormatDocument(
    document: TextDocument,
    range: Range | null,
    options: FormattingOptions | null,
    token: CancellationToken | null
  ): Thenable<TextEdit[] | null> {
    return new Promise((resolve, reject) => {
      const rootPath = this.getWorkspaceRootPath();
      let workingPath = rootPath;
      if (!document.isUntitled || !rootPath) {
        workingPath = dirname(document.fileName);
      }

      if (rootPath) {
        const ignoredPaths = workspace
          .getConfiguration("nwscript-formatter")
          .get<Array<string>>("ignoredPaths");
        const isFileIgnored = ignoredPaths?.some((ignoredSubPath) => {
          const path = join(rootPath, ignoredSubPath);

          if (existsSync(path)) {
            const currentFilePath = document.uri.fsPath;

            if (
              (lstatSync(path).isDirectory() &&
                currentFilePath.includes(path)) ||
              currentFilePath === path
            ) {
              return true;
            }
          }
        });

        if (isFileIgnored) {
          return resolve(null);
        }
      }

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

      let stdout = "";
      let stderr = "";
      const child = spawn(formatCommandBinPath, formatArgs, {
        cwd: workingPath,
      });

      child.stdin.end(codeContent);
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", (err) => {
        if (err && (<any>err).code === "ENOENT") {
          window.showInformationMessage(
            `The ${formatCommandBinPath} command is not available.  Please check your nwscript-formatter.executable user setting and ensure clang executable is installed.`
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
}

export function activate(ctx: ExtensionContext): void {
  const formatter = new NWScriptDocumentFormattingEditProvider();
  const mode = { language: "nwscript", scheme: "file" };

  ctx.subscriptions.push(
    languages.registerDocumentRangeFormattingEditProvider(mode, formatter)
  );
  ctx.subscriptions.push(
    languages.registerDocumentFormattingEditProvider(mode, formatter)
  );
}
