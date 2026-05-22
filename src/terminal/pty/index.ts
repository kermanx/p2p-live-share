import process from 'node:process'
import { EventEmitter as Emitter, workspace } from 'vscode'
import { getSystemShell } from './shell.js'
import { TerminalProcess } from './terminalProcess.js'
import { isWindows, OS } from './utils.js'

export interface ProcessHandle {
  windowTitle: string
  onInput: (callback: (data: string) => void) => void
  onOutput: (callback: (data: string) => void) => void
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: () => void
  pid: number | undefined
}

export interface ProcessOptions {
  shell?: string
  cwd?: string
  env?: Record<string, string>
  cols?: number
  rows?: number
}

export async function createProcess(options: ProcessOptions = {}): Promise<ProcessHandle> {
  const {
    shell: shellOption,
    cwd = process.cwd(),
    env = { ...process.env },
    cols = 80,
    rows = 24,
  } = options

  // Resolve shell path
  const shell = shellOption || await getSystemShell(OS, process.env)
  const shellName = shell.split(/[/\\]/).pop() || 'shell'
  const windowTitle = `${shellName}`

  let terminalProcess: TerminalProcess | null = null
  let processPid: number | undefined

  // Event emitters for input and output
  const inputEmitter = new Emitter<string>()
  const outputEmitter = new Emitter<string>()

  // Create shell launch config
  const shellLaunchConfig = {
    name: 'Terminal',
    executable: shell,
    args: isWindows ? [] : ['-i'],
    cwd,
    env: {
      ...env,
      TERM: env.TERM || (isWindows ? 'cygwin' : 'xterm-256color'),
      COLUMNS: cols.toString(),
      LINES: rows.toString(),
    },
  }

  await new Promise((resolve) => {
    try {
      terminalProcess = new TerminalProcess(
        shellLaunchConfig,
        cwd,
        cols,
        rows,
        env,
        env,
        {
          shellIntegration: { enabled: true, suggestEnabled: true, nonce: '' },
          windowsEnableConpty: true,
          windowsUseConptyDll: false,
          environmentVariableCollections: undefined,
          workspaceFolder: workspace.workspaceFolders?.[0],
          isScreenReaderOptimized: false,
        },
      )

      // Handle process ready event
      terminalProcess.onProcessReady((event) => {
        processPid = event.pid
        resolve(undefined)
      })

      // Handle process output
      terminalProcess.onProcessData((data) => {
        outputEmitter.fire(data)
      })

      // Handle process exit
      terminalProcess.onProcessExit((code) => {
        outputEmitter.fire(`\r\n[Process exited with code ${code}]\r\n`)
      })

      // Handle input events
      inputEmitter.event((data) => {
        if (terminalProcess) {
          terminalProcess.input(data)
        }
      })

      terminalProcess.start()
    }
    catch (error: any) {
      outputEmitter.fire(`\r\n[Failed to start process: ${error?.message || error}]\r\n`)
    }
  })

  return {
    windowTitle,
    onInput: inputEmitter.event,
    onOutput: outputEmitter.event,

    write: (data: string) => {
      inputEmitter.fire(data)
    },

    resize: (cols: number, rows: number) => {
      terminalProcess?.resize(cols, rows)
    },
    kill: () => {
      terminalProcess?.shutdown(true)
    },
    get pid() {
      return processPid
    },
  }
}
