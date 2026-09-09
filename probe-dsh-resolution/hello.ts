import type { Context } from '@deepseek-ai/cordis'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'

export const name = 'dsh-resolution-probe'

export function apply(ctx: Context) {
  console.log('[probe] loader mounted plugin; BasicCompactionEngine =', typeof BasicCompactionEngine)
}
