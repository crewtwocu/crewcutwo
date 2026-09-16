import fs from "fs";
import path from "path";
import dotenv from "dotenv";

/**
 * Load env without committing secrets.
 * Prefer local .env, then optional shared box file at /workspace/crew-lolipop/xmrcheckout.env
 * Skip shared secrets when CREW_MOCK_ONLY=1 (used by scripts/dry-run.sh).
 */
export function loadEnv(): void {
  const cwdEnv = path.join(process.cwd(), ".env");
  if (fs.existsSync(cwdEnv)) {
    dotenv.config({ path: cwdEnv });
  }

  const mockOnly =
    process.env.CREW_MOCK_ONLY === "1" ||
    process.env.CREW_MOCK_ONLY === "true";

  const shared = "/workspace/crew-lolipop/xmrcheckout.env";
  if (!mockOnly && fs.existsSync(shared)) {
    // Do not override vars already set (e.g. from .env or process env)
    dotenv.config({ path: shared, override: false });
  }

  if (!process.env.PORT) process.env.PORT = "3847";
  if (!process.env.PUBLIC_BASE_URL) {
    process.env.PUBLIC_BASE_URL = `http://localhost:${process.env.PORT}`;
  }
}
