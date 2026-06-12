/**
 * Gym-lane smoke test: seed + loadTools + close against EOPS_GYM_URL.
 * Bring-up check when adding a parallel gym container:
 *   docker run -d --name eops2 -p 8007:8005 shivakrishnareddyma225/enterpriseops-gym-mcp-itsm:latest
 *   EOPS_GYM_DBS_DIR=/tmp/eops-gym/dbs EOPS_GYM_URL=http://localhost:8007 tsx src/lane-probe.mts
 */
import { createEopsSurface, loadEopsTasks } from './agentic-eops'

const gymDbs = process.env.EOPS_GYM_DBS_DIR
if (!gymDbs) throw new Error('EOPS_GYM_DBS_DIR required')
const [task] = await loadEopsTasks(1, 0, 'itsm')
if (!task) throw new Error('no task')
const surface = createEopsSurface(gymDbs)
const handle = await surface.open(task)
const tools = await surface.tools(task, handle)
console.log(`lane ${process.env.EOPS_GYM_URL ?? 'default(8006)'}: seeded db=${handle.id}, ${tools.length} tools`)
await surface.close(handle)
console.log('lane OK')
