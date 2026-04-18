/**
 * Initialize .tower/ directory for the Tower Assistant.
 *
 * Run automatically via `pnpm dev` or manually via `pnpm tower:init`.
 * Delegates to the shared ensureTowerDir() function.
 */

import { ensureTowerDir } from "../src/lib/init-tower";

ensureTowerDir();
