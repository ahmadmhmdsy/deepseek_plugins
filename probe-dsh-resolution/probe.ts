import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { selectCompactableRange } from '@deepseek-ai/dsh-compaction-basic/src/region.ts'
import { summarizeWithLlm } from '@deepseek-ai/dsh-compaction-basic/src/summarizer.ts'
import { resolveTargetPolicy, TargetPressureConfigError } from '@deepseek-ai/dsh-compaction-basic/src/config.ts'
import { CompactionEngine } from '@deepseek-ai/dsh-compaction'

const report = {
  basic: typeof BasicCompactionEngine,
  isSubclassOfCompactionEngine: BasicCompactionEngine.prototype instanceof CompactionEngine,
  selectCompactableRange: typeof selectCompactableRange,
  summarizeWithLlm: typeof summarizeWithLlm,
  resolveTargetPolicy: typeof resolveTargetPolicy,
  TargetPressureConfigError: TargetPressureConfigError.name,
}
console.log('[probe] ' + JSON.stringify(report, null, 2))
