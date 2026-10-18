/** Typed view of engine/network.js. */
export interface BootstrapNode {
  host: string
  port: number
}
export function parseBootstrapList(value: string | null | undefined): BootstrapNode[]
export function swarmOptionsFromEnv(env?: Record<string, string | undefined>): { bootstrap?: BootstrapNode[] }
