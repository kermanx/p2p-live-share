import type { Converter as CodeConverter } from 'vscode-languageclient/$test/common/codeConverter'
import type { Connection } from '../sync/connection'
import { nanoid } from 'nanoid'
import { onScopeDispose, watch } from 'reactive-vscode'
import * as vscode from 'vscode'
import { commands, Uri } from 'vscode'
import { createConverter as codeConverter } from 'vscode-languageclient/$test/common/codeConverter'
import { createConverter as protocolConverter } from 'vscode-languageclient/$test/common/protocolConverter'
import * as lsp from 'vscode-languageserver'
import { createConnection } from 'vscode-languageserver/browser'
import { ExecuteHostCommand, useLsConnection } from './common'

export function useHostLs(connection: Connection) {
  const connections = new Map<string, lsp.Connection>()
  onScopeDispose(() => {
    for (const conn of connections.values()) {
      conn.dispose()
    }
    connections.clear()
  })

  watch(connection.peers, (peers) => {
    if (!peers) {
      return
    }
    for (const [id, conn] of connections) {
      if (!peers.includes(id)) {
        conn.dispose()
        connections.delete(id)
      }
    }
    for (const id of peers) {
      if (!connections.has(id)) {
        const { reader, writer } = useLsConnection(connection, id)
        const lc = createConnection(reader, writer)
        connections.set(id, lc)

        setupConnection(lc, connection)
        lc.listen()
      }
    }
  }, { immediate: true, deep: true })
}

function setupConnection(lc: lsp.Connection, c: Connection) {
  const p2c = protocolConverter(uri => c.toHostUri(Uri.parse(uri)), true, true, true)
  const c2p = codeConverter(uri => (c.toTrackUri(uri) ?? uri).toString())
  const c2pExt = c2pExtension(c2p)

  lc.onInitialize(() => {
    return {
      capabilities: {
        hoverProvider: true,
        definitionProvider: true,
        typeDefinitionProvider: true,
        referencesProvider: true,
        implementationProvider: true,
        completionProvider: { triggerCharacters: ['.'] },
        signatureHelpProvider: { triggerCharacters: ['(', ','] },
        documentSymbolProvider: true,
        workspaceSymbolProvider: true,
        codeActionProvider: true,
        documentFormattingProvider: true,
        documentRangeFormattingProvider: true,
        documentOnTypeFormattingProvider: {
          firstTriggerCharacter: '}',
          moreTriggerCharacter: [';', '\n'],
        },
        renameProvider: true,
        documentLinkProvider: { resolveProvider: !1 },
        colorProvider: true,
        executeCommandProvider: { commands: [] },
        codeLensProvider: { resolveProvider: true },
      },
    }
  })

  lc.onHover(async (params) => {
    const uri = p2c.asUri(params.textDocument.uri)
    const position = p2c.asPosition(params.position)

    const hovers = await commands.executeCommand(
      'vscode.executeHoverProvider',
      uri,
      position,
    ) as vscode.Hover[]

    if (!hovers || hovers.length === 0) {
      return null
    }

    const contents = hovers
      .map(hover => hover.contents)
      .reduce((acc, curr) => acc.concat(curr), [])

    return c2pExt.asHover(new vscode.Hover(contents, hovers[0].range))
  })

  lc.onDefinition(async (params) => {
    const uri = p2c.asUri(params.textDocument.uri)
    const position = p2c.asPosition(params.position)

    const definitions = await commands.executeCommand(
      'vscode.executeDefinitionProvider',
      uri,
      position,
    ) as vscode.Definition | vscode.DefinitionLink[] | undefined

    return c2pExt.asDefinitionResult(definitions)
  })

  lc.onTypeDefinition(async (params) => {
    const uri = p2c.asUri(params.textDocument.uri)
    const position = p2c.asPosition(params.position)

    try {
      const typeDefinitions = await commands.executeCommand(
        'vscode.executeTypeDefinitionProvider',
        uri,
        position,
      ) as vscode.Location[]

      return typeDefinitions ? typeDefinitions.map(r => c2pExt.asLocation(r)) : null
    }
    catch {
      return null
    }
  })

  lc.onReferences(async (params) => {
    const uri = p2c.asUri(params.textDocument.uri)
    const position = p2c.asPosition(params.position)

    const references = await commands.executeCommand(
      'vscode.executeReferenceProvider',
      uri,
      position,
    ) as vscode.Location[]

    return c2pExt.asReferences(references)
  })

  lc.onImplementation(async (params) => {
    const uri = p2c.asUri(params.textDocument.uri)
    const position = p2c.asPosition(params.position)

    const implementations = await commands.executeCommand(
      'vscode.executeImplementationProvider',
      uri,
      position,
    ) as vscode.Definition | vscode.DefinitionLink[] | undefined

    return c2pExt.asDefinitionResult(implementations)
  })

  lc.onDocumentHighlight(async (params) => {
    const uri = p2c.asUri(params.textDocument.uri)
    const position = p2c.asPosition(params.position)

    const highlights = await commands.executeCommand(
      'vscode.executeDocumentHighlights',
      uri,
      position,
    ) as vscode.DocumentHighlight[]

    return c2pExt.asDocumentHighlights(highlights)
  })

  lc.onCompletion(async (params) => {
    const uri = p2c.asUri(params.textDocument.uri)
    const position = p2c.asPosition(params.position)

    const completions = await commands.executeCommand(
      'vscode.executeCompletionItemProvider',
      uri,
      position,
      params.context?.triggerCharacter,
    ) as any

    if (completions) {
      return completions.items.map((item: any) => {
        item.fromEdit = true
        if (item.range && item.range.replacing) {
          item.range = item.range.replacing
        }
        return c2p.asCompletionItem(item, true)
      })
    }
  })

  lc.onSignatureHelp(async (params) => {
    const uri = p2c.asUri(params.textDocument.uri)
    const position = p2c.asPosition(params.position)

    const signatureHelp = await commands.executeCommand(
      'vscode.executeSignatureHelpProvider',
      uri,
      position,
    ) as vscode.SignatureHelp | undefined

    return c2pExt.asSignatureHelp(signatureHelp)
  })

  lc.onDocumentSymbol(async (params) => {
    const uri = p2c.asUri(params.textDocument.uri)

    const symbols = await commands.executeCommand(
      'vscode.executeDocumentSymbolProvider',
      uri,
    ) as vscode.SymbolInformation[] | undefined

    return c2pExt.asSymbolInformations(symbols, uri)
  })

  lc.onWorkspaceSymbol(async (params) => {
    const symbols = await commands.executeCommand(
      'vscode.executeWorkspaceSymbolProvider',
      params.query,
    ) as vscode.SymbolInformation[] | undefined

    return c2pExt.asSymbolInformations(symbols, undefined)
  })

  lc.onCodeAction(async (params) => {
    try {
      const uri = p2c.asUri(params.textDocument.uri)
      const range = p2c.asRange(params.range)

      await vscode.workspace.openTextDocument(uri)
      const codeActions = await commands.executeCommand(
        'vscode.executeCodeActionProvider',
        uri,
        range,
        undefined,
        Number.MAX_VALUE,
      ) as vscode.CodeAction[] | undefined

      return codeActions?.map((e) => {
        return c2pExt.asCodeAction(e)
      })
    }
    catch (E) {
      console.error('CodeAction', E)
    }
  })

  lc.onExecuteCommand(async (params) => {
    await c2pExt.executeCommand(params)
  })

  lc.onDocumentFormatting(async (params) => {
    const uri = p2c.asUri(params.textDocument.uri)

    const edits = await commands.executeCommand(
      'vscode.executeFormatDocumentProvider',
      uri,
      params.options,
    ) as vscode.TextEdit[] | undefined

    return edits?.map(e => c2p.asTextEdit(e))
  })

  lc.onDocumentRangeFormatting(async (params) => {
    const uri = p2c.asUri(params.textDocument.uri)
    const range = p2c.asRange(params.range)

    const edits = await commands.executeCommand(
      'vscode.executeFormatRangeProvider',
      uri,
      range,
      params.options,
    ) as vscode.TextEdit[] | undefined

    return edits?.map(e => c2p.asTextEdit(e))
  })

  lc.onDocumentOnTypeFormatting(async (params) => {
    const uri = p2c.asUri(params.textDocument.uri)
    const position = p2c.asPosition(params.position)

    const edits = await commands.executeCommand(
      'vscode.executeFormatOnTypeProvider',
      uri,
      position,
      params.ch,
      params.options,
    ) as vscode.TextEdit[] | undefined

    return edits?.map(e => c2p.asTextEdit(e))
  })

  lc.onRenameRequest(async (params) => {
    const uri = p2c.asUri(params.textDocument.uri)
    const position = p2c.asPosition(params.position)

    const workspaceEdit = await commands.executeCommand(
      'vscode.executeDocumentRenameProvider',
      uri,
      position,
      params.newName,
    ) as vscode.WorkspaceEdit | undefined

    return c2pExt.asWorkspaceEdit(workspaceEdit)
  })

  lc.onDocumentLinks(async (params) => {
    const uri = p2c.asUri(params.textDocument.uri)

    const links = await commands.executeCommand(
      'vscode.executeLinkProvider',
      uri,
    ) as any[] | undefined

    return links?.map(e => c2p.asDocumentLink(e))
  })

  lc.onDocumentColor(async (params) => {
    const uri = p2c.asUri(params.textDocument.uri)

    try {
      const colors = await commands.executeCommand(
        'vscode.executeDocumentColorProvider',
        uri,
      ) as any[] | undefined

      return colors?.map(e => c2pExt.asColorInformation(e))
    }
    catch {
      return null
    }
  })

  lc.onColorPresentation(async (params) => {
    const uri = p2c.asUri(params.textDocument.uri)
    const range = p2c.asRange(params.range)
    const color = p2c.asColor(params.color)

    try {
      const presentations = await commands.executeCommand(
        'vscode.executeColorPresentationProvider',
        color,
        { uri, range },
      ) as any[] | undefined

      return presentations?.map(e => c2pExt.asColorPresentation(e))
    }
    catch {
      return null
    }
  })

  lc.onCodeLens(async (params) => {
    const uri = p2c.asUri(params.textDocument.uri)

    try {
      const codeLenses = await commands.executeCommand(
        'vscode.executeCodeLensProvider',
        uri,
        Number.MAX_VALUE,
      ) as vscode.CodeLens[] | undefined

      return codeLenses?.map((e) => {
        return c2p.asCodeLens({
          ...e,
          command: e.command ? c2pExt.asCommand(e.command) : undefined,
        })
      })
    }
    catch {
      return null
    }
  })
}

function c2pExtension(c2p: CodeConverter) {
  const commandArguments = new Map<string, any[]>()

  function asCommand(command: vscode.Command): lsp.Command {
    const id = nanoid()
    commandArguments.set(id, command.arguments || [])
    return c2p.asCommand({
      ...command,
      command: ExecuteHostCommand,
      arguments: [command.command, id],
    })
  }

  async function executeCommand(params: lsp.ExecuteCommandParams) {
    if (params.command.startsWith(ExecuteHostCommand)) {
      const [command, id] = params.arguments!
      const args = commandArguments.get(id)
      if (!args) {
        throw new Error(`No arguments found for command: ${command}`)
      }
      await commands.executeCommand(command, ...args)
    }
    else {
      throw new Error(`Unsupported command: ${params.command}`)
    }
  }

  function asLocation(location: vscode.Location): lsp.Location {
    return lsp.Location.create(c2p.asUri(location.uri), c2p.asRange(location.range))
  }

  function asLocationLink(locationLink: vscode.LocationLink): lsp.LocationLink {
    return lsp.LocationLink.create(
      c2p.asUri(locationLink.targetUri),
      c2p.asRange(locationLink.targetRange),
      locationLink.targetSelectionRange ? c2p.asRange(locationLink.targetSelectionRange) : c2p.asRange(locationLink.targetRange),
      locationLink.originSelectionRange ? c2p.asRange(locationLink.originSelectionRange) : undefined,
    )
  }

  function asDocumentHighlightKind(kind: vscode.DocumentHighlightKind): lsp.DocumentHighlightKind {
    switch (kind) {
      case vscode.DocumentHighlightKind.Text:
        return lsp.DocumentHighlightKind.Text
      case vscode.DocumentHighlightKind.Read:
        return lsp.DocumentHighlightKind.Read
      case vscode.DocumentHighlightKind.Write:
        return lsp.DocumentHighlightKind.Write
      default:
        return lsp.DocumentHighlightKind.Text
    }
  }

  function asDocumentHighlight(highlight: vscode.DocumentHighlight): lsp.DocumentHighlight {
    const result = lsp.DocumentHighlight.create(c2p.asRange(highlight.range))
    if (typeof highlight.kind === 'number') {
      result.kind = asDocumentHighlightKind(highlight.kind)
    }
    return result
  }

  function asParameterInformation(param: vscode.ParameterInformation, signatureLabel: string): lsp.ParameterInformation {
    const result = lsp.ParameterInformation.create(param.label)

    if (param.documentation) {
      result.documentation = typeof param.documentation === 'string'
        ? param.documentation
        : param.documentation.value
    }

    if (typeof param.label !== 'string') {
      const labelRange = param.label as [number, number]
      result.label = signatureLabel.substr(labelRange[0], labelRange[1] - labelRange[0])
    }

    return result
  }

  function asParameterInformations(signature: vscode.SignatureInformation): lsp.ParameterInformation[] {
    return signature.parameters!.map(param => asParameterInformation(param, signature.label))
  }

  function asSignatureInformation(signature: vscode.SignatureInformation): lsp.SignatureInformation {
    const result = lsp.SignatureInformation.create(signature.label)

    if (signature.documentation) {
      result.documentation = typeof signature.documentation === 'string'
        ? signature.documentation
        : signature.documentation.value
    }

    if (signature.parameters) {
      result.parameters = asParameterInformations(signature)
    }

    return result
  }

  function asWorkspaceEdit(workspaceEdit: vscode.WorkspaceEdit | undefined) {
    if (!workspaceEdit) {
      return undefined
    }

    const changes: Record<string, lsp.TextEdit[]> = {}
    workspaceEdit.entries().forEach(([uri, edits]) => {
      changes[c2p.asUri(uri)] = edits.map(edit => c2p.asTextEdit(edit))
    })

    return { changes }
  }

  function isMarkdownString(content: any): content is vscode.MarkdownString {
    return content && typeof content === 'object' && 'value' in content
  }

  function isString(value: any): value is string {
    return typeof value === 'string'
  }

  function asHoverContent(content: vscode.MarkdownString | string, index: number): string {
    if (isMarkdownString(content)) {
      return index > 0 ? `\n${content.value}` : content.value
    }
    return isString(content) && index > 0 ? `\n${content}` : content
  }

  return {
    asCommand,
    executeCommand,
    asHover(hover: vscode.Hover | null): lsp.Hover | null {
      if (hover == null) {
        return null
      }
      return {
        range: hover.range ? c2p.asRange(hover.range) : undefined,
        contents: hover.contents.map((content, index) => asHoverContent(content as vscode.MarkdownString | string, index)),
      }
    },
    asDefinitionResult(result: vscode.Definition | vscode.DefinitionLink[] | undefined) {
      if (result) {
        return Array.isArray(result)
          ? result.length > 0 && 'targetUri' in result[0]
            ? (result as vscode.DefinitionLink[]).map(r => asLocationLink(r))
            : (result as vscode.Location[]).map(r => asLocation(r))
          : asLocation(result)
      }
    },
    asDefinitionResultAlternate(result: vscode.LocationLink[] | vscode.LocationLink | undefined) {
      if (result) {
        return Array.isArray(result)
          ? result.map(link =>
              lsp.Location.create(
                c2p.asUri(link.targetUri),
                c2p.asRange(link.targetRange),
              ),
            )
          : undefined
      }
    },
    asLocation,
    asLocationLink,
    asReferences(references: vscode.Location[] | undefined) {
      if (references) {
        return references.map(ref => asLocation(ref)).filter(Boolean) as lsp.Location[]
      }
    },
    asDocumentHighlights(highlights: vscode.DocumentHighlight[] | undefined) {
      if (highlights) {
        return highlights.map(asDocumentHighlight)
      }
    },
    asSymbolInformations(symbols: vscode.SymbolInformation[] | undefined, uri: vscode.Uri | undefined) {
      if (symbols) {
        return symbols.map((symbol) => {
          const range = symbol.location?.range
          const symbolUri = symbol.location ? symbol.location.uri : uri
          if (!range || !symbolUri) {
            return null
          }
          const symbolInfo = lsp.SymbolInformation.create(
            symbol.name,
            symbol.kind as lsp.SymbolKind,
            c2p.asRange(range),
            c2p.asUri(symbolUri),
          )
          if (symbol.containerName) {
            symbolInfo.containerName = symbol.containerName
          }
          return symbolInfo
        }).filter(Boolean) as lsp.SymbolInformation[]
      }
    },
    asSignatureHelp(signatureHelp: vscode.SignatureHelp | undefined) {
      if (!signatureHelp) {
        return undefined
      }

      const activeSignature = typeof signatureHelp.activeSignature === 'number' ? signatureHelp.activeSignature : 0
      const activeParameter = typeof signatureHelp.activeParameter === 'number' ? signatureHelp.activeParameter : 0

      let signatures: lsp.SignatureInformation[] = []
      if (signatureHelp.signatures) {
        signatures = signatureHelp.signatures.map(asSignatureInformation)
      }

      return { activeSignature, activeParameter, signatures }
    },
    asWorkspaceEdit,
    asColorInformation(colorInfo: vscode.ColorInformation) {
      return { color: colorInfo.color, range: c2p.asRange(colorInfo.range) }
    },
    asColorPresentation(presentation: vscode.ColorPresentation) {
      const result: lsp.ColorPresentation = {
        label: presentation.label,
        textEdit: presentation.textEdit ? c2p.asTextEdit(presentation.textEdit) : undefined,
      }

      if (presentation.additionalTextEdits) {
        result.additionalTextEdits = presentation.additionalTextEdits.map(edit =>
          c2p.asTextEdit(edit),
        )
      }

      return result
    },
    asCodeAction(codeAction: vscode.CodeAction) {
      let result: lsp.CodeAction
      const kind = codeAction.kind ? codeAction.kind.value : undefined
      const command = codeAction.command

      if (codeAction.edit) {
        const workspaceEdit = asWorkspaceEdit(codeAction.edit)!
        result = lsp.CodeAction.create(codeAction.title, workspaceEdit, kind)
        if (command) {
          result.command = asCommand(command)
        }
      }
      else {
        if (!command) {
          throw new Error('Invalid CodeAction - neither command nor edit.')
        }
        result = lsp.CodeAction.create(codeAction.title, asCommand(command), kind)
      }

      if (codeAction.diagnostics) {
        result.diagnostics = c2p.asDiagnosticsSync(codeAction.diagnostics)
      }

      return result
    },
  }
}
