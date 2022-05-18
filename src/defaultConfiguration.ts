// Same as package.json
export const defaultConfiguration = {
  enabled: true,
  executable: "clang-format",
  style: {
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
    UseTab: "Always",
  },
  ignoredPaths: [],
};
