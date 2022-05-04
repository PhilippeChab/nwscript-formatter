import { existsSync } from "fs";
import { join, delimiter } from "path";

// This must be the clang executable
const binPathCache: { [bin: string]: string } = {};

export function getBinPath(binName: string) {
  if (binPathCache[binName]) {
    return binPathCache[binName];
  }

  for (const binNameToSearch of platformBinName(binName)) {
    // nwscript-formatter.executable has a valid absolute path
    if (existsSync(binNameToSearch)) {
      binPathCache[binName] = binNameToSearch;
      return binNameToSearch;
    }

    if (process.env["PATH"]) {
      const pathParts = process.env["PATH"].split(delimiter);

      for (let i = 0; i < pathParts.length; i++) {
        const binPath = join(pathParts[i], binNameToSearch);

        if (existsSync(binPath)) {
          binPathCache[binName] = binPath;
          return binPath;
        }
      }
    }
  }

  // If everything else fails
  binPathCache[binName] = binName;
  return binName;
}

function platformBinName(binName: string) {
  if (process.platform === "win32") {
    return [binName + ".exe", binName + ".bat", binName + ".cmd", binName];
  } else {
    return [binName];
  }
}
