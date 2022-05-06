import * as sax from "sax";
import { spawn } from "child_process";
import { dirname } from "path";
import { window, workspace, TextEdit, Range } from "vscode";

import type {
  DocumentFormattingEditProvider,
  DocumentRangeFormattingEditProvider,
  TextDocument,
  FormattingOptions,
  CancellationToken,
} from "vscode";

import { byteToOffset, clangPath, isIgnoredFile } from "./utils";
import { defaultConfiguration } from "./defaultConfiguration";

const outputChannel = window.createOutputChannel("NWScript-Formatter");

export default class NWScriptDocumentFormattingEditProvider
  implements DocumentFormattingEditProvider, DocumentRangeFormattingEditProvider
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
      window.showErrorMessage("Unable to get the location of nwscript-formatter executable - no active workspace selected.");
      return undefined;
    }

    if (!workspace.workspaceFolders) {
      window.showErrorMessage("Unable to get the location of nwscript-formatter executable - no workspaces available.");
      return undefined;
    }

    const currentDocumentUri = editor.document.uri;
    const workspacePath = workspace.getWorkspaceFolder(currentDocumentUri);

    if (!workspacePath) {
      const fallbackWorkspace = workspace.workspaceFolders[0];
      window.showWarningMessage(
        `Unable to deduce the location of nwscript-formatter executable for file outside the workspace - expanding \${workspaceFolder} to "${fallbackWorkspace.name}" path.`
      );
      return fallbackWorkspace.uri.path;
    }

    return workspacePath.uri.path;
  }

  private getExecutablePath() {
    const config = workspace.getConfiguration("nwscript-formatter");
    const execPath = config.get<string>("executable") || defaultConfiguration.executable;

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
    const style = workspace.getConfiguration("nwscript-formatter").get<object>("style");

    if (style) {
      return JSON.stringify(style);
    } else {
      return JSON.stringify(defaultConfiguration.style);
    }
  }

  private getEdits(document: TextDocument, xml: string, codeContent: string): Thenable<TextEdit[] | null> {
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
        const end = document.positionAt(currentEdit.offset + currentEdit.length);

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
      if (!workspace.getConfiguration("nwscript-formatter").get<boolean>("enabled")) {
        return resolve(null);
      }

      const workspaceRootPath = this.getWorkspaceRootPath();
      const workingPath = !document.isUntitled || !workspaceRootPath ? dirname(document.fileName) : workspaceRootPath;

      if (isIgnoredFile(workspaceRootPath, document)) {
        return resolve(null);
      }

      const formatCommandBinPath = clangPath(this.getExecutablePath());
      const codeContent = document.getText();

      const formatArgs = ["-output-replacements-xml", `-style=${this.getStyle()}`];

      if (range) {
        let offset = document.offsetAt(range.start);
        let length = document.offsetAt(range.end) - offset;

        // fix charater length to byte length
        length = Buffer.byteLength(codeContent.substring(offset, length), "utf8");
        // fix charater offset to byte offset
        offset = Buffer.byteLength(codeContent.substring(0, offset), "utf8");

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
            `The ${formatCommandBinPath} command is not available.  Please check your nwscript-formatter.executable setting and ensure clang executable is installed.`
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
