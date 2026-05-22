export function createColorAllocator() {
  const ColorTable = [
    [1, 'rgba(0, 0, 0, 1)', 'rgba(255, 185, 0, 1)'],
    [2, 'rgba(255, 255, 255, 1)', 'rgba(16, 124, 16, 1)'],
    [3, 'rgba(255, 255, 255, 1)', 'rgba(180, 0, 158, 1)'],
    [4, 'rgba(0, 0, 0, 1)', 'rgba(255, 140, 0, 1)'],
    [5, 'rgba(255, 255, 255, 1)', 'rgba(227, 0, 140, 1)'],
    [6, 'rgba(255, 255, 255, 1)', 'rgba(92, 45, 145, 1)'],
    [7, 'rgba(0, 0, 0, 1)', 'rgba(255, 241, 0, 1)'],
    [8, 'rgba(0, 0, 0, 1)', 'rgba(180, 160, 255, 1)'],
  ] as const

  const peers = new Map<string, number>()
  return {
    alloc(id: string) {
      let idx = peers.get(id)
      if (idx === undefined) {
        const used = new Set(peers.values())
        idx = ColorTable.findIndex((_, i) => !used.has(i))
        if (idx === -1) {
          idx = peers.size % ColorTable.length
        }
        peers.set(id, idx)
      }
      const [colorId, fg, bg] = ColorTable[idx]
      return {
        id: `p2pliveshare.participant.${colorId}`,
        fg,
        bg,
      }
    },
    free(id: string) {
      peers.delete(id)
    },
  }
}

export const LoadingColor = {
  id: 'p2pliveshare.participant.loading',
  fg: 'rgba(0, 0, 0, 0)',
  bg: 'rgba(255, 255, 255, 0)',
}

export function withOpacity(color: string, opacity: number) {
  const match = color.match(/rgba?\((\d+), (\d+), (\d+)(, ([\d.]+))?\)/)
  if (!match) {
    throw new Error(`Invalid color: ${color}`)
  }
  const [, r, g, b] = match
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}
