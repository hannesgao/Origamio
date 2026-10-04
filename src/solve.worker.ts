/** The 3D solver in its own thread: answers each request with the solved scene. */
import { type SolveRequest, type WorkerReply, SolveCore } from './solver';

const core = new SolveCore();

self.addEventListener('message', (event: MessageEvent<{ seq: number; request: SolveRequest }>) => {
  const { seq, request } = event.data;
  let reply: WorkerReply;
  try {
    reply = { seq, scene: core.solve(request) };
  } catch (error) {
    reply = { seq, error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(reply);
});
