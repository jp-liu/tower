export const DEFAULT_HOST: "127.0.0.1";
export function resolveRuntimeNetwork(hostValue: string | undefined, port: number): {
  bindHost: string;
  connectHost: string;
  browserUrl: string;
};
