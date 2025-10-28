import type { useHostFs } from '../fs/host'
import type { useHostScm } from '../scm/host'
import type { useHostTerminals } from '../terminal/host'

export type HostFunctions
  = & ReturnType<typeof useHostFs>
    & ReturnType<typeof useHostTerminals>
    & ReturnType<typeof useHostScm>

export interface ClientFunctions {}
