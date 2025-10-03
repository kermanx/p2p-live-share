import { selfId } from 'trystero'
import { defineComponent, nextTick, onMounted, ref, watchEffect } from 'vue'
import { rpc, state } from '../main'

interface ChatMessage {
  sender: string
  senderName: string
  content?: string
  image?: string
  file?: {
    name: string
    type: string
    size: number
    base64: string
  }
  timestamp: number
}

const chatMessages = ref<ChatMessage[]>([])

export function recvChatMessage(message: ChatMessage) {
  chatMessages.value.push(message)
}

export default defineComponent(() => {
  const editingMessage = ref('')
  const textareaRef = ref<HTMLElement | null>(null)
  const messagesContainerRef = ref<HTMLElement | null>(null)
  const isDragging = ref(false)

  onMounted(() => {
    // initial autoresize after mount
    requestAnimationFrame(autoResize)
  })

  watchEffect(() => {
    if (!state.value) {
      chatMessages.value = []
    }
  })

  // Auto scroll to bottom whenever message count changes
  watchEffect(() => {
    // dependency: length
    const _len = chatMessages.value.length
    if (_len === 0)
      return
    nextTick(() => {
      const el = messagesContainerRef.value
      if (!el)
        return
      el.scrollTop = el.scrollHeight
    })
  })

  const userName = rpc.getSelfName()

  async function sendMessage() {
    const content = editingMessage.value
    if (content.trim() === '')
      return
    const message: ChatMessage = {
      sender: selfId,
      senderName: await userName || selfId,
      content,
      timestamp: Date.now(),
    }
    chatMessages.value.push(message)
    rpc.sendChatMessage(message)
    editingMessage.value = ''
    nextTickResize()
  }

  async function sendImage(base64Image: string) {
    const message: ChatMessage = {
      sender: selfId,
      senderName: await userName || selfId,
      image: base64Image,
      timestamp: Date.now(),
    }
    chatMessages.value.push(message)
    rpc.sendChatMessage(message)
  }

  async function sendFile(file: File) {
    const reader = new FileReader()
    reader.onload = async (e) => {
      const base64 = e.target?.result as string
      if (!base64)
        return

      const message: ChatMessage = {
        sender: selfId,
        senderName: await userName || selfId,
        file: {
          name: file.name,
          type: file.type,
          size: file.size,
          base64,
        },
        timestamp: Date.now(),
      }
      chatMessages.value.push(message)
      rpc.sendChatMessage(message)
    }
    reader.readAsDataURL(file)
  }

  function isImageOrVideo(type: string): boolean {
    return type.startsWith('image/') || type.startsWith('video/')
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024)
      return `${bytes} B`
    if (bytes < 1024 * 1024)
      return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function downloadFile(file: { name: string, base64: string }) {
    const link = document.createElement('a')
    link.href = file.base64
    link.download = file.name
    link.click()
  }

  function handleDragOver(event: DragEvent) {
    event.preventDefault()
    isDragging.value = true
  }

  function handleDragLeave(event: DragEvent) {
    event.preventDefault()
    isDragging.value = false
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault()
    isDragging.value = false

    const files = event.dataTransfer?.files
    if (!files || files.length === 0)
      return

    const file = files[0]

    // If it's an image, keep the old behavior for backward compatibility
    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const base64 = e.target?.result as string
        if (base64)
          sendImage(base64)
      }
      reader.readAsDataURL(file)
    }
    else {
      // For any other file type, use the new file handling
      sendFile(file)
    }
  }

  function handlePaste(event: ClipboardEvent) {
    const items = event.clipboardData?.items
    if (!items)
      return

    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        event.preventDefault()
        const file = item.getAsFile()
        if (!file)
          continue

        const reader = new FileReader()
        reader.onload = (e) => {
          const base64 = e.target?.result as string
          if (base64)
            sendImage(base64)
        }
        reader.readAsDataURL(file)
        break
      }
    }
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  }

  function nextTickResize() {
    requestAnimationFrame(autoResize)
  }

  function autoResize() {
    const host = textareaRef.value as any
    if (!host)
      return
    // Try to locate the inner <textarea>
    const inner: HTMLTextAreaElement | null = host instanceof HTMLTextAreaElement
      ? host
      : host.shadowRoot?.querySelector('textarea') ?? null
    if (!inner)
      return
    inner.style.padding = '6px'
    inner.style.height = 'auto'
    const max = Math.max(window.innerHeight / 3, 37)
    inner.style.height = `${Math.min(inner.scrollHeight + 6, max)}px`
    inner.style.margin = '1px 0px'
  }

  function formatTime(timestamp: number) {
    return new Date(timestamp).toLocaleTimeString()
  }

  return () => (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 16px)',
        width: '100%',
        gap: '4px',
        padding: '8px 0px',
        position: 'relative',
      }}
    >
      <div
        ref={messagesContainerRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 0,
          minHeight: 0,
        }}
      >
        {chatMessages.value.length === 0
          ? (
              <div style={{
                color: 'var(--vscode-descriptionForeground)',
                fontStyle: 'italic',
                textAlign: 'center',
                padding: '12px',
              }}
              >
                No messages yet. Start chatting.
              </div>
            )
          : (
              chatMessages.value.map((message, index) => {
                const isSelf = message.sender === selfId
                return (
                  <div
                    key={index}
                    class={isSelf ? 'chat-message-self' : 'chat-message-other'}
                    style={{
                      margin: '0 0 6px 0',
                      padding: '6px 8px',
                      borderRadius: '6px',
                      border: '1px solid rgba(255,255,255,0.08)',
                      backdropFilter: 'blur(2px)',
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '2px',
                    }}
                    >
                      <span style={{
                        fontWeight: 600,
                        color: 'var(--vscode-textLink-foreground)',
                        fontSize: '11px',
                      }}
                      >
                        {isSelf ? 'Me' : message.senderName}
                      </span>
                      <span style={{
                        fontSize: '10px',
                        color: 'var(--vscode-descriptionForeground)',
                      }}
                      >
                        {formatTime(message.timestamp)}
                      </span>
                    </div>
                    {message.image
                      ? (
                          <img
                            src={message.image}
                            alt="Shared image"
                            style={{
                              maxWidth: '100%',
                              borderRadius: '4px',
                              display: 'block',
                            }}
                          />
                        )
                      : message.file
                        ? (
                            isImageOrVideo(message.file.type)
                              ? (
                                  message.file.type.startsWith('image/')
                                    ? (
                                        <img
                                          src={message.file.base64}
                                          alt={message.file.name}
                                          style={{
                                            maxWidth: '100%',
                                            borderRadius: '4px',
                                            display: 'block',
                                          }}
                                        />
                                      )
                                    : (
                                        <video
                                          src={message.file.base64}
                                          controls
                                          style={{
                                            maxWidth: '100%',
                                            borderRadius: '4px',
                                            display: 'block',
                                          }}
                                        />
                                      )
                                )
                              : (
                                  <div
                                    class="chat-file-attachment"
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '12px',
                                      padding: '12px',
                                      borderRadius: '6px',
                                      border: '1px solid rgba(255,255,255,0.1)',
                                    }}
                                  >
                                    <div
                                      style={{
                                        width: '40px',
                                        height: '40px',
                                        borderRadius: '6px',
                                        background: 'var(--vscode-textLink-foreground)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '18px',
                                        fontWeight: 'bold',
                                        color: 'white',
                                        flexShrink: 0,
                                      }}
                                    >
                                      📄
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div
                                        style={{
                                          fontSize: '13px',
                                          fontWeight: 500,
                                          color: 'var(--vscode-editor-foreground)',
                                          whiteSpace: 'nowrap',
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                        }}
                                      >
                                        {message.file.name}
                                      </div>
                                      <div
                                        style={{
                                          fontSize: '11px',
                                          color: 'var(--vscode-descriptionForeground)',
                                          marginTop: '2px',
                                        }}
                                      >
                                        {formatFileSize(message.file.size)}
                                      </div>
                                    </div>
                                    <vscode-button
                                      appearance="icon"
                                      onClick={() => downloadFile(message.file!)}
                                      style={{
                                        flexShrink: 0,
                                      }}
                                    >
                                      <span style={{ fontSize: '16px' }}>⬇</span>
                                    </vscode-button>
                                  </div>
                                )
                          )
                        : (
                            <div style={{
                              color: 'var(--vscode-editor-foreground)',
                              fontSize: '13px',
                              lineHeight: '1.4',
                              whiteSpace: 'pre-wrap',
                            }}
                            >
                              {message.content}
                            </div>
                          )}
                  </div>
                )
              })
            )}
      </div>
      <div
        style={{ position: 'relative' }}
        onDragover={handleDragOver}
        onDragleave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDragging.value && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(30, 111, 210, 0.1)',
            border: '2px dashed var(--vscode-textLink-foreground)',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            pointerEvents: 'none',
            fontSize: '14px',
            color: 'var(--vscode-textLink-foreground)',
            fontWeight: 600,
          }}
          >
            Drop file to send
          </div>
        )}
        <vscode-textarea
          ref={textareaRef as any}
          style={{
            flex: 1,
            resize: 'none',
            overflow: 'hidden',
            width: '100%',
          }}
          placeholder="Type a message and press Enter to send"
          value={editingMessage.value}
          onInput={(e: any) => {
            editingMessage.value = e.target.value
            autoResize()
          }}
          onKeydown={handleKeyDown}
          onPaste={handlePaste}
        />
      </div>
    </div>
  )
}, { name: 'Chat' })
