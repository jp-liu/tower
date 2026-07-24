import { writeFileSync } from "node:fs";

writeFileSync(new URL("./script-ran", import.meta.url), "unsafe");
