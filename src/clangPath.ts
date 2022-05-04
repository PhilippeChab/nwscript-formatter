import { existsSync } from "fs";
import { join, delimiter } from "path";

// This must be the clang executable
const binPathCache: { [bin: string]: string } = {};

export function getBinPath(binname: string) {
  if (binPathCache[binname]) {
    return binPathCache[binname];
  }

  for (const binNameToSearch of correctBinname(binname)) {
    // nwscript-formatter.executable has a valid absolute path
    if (existsSync(binNameToSearch)) {
      binPathCache[binname] = binNameToSearch;
      return binNameToSearch;
    }

    if (process.env["PATH"]) {
      const pathparts = process.env["PATH"].split(delimiter);

      for (let i = 0; i < pathparts.length; i++) {
        const binpath = join(pathparts[i], binNameToSearch);

        if (existsSync(binpath)) {
          binPathCache[binname] = binpath;
          return binpath;
        }
      }
    }
  }

  // If everything else fails
  binPathCache[binname] = binname;

  return binname;
}

function correctBinname(binname: string): string[] {
  if (process.platform === "win32") {
    return [binname + ".exe", binname + ".bat", binname + ".cmd", binname];
  } else {
    return [binname];
  }
}
