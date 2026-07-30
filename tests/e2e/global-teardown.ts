import { teardown } from "../global-setup";

export default async function globalTeardown() {
  await teardown();
}
