type: patch
---
The root stream writes the lines appended in one event-loop turn in one fenced write when the turn ends, rather than taking the run's fsynced mutation lock for each line. A Discovery run whose run directory sat on a busy SMR drive drained 2.5 events/s, with its main thread waiting on ext4 journal commits, while its box finished a 40-minute turn; on SSD the per-line fence held press smokes to 44–104 events/s. A process kill now loses at most the lines of the turn in progress, and a lost claim is still thrown to the next `append`, `beginAttempt` or `close` (#2332).
