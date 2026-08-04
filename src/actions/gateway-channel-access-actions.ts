"use server";

import { listGatewayChannelAccess } from "@/lib/harness/gateway-channel-access";

export async function getGatewayChannelAccessList() {
  return listGatewayChannelAccess();
}
