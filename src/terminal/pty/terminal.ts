/* eslint-disable ts/no-duplicate-enum-values */
/* eslint-disable no-restricted-syntax */
// Based on https://github.com/microsoft/vscode/blob/main/src/vs/platform/terminal/common/terminal.ts

import type { Event, WorkspaceFolder as IWorkspaceFolder, ThemeIcon, Uri as URI } from 'vscode'
import type { ISerializableEnvironmentVariableCollections } from './environmentVariable.js'
import type { ISerializedCommandDetectionCapability } from './utils.js'

export const enum PosixShellType {
  Bash = 'bash',
  Fish = 'fish',
  Sh = 'sh',
  Csh = 'csh',
  Ksh = 'ksh',
  Zsh = 'zsh',

}
export const enum WindowsShellType {
  CommandPrompt = 'cmd',
  Wsl = 'wsl',
  GitBash = 'gitbash',
}

export const enum GeneralShellType {
  PowerShell = 'pwsh',
  Python = 'python',
  Julia = 'julia',
  NuShell = 'nu',
  Node = 'node',
}
export type TerminalShellType = PosixShellType | WindowsShellType | GeneralShellType | undefined

interface IRawTerminalInstanceLayoutInfo<T> {
  relativeSize: number
  terminal: T
}

export interface IRawTerminalTabLayoutInfo<T> {
  isActive: boolean
  activePersistentProcessId: number | undefined
  terminals: IRawTerminalInstanceLayoutInfo<T>[]
}

export type ITerminalTabLayoutInfoById = IRawTerminalTabLayoutInfo<number>

export interface IReconnectionProperties {
  ownerId: string
  data?: unknown
}

export type TerminalType = 'Task' | 'Local' | undefined

export enum TitleEventSource {
  /** From the API or the rename command that overrides any other type */
  Api,
  /** From the process name property */
  Process,
  /** From the VT sequence */
  Sequence,
  /** Config changed */
  Config,
}

export const enum ProcessPropertyType {
  Cwd = 'cwd',
  InitialCwd = 'initialCwd',
  FixedDimensions = 'fixedDimensions',
  Title = 'title',
  ShellType = 'shellType',
  HasChildProcesses = 'hasChildProcesses',
  ResolvedShellLaunchConfig = 'resolvedShellLaunchConfig',
  OverrideDimensions = 'overrideDimensions',
  FailedShellIntegrationActivation = 'failedShellIntegrationActivation',
  UsedShellIntegrationInjection = 'usedShellIntegrationInjection',
  ShellIntegrationInjectionFailureReason = 'shellIntegrationInjectionFailureReason',
}

export interface IProcessProperty<T extends ProcessPropertyType> {
  type: T
  value: IProcessPropertyMap[T]
}

export interface IProcessPropertyMap {
  [ProcessPropertyType.Cwd]: string
  [ProcessPropertyType.InitialCwd]: string
  [ProcessPropertyType.FixedDimensions]: IFixedTerminalDimensions
  [ProcessPropertyType.Title]: string
  [ProcessPropertyType.ShellType]: TerminalShellType | undefined
  [ProcessPropertyType.HasChildProcesses]: boolean
  [ProcessPropertyType.ResolvedShellLaunchConfig]: IShellLaunchConfig
  [ProcessPropertyType.OverrideDimensions]: ITerminalDimensionsOverride | undefined
  [ProcessPropertyType.FailedShellIntegrationActivation]: boolean | undefined
  [ProcessPropertyType.UsedShellIntegrationInjection]: boolean | undefined
  [ProcessPropertyType.ShellIntegrationInjectionFailureReason]: ShellIntegrationInjectionFailureReason | undefined
}

export interface IFixedTerminalDimensions {
  /**
   * The fixed columns of the terminal.
   */
  cols?: number

  /**
   * The fixed rows of the terminal.
   */
  rows?: number
}

export interface ITerminalLaunchResult {
  injectedArgs: string[]
}

export interface IShellLaunchConfig {
  /**
   * The name of the terminal, if this is not set the name of the process will be used.
   */
  name?: string

  /**
   * A string to follow the name of the terminal with, indicating the type of terminal
   */
  type?: 'Task' | 'Local'

  /**
   * The shell executable (bash, cmd, etc.).
   */
  executable?: string

  /**
   * The CLI arguments to use with executable, a string[] is in argv format and will be escaped,
   * a string is in "CommandLine" pre-escaped format and will be used as is. The string option is
   * only supported on Windows and will throw an exception if used on macOS or Linux.
   */
  args?: string[] | string

  /**
   * The current working directory of the terminal, this overrides the `terminal.integrated.cwd`
   * settings key.
   */
  cwd?: string | URI

  /**
   * A custom environment for the terminal, if this is not set the environment will be inherited
   * from the VS Code process.
   */
  env?: ITerminalEnvironment

  /**
   * Whether to ignore a custom cwd from the `terminal.integrated.cwd` settings key (e.g. if the
   * shell is being launched by an extension).
   */
  ignoreConfigurationCwd?: boolean

  /**
   * The reconnection properties for this terminal
   */
  reconnectionProperties?: IReconnectionProperties

  /** Whether to wait for a key press before closing the terminal. */
  waitOnExit?: WaitOnExitValue

  /**
   * A string including ANSI escape sequences that will be written to the terminal emulator
   * _before_ the terminal process has launched, when a string is specified, a trailing \n is
   * added at the end. This allows for example the terminal instance to display a styled message
   * as the first line of the terminal. Use \x1b over \033 or \e for the escape control character.
   */
  initialText?: string | { text: string, trailingNewLine: boolean }

  /**
   * Custom PTY/pseudoterminal process to use.
   */
  customPtyImplementation?: (terminalId: number, cols: number, rows: number) => ITerminalChildProcess

  /**
   * A UUID generated by the extension host process for terminals created on the extension host process.
   */
  extHostTerminalId?: string

  /**
   * This is a terminal that attaches to an already running terminal.
   */
  attachPersistentProcess?: {
    id: number
    findRevivedId?: boolean
    pid: number
    title: string
    titleSource: TitleEventSource
    cwd: string
    icon?: TerminalIcon
    color?: string
    hasChildProcesses?: boolean
    fixedDimensions?: IFixedTerminalDimensions
    environmentVariableCollections?: ISerializableEnvironmentVariableCollections
    reconnectionProperties?: IReconnectionProperties
    type?: TerminalType
    waitOnExit?: WaitOnExitValue
    hideFromUser?: boolean
    isFeatureTerminal?: boolean
    shellIntegrationNonce: string
    tabActions?: ITerminalTabAction[]
  }

  /**
   * Whether the terminal process environment should be exactly as provided in
   * `TerminalOptions.env`. When this is false (default), the environment will be based on the
   * window's environment and also apply configured platform settings like
   * `terminal.integrated.env.windows` on top. When this is true, the complete environment must be
   * provided as nothing will be inherited from the process or any configuration.
   */
  strictEnv?: boolean

  /**
   * Whether the terminal process environment will inherit VS Code's "shell environment" that may
   * get sourced from running a login shell depnding on how the application was launched.
   * Consumers that rely on development tools being present in the $PATH should set this to true.
   * This will overwrite the value of the inheritEnv setting.
   */
  useShellEnvironment?: boolean

  /**
   * When enabled the terminal will run the process as normal but not be surfaced to the user
   * until `Terminal.show` is called. The typical usage for this is when you need to run
   * something that may need interactivity but only want to tell the user about it when
   * interaction is needed. Note that the terminals will still be exposed to all extensions
   * as normal. The hidden terminals will not be restored when the workspace is next opened.
   */
  hideFromUser?: boolean

  /**
   * Whether this terminal is not a terminal that the user directly created and uses, but rather
   * a terminal used to drive some VS Code feature.
   */
  isFeatureTerminal?: boolean

  /**
   * Whether this terminal was created by an extension.
   */
  isExtensionOwnedTerminal?: boolean

  /**
   * The icon for the terminal, used primarily in the terminal tab.
   */
  icon?: TerminalIcon

  /**
   * The color ID to use for this terminal. If not specified it will use the default fallback
   */
  color?: string

  /**
   * When a parent terminal is provided via API, the group needs
   * to find the index in order to place the child
   * directly to the right of its parent.
   */
  parentTerminalId?: number

  /**
   * The dimensions for the instance as set by the user
   * or via Size to Content Width
   */
  fixedDimensions?: IFixedTerminalDimensions

  /**
   * Opt-out of the default terminal persistence on restart and reload
   */
  isTransient?: boolean

  /**
   * Attempt to force shell integration to be enabled by bypassing the {@link isFeatureTerminal}
   * equals false requirement.
   */
  forceShellIntegration?: boolean

  /**
   * Create a terminal without shell integration even when it's enabled
   */
  ignoreShellIntegration?: boolean

  /**
   * Actions to include inline on hover of the terminal tab. E.g. the "Rerun task" action
   */
  tabActions?: ITerminalTabAction[]
  /**
   * Report terminal's shell environment variables to VS Code and extensions
   */
  shellIntegrationEnvironmentReporting?: boolean

  /**
   * A custom nonce to use for shell integration when provided by an extension.
   * This allows extensions to control shell integration for terminals they create.
   */
  shellIntegrationNonce?: string

  /**
   * For task terminals, controls whether to preserve the task name after task completion.
   * When true, prevents process title changes from overriding the task name.
   */
  preserveTaskName?: boolean
}

export interface ITerminalTabAction {
  id: string
  label: string
  icon?: ThemeIcon
}

export type WaitOnExitValue = boolean | string | ((exitCode: number) => string)

export type TerminalIcon = ThemeIcon | URI | { light: URI, dark: URI }

/**
 * A set of options for the terminal process. These differ from the shell launch config in that they
 * are set internally to the terminal component, not from the outside.
 */
export interface ITerminalProcessOptions {
  shellIntegration: {
    enabled: boolean
    suggestEnabled: boolean
    nonce: string
  }
  windowsEnableConpty: boolean
  windowsUseConptyDll: boolean
  environmentVariableCollections: ISerializableEnvironmentVariableCollections | undefined
  workspaceFolder: IWorkspaceFolder | undefined
  isScreenReaderOptimized: boolean
}

export interface ITerminalEnvironment {
  [key: string]: string | null | undefined
}

export interface ITerminalLaunchError {
  message: string
  code?: number
}

export interface IProcessReadyEvent {
  pid: number
  cwd: string
  windowsPty: IProcessReadyWindowsPty | undefined
}

export interface IProcessReadyWindowsPty {
  /**
   * What pty emulation backend is being used.
   */
  backend: 'conpty' | 'winpty'
  /**
   * The Windows build version (eg. 19045)
   */
  buildNumber: number
}

/**
 * An interface representing a raw terminal child process, this contains a subset of the
 * child_process.ChildProcess node.js interface.
 */
export interface ITerminalChildProcess {
  /**
   * A unique identifier for the terminal process. Note that the uniqueness only applies to a
   * given pty service connection, IDs will be duplicated for remote and local terminals for
   * example. The ID will be 0 if it does not support reconnection.
   */
  id: number

  /**
   * Whether the process should be persisted across reloads.
   */
  shouldPersist: boolean

  onProcessData: Event<IProcessDataEvent | string>
  onProcessReady: Event<IProcessReadyEvent>
  onProcessReplayComplete?: Event<void>
  onDidChangeProperty: Event<IProcessProperty<any>>
  onProcessExit: Event<number | undefined>
  onRestoreCommands?: Event<ISerializedCommandDetectionCapability>

  /**
   * Starts the process.
   *
   * @returns undefined when the process was successfully started, otherwise an object containing
   * information on what went wrong.
   */
  start: () => Promise<ITerminalLaunchError | ITerminalLaunchResult | undefined>

  /**
   * Detach the process from the UI and await reconnect.
   * @param forcePersist Whether to force the process to persist if it supports persistence.
   */
  detach?: (forcePersist?: boolean) => Promise<void>

  /**
   * Frees the port and kills the process
   */
  freePortKillProcess?: (port: string) => Promise<{ port: string, processId: string }>

  /**
   * Shutdown the terminal process.
   *
   * @param immediate When true the process will be killed immediately, otherwise the process will
   * be given some time to make sure no additional data comes through.
   */
  shutdown: (immediate: boolean) => void
  input: (data: string) => void
  sendSignal: (signal: string) => void
  processBinary: (data: string) => Promise<void>
  resize: (cols: number, rows: number) => void
  clearBuffer: () => void | Promise<void>

  /**
   * Acknowledge a data event has been parsed by the terminal, this is used to implement flow
   * control to ensure remote processes to not get too far ahead of the client and flood the
   * connection.
   * @param charCount The number of characters being acknowledged.
   */
  acknowledgeDataEvent: (charCount: number) => void

  /**
   * Sets the unicode version for the process, this drives the size of some characters in the
   * xterm-headless instance.
   */
  setUnicodeVersion: (version: '6' | '11') => Promise<void>

  getInitialCwd: () => Promise<string>
  getCwd: () => Promise<string>
  refreshProperty: <T extends ProcessPropertyType>(property: T) => Promise<IProcessPropertyMap[T]>
  updateProperty: <T extends ProcessPropertyType>(property: T, value: IProcessPropertyMap[T]) => Promise<void>
}

export const enum FlowControlConstants {
  /**
   * The number of _unacknowledged_ chars to have been sent before the pty is paused in order for
   * the client to catch up.
   */
  HighWatermarkChars = 100000,
  /**
   * After flow control pauses the pty for the client the catch up, this is the number of
   * _unacknowledged_ chars to have been caught up to on the client before resuming the pty again.
   * This is used to attempt to prevent pauses in the flowing data; ideally while the pty is
   * paused the number of unacknowledged chars would always be greater than 0 or the client will
   * appear to stutter. In reality this balance is hard to accomplish though so heavy commands
   * will likely pause as latency grows, not flooding the connection is the important thing as
   * it's shared with other core functionality.
   */
  LowWatermarkChars = 5000,
  /**
   * The number characters that are accumulated on the client side before sending an ack event.
   * This must be less than or equal to LowWatermarkChars or the terminal max never unpause.
   */
  CharCountAckSize = 5000,
}

interface IProcessDataEvent {
  data: string
  trackCommit: boolean
  /**
   * When trackCommit is set, this will be set to a promise that resolves when the data is parsed.
   */
  writePromise?: Promise<void>
}

interface ITerminalDimensions {
  /**
   * The columns of the terminal.
   */
  cols: number

  /**
   * The rows of the terminal.
   */
  rows: number
}

interface ITerminalDimensionsOverride extends Readonly<ITerminalDimensions> {
  /**
   * indicate that xterm must receive these exact dimensions, even if they overflow the ui!
   */
  forceExactSize?: boolean
}

export const enum ShellIntegrationInjectionFailureReason {
  /**
   * The setting is disabled.
   */
  InjectionSettingDisabled = 'injectionSettingDisabled',
  /**
   * There is no executable (so there's no way to determine how to inject).
   */
  NoExecutable = 'noExecutable',
  /**
   * It's a feature terminal (tasks, debug), unless it's explicitly being forced.
   */
  FeatureTerminal = 'featureTerminal',
  /**
   * The ignoreShellIntegration flag is passed (eg. relaunching without shell integration).
   */
  IgnoreShellIntegrationFlag = 'ignoreShellIntegrationFlag',
  /**
   * Shell integration doesn't work with winpty.
   */
  Winpty = 'winpty',
  /**
   * We're conservative whether we inject when we don't recognize the arguments used for the
   * shell as we would prefer launching one without shell integration than breaking their profile.
   */
  UnsupportedArgs = 'unsupportedArgs',
  /**
   * The shell doesn't have built-in shell integration. Note that this doesn't mean the shell
   * won't have shell integration in the end.
   */
  UnsupportedShell = 'unsupportedShell',

  /**
   * For zsh, we failed to set the sticky bit on the shell integration script folder.
   */
  FailedToSetStickyBit = 'failedToSetStickyBit',

  /**
   * For zsh, we failed to create a temp directory for the shell integration script.
   */
  FailedToCreateTmpDir = 'failedToCreateTmpDir',
}

// Registry.add(TerminalExtensions.Backend, new TerminalBackendRegistry())

// const ILocalPtyService = createDecorator<ILocalPtyService>('localPtyService')

// /**
//  * A service responsible for communicating with the pty host process on Electron.
//  *
//  * **This service should only be used within the terminal component.**
//  */
// // eslint-disable-next-line ts/no-redeclare
// interface ILocalPtyService extends IPtyHostService { }
