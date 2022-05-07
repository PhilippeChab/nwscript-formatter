# README

NWScript-Formatter is a Visual Studio Code extension to easily format NWScript code. It uses [clang-format](https://clang.llvm.org/docs/ClangFormat.html), a formatter that was originally created for C. Since NWScript was built on top of C, `clang-format` does a pretty good job.

## Dependencies

- clang-format version 3.8 or higher.
- [nwscript](https://marketplace.visualstudio.com/items?itemName=glorwinger.nwscript) language syntax for vscode.

## Usage

### Activating format on save

Change your vscode settings:

```
{
    "files.associations": {
      "*.nss": "nwscript"
    },
    "[nwscript]": {
      "editor.defaultFormatter": "PhilippeChab.nwscript-formatter"
    }
}
```

### Specifying the location of clang-format

This extension will attempt to find clang-format on your `PATH`. Alternatively, the clang-format executable can be specified in your vscode settings.json file:

```
{
    "nwscript-formatter.executable": "/absolute/path/to/clang-format"
}
```

Placeholders can also be used in the clang-format.executable value. The following placeholders are supported:

- `${workspaceRoot}` - replaced by the absolute path of the current vscode workspace root.
- `${workspaceFolder}` - replaced by the absolute path of the current vscode workspace. In case of outside-workspace files `${workspaceFolder}` expands to the absolute path of the first available workspace.
- `${cwd}` - replaced by the current working directory of vscode.
- `${env.VAR}` - replaced by the environment variable `$VAR`, e.g. `${env.HOME}` will be replaced by $HOME, your home directory.

Some examples:

- `${workspaceRoot}/node_modules/.bin/clang-format` - specifies the version of clang that has been added to your workspace by `npm install clang-format`.
- `${env.HOME}/tools/clang38/clang-format` - use a specific clang format version under your home directory.

### Formatter style

In your vscode settings, you can specify `clang-format` [rules](https://clang.llvm.org/docs/ClangFormatStyleOptions.html):

```
{
    "nwscript-formatter.style": {
      BasedOnStyle: "Google",
      AlignTrailingComments: true,
      AlignConsecutiveAssignments: true,
      ColumnLimit: 250,
      BreakBeforeBraces: "Allman",
      AlignEscapedNewlinesLeft: true,
      AlwaysBreakBeforeMultilineStrings: true,
      MaxEmptyLinesToKeep: 1,
      TabWidth: 4,
      IndentWidth: 4,
      UseTab: "Always"
    }
}
```

## Known issues

- The formatter has difficulties with long lines of concatenated strings. I recommend setting the `ColumnLimit` to a high number in order to avoid line breaks.

## Credits

The initial code base and structure comes from https://github.com/xaverh/vscode-clang-format-provider.
