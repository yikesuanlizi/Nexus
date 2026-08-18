import { describe, expect, it } from 'vitest';
import { FakeBrowserRuntime } from '../fakeRuntime.ts';
import { createSidecarClient } from './sidecarClient.ts';
import { createTcpSidecarServer, createTcpSidecarTransport } from './tcpTransport.ts';

const TOKEN = 'test-browser-token-0123456789';
const SITE = {
  startUrl: 'https://example.test/',
  pages: [{ url: 'https://example.test/', title: 'Example', elements: [] }],
};

describe('TCP Sidecar 线程会话', () => {
  it('把认证 taskId 传给独立 runtime，并拒绝无 taskId 的连接', async () => {
    const runtimeTasks: string[] = [];
    const server = await createTcpSidecarServer({
      port: 0,
      authToken: TOKEN,
      createRuntime: (context) => {
        runtimeTasks.push(context?.taskId ?? '');
        return new FakeBrowserRuntime(SITE);
      },
    });

    try {
      const first = createTcpSidecarTransport({
        port: server.port(),
        authToken: TOKEN,
        taskId: 'thread-one',
      });
      await first.ready;
      const firstSession = await createSidecarClient({ taskId: 'thread-one', transport: first.transport });

      const second = createTcpSidecarTransport({
        port: server.port(),
        authToken: TOKEN,
        taskId: 'thread-two',
      });
      await second.ready;
      const secondSession = await createSidecarClient({ taskId: 'thread-two', transport: second.transport });

      expect(runtimeTasks).toEqual(['thread-one', 'thread-two']);
      expect(firstSession.sessionId).not.toBe(secondSession.sessionId);

      await firstSession.close('test complete');
      await secondSession.close('test complete');

      const missingTask = createTcpSidecarTransport({
        port: server.port(),
        authToken: TOKEN,
        taskId: '',
      });
      await expect(missingTask.ready).rejects.toThrow(/auth/i);
      missingTask.close();
    } finally {
      await server.close();
    }
  });
});
