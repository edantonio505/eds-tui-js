// Ported from eds_tui/main.py's self_upgrade() — adapted for npm
// distribution instead of pipx: `npm install -g eds-tui@latest` replaces
// `pipx uninstall eds-tui && pipx install git+https://...`, matching the
// whole reason for this rewrite (no git clone at install/upgrade time).
import { spawnSync } from "node:child_process";
import * as ui from "./ui.js";
export function selfUpgrade() {
    ui.say("\n  Upgrading eds-tui from npm...\n");
    const result = spawnSync("npm", ["install", "-g", "eds-tui@latest"], { stdio: "inherit" });
    if (result.status === 0) {
        ui.say("\n  Done. Restart ask to use the new version.\n");
    }
    else {
        ui.warn("npm install failed — check your npm permissions/registry access.");
    }
    process.exit(result.status ?? 1);
}
//# sourceMappingURL=upgrade.js.map