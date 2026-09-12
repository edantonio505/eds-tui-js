// Ported from eds_tui/main.py's self_upgrade() — originally just
// `npm install -g eds-tui@latest`. Reworked to clone+pack+install instead,
// for two confirmed, independent reasons (not assumptions):
//   1. The npm registry publish for this package is currently stuck on an
//      old version (account access issue on the publishing side), so
//      `@latest` from the registry would silently downgrade a real install
//      back to that ancient version.
//   2. `npm install -g git+https://github.com/...` for this repo was
//      directly tested and confirmed unreliable — it can report success
//      while producing an incomplete install (missing dist/, or even a
//      completely empty package directory), with no visible error. This
//      is npm's own internal git-dependency fetch/cache machinery, not
//      this project's packaging.
// A plain `git clone` (not npm's own git-fetch) + `npm pack` on the local
// checkout (tars local files only, no network/git resolution involved) +
// `npm install -g` that tarball sidesteps both problems — confirmed
// reliable across repeated real installs where the direct methods above
// were not. See install.sh for the same logic as a standalone script.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as ui from "./ui.js";
const REPO_URL = "https://github.com/edantonio505/eds-tui-js.git";
export function selfUpgrade() {
    ui.say("\n  Upgrading eds-tui...\n");
    const tmp = mkdtempSync(join(tmpdir(), "eds-tui-upgrade-"));
    let exitCode;
    try {
        ui.say("  Cloning eds-tui-js...");
        const clone = spawnSync("git", ["clone", "--depth", "1", "-q", REPO_URL, tmp], { stdio: "inherit" });
        if (clone.status !== 0) {
            ui.warn("git clone failed — check your network and that git is installed.");
            exitCode = clone.status ?? 1;
        }
        else {
            ui.say("  Packing...");
            const pack = spawnSync("npm", ["pack", "--silent"], { cwd: tmp, encoding: "utf8" });
            const tarball = pack.stdout.trim().split("\n").pop() ?? "";
            if (pack.status !== 0 || !tarball || !readdirSync(tmp).includes(tarball)) {
                ui.warn("npm pack did not produce a tarball — aborting.");
                exitCode = pack.status || 1;
            }
            else {
                ui.say("  Installing the ask CLI...");
                const install = spawnSync("npm", ["install", "-g", join(tmp, tarball)], { stdio: "inherit" });
                if (install.status === 0) {
                    ui.say("\n  Done. Restart ask to use the new version.\n");
                }
                else {
                    ui.warn("npm install failed — check your npm permissions.");
                }
                exitCode = install.status ?? 1;
            }
        }
    }
    finally {
        // NOT inside a process.exit() branch above — process.exit() does not
        // unwind through `finally` the way a normal return/throw does, so
        // cleanup has to happen via ordinary control flow completing first,
        // with process.exit() called only once, after this function returns.
        rmSync(tmp, { recursive: true, force: true });
    }
    process.exit(exitCode);
}
//# sourceMappingURL=upgrade.js.map