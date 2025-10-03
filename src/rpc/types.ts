import type { useHostFs } from '../fs/host'
import type { useHostTerminals } from '../terminal/host'

export type HostFunctions
  = & ReturnType<typeof useHostFs>
    & ReturnType<typeof useHostTerminals>

export interface ClientFunctions {}
