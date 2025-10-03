import { resolveAsset } from './utils'

// eslint-disable-next-line ts/no-require-imports
module.exports = require(resolveAsset('node-pty/build/Release/conpty.node'))
