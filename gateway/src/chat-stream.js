import { once } from 'node:events';

export function openChatStream(response, signal) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no'
  });
  response.flushHeaders();
  const heartbeat = setInterval(() => {
    if (!response.destroyed && !response.writableEnded && !response.writableNeedDrain) response.write(': heartbeat\n\n');
  }, 15000);
  heartbeat.unref();
  const dispose = () => clearInterval(heartbeat);
  response.once('close', dispose);
  response.once('finish', dispose);
  return {
    async send(event, payload) {
      signal?.throwIfAborted();
      if (response.destroyed || response.writableEnded) throw Object.assign(new Error('Chat client disconnected.'), { name: 'AbortError' });
      if (!response.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)) {
        await once(response, 'drain', { signal });
      }
    },
    end() { dispose(); response.end(); }
  };
}
