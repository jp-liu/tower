"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  CliPluginApplicationError,
  getCliPluginApplication,
  type CliEnvironmentVariable,
} from "@/lib/ai/cli-plugin-service";
import { testPluginCliConnection } from "@/lib/ai/cli-plugin-provider";
import { reconcileProviderIntegrations } from "@/lib/ai/provider-reconciliation";
import type { CliPluginSecretReference } from "@/lib/ai/cli-plugin-shared";

type ActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        diagnostic?: {
          dependency: string;
          state: "missing" | "probe-failed" | "version-incompatible" | "ready";
          commandPath: string | null;
          detectedVersion: string | null;
          supportedVersions: string;
          homepage: string;
          installDocs: string;
          managedByTower: false;
        };
      };
    };

const packageNameSchema = z.string().trim().min(1).max(214);
const exactVersionSchema = z.string().trim().min(1).max(100);
const directorySchema = z.string().trim().min(1).max(4_096);
const digestSchema = z.string().trim().min(20).max(256);
const pluginIdSchema = z.string().trim().min(1).max(214);
const searchSchema = z.string().trim().max(200);
const environmentVariableSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200).regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  value: z.string().max(64_000),
  enabled: z.boolean(),
  sensitive: z.boolean(),
});
const saveConnectionSchema = z.object({
  connectionId: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  commandOverride: z.string().trim().max(4_096).nullable().optional(),
  baseArgs: z.array(z.string().max(4_096)).max(100),
  envVars: z.array(environmentVariableSchema).max(200),
  settings: z.record(z.string(), z.unknown()).refine(
    (value) => JSON.stringify(value).length <= 256_000,
    "Settings are too large",
  ),
});
const secretReferenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("environment"), key: z.string().trim().min(1).max(200) }),
  z.object({ kind: z.literal("setting"), key: z.string().trim().min(1).max(200) }),
]);

function failure(error: unknown): ActionResult<never> {
  if (error instanceof CliPluginApplicationError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.diagnostic ? { diagnostic: error.diagnostic } : {}),
      },
    };
  }
  return {
    ok: false,
    error: {
      code: "operation_failed",
      message: "The plugin operation could not be completed",
    },
  };
}

async function action<T>(operation: () => Promise<T>, mutate = false): Promise<ActionResult<T>> {
  try {
    const data = await operation();
    if (mutate) revalidatePath("/settings");
    return { ok: true, data };
  } catch (error) {
    return failure(error);
  }
}

export async function listCliPlugins() {
  return action(() => getCliPluginApplication().list());
}

export async function listCliProviderCatalog(search = "") {
  return action(() => getCliPluginApplication().listCatalog(searchSchema.parse(search)));
}

export async function planCatalogCliPlugin(extensionId: string, version: string) {
  return action(() => getCliPluginApplication().planCatalog(
    pluginIdSchema.parse(extensionId),
    exactVersionSchema.parse(version),
  ));
}

export async function planNpmCliPlugin(packageName: string, version: string) {
  return action(() => getCliPluginApplication().planNpm(
    packageNameSchema.parse(packageName),
    exactVersionSchema.parse(version),
  ));
}

export async function planLocalCliPlugin(directory: string) {
  return action(() => getCliPluginApplication().planLocal(directorySchema.parse(directory)));
}

export async function reviewInstalledCliPlugin(pluginId: string) {
  return action(() => getCliPluginApplication().reviewInstalled(pluginIdSchema.parse(pluginId)));
}

export async function installCliPlugin(planDigest: string) {
  return action(
    () => getCliPluginApplication().install(digestSchema.parse(planDigest)),
    true,
  );
}

export async function confirmAndEnableCliPlugin(planDigest: string) {
  return action(async () => {
    const plugin = await getCliPluginApplication().confirmAndEnable(digestSchema.parse(planDigest));
    await reconcileProviderIntegrations({ provider: plugin.id, trigger: "extension-enabled" });
    return plugin;
  }, true);
}

export async function disableCliPlugin(pluginId: string) {
  return action(async () => {
    await getCliPluginApplication().disable(pluginIdSchema.parse(pluginId));
    return { disabled: true };
  }, true);
}

export async function enableCliPlugin(pluginId: string) {
  return action(async () => {
    const plugin = await getCliPluginApplication().enable(pluginIdSchema.parse(pluginId));
    await reconcileProviderIntegrations({ provider: plugin.id, trigger: "extension-enabled" });
    return plugin;
  }, true);
}

export async function uninstallCliPlugin(pluginId: string) {
  return action(async () => {
    await getCliPluginApplication().uninstall(pluginIdSchema.parse(pluginId));
    return { uninstalled: true, connectionPreserved: true };
  }, true);
}

export async function recoverCliPluginRegistry() {
  return action(() => getCliPluginApplication().recoverRegistry(), true);
}

export async function getCliPluginConnection(pluginId: string) {
  return action(() => getCliPluginApplication().getConnectionDetail(pluginIdSchema.parse(pluginId)));
}

export async function saveCliPluginConnection(input: {
  connectionId: string;
  name: string;
  enabled: boolean;
  commandOverride?: string | null;
  baseArgs: string[];
  envVars: CliEnvironmentVariable[];
  settings: Record<string, unknown>;
}) {
  return action(async () => {
    const connection = await getCliPluginApplication().saveConnection(saveConnectionSchema.parse(input));
    if (connection.enabled) {
      await reconcileProviderIntegrations({
        provider: connection.pluginId,
        connectionId: connection.id,
        trigger: "dependency-changed",
      });
    }
    return connection;
  }, true);
}

export async function revealCliPluginSecret(
  connectionId: string,
  reference: CliPluginSecretReference,
) {
  return action(() => getCliPluginApplication().revealConnectionSecret(
    z.string().trim().min(1).max(200).parse(connectionId),
    secretReferenceSchema.parse(reference),
  ));
}

export async function testCliPluginConnection(pluginId: string) {
  return action(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 50_000);
    try {
      const parsedPluginId = pluginIdSchema.parse(pluginId);
      await reconcileProviderIntegrations({
        provider: parsedPluginId,
        trigger: "hello-success",
        skipHello: true,
      });
      const probe = await testPluginCliConnection(parsedPluginId, controller.signal);
      const reconciliation = await reconcileProviderIntegrations({
        provider: parsedPluginId,
        trigger: "hello-success",
        helloAlreadySucceeded: true,
      });
      return { ...probe, reconciliation };
    } finally {
      clearTimeout(timeout);
    }
  }, true);
}
