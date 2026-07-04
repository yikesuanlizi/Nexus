import { describe, it, expect } from 'vitest';
import { createDwsTools, DWS_EXEC_TOOL_NAME, DWS_SCHEMA_TOOL_NAME, DWS_AUTH_STATUS_TOOL_NAME } from './dwsTool.js';

describe('dws tools', () => {
  it('creates three dws tools when enabled', () => {
    const tools = createDwsTools({
      config: {
        enabled: true,
        binaryPath: '/usr/local/bin/dws',
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
      },
    });

    expect(tools.length).toBe(3);
    expect(tools.map(t => t.name)).toContain(DWS_EXEC_TOOL_NAME);
    expect(tools.map(t => t.name)).toContain(DWS_SCHEMA_TOOL_NAME);
    expect(tools.map(t => t.name)).toContain(DWS_AUTH_STATUS_TOOL_NAME);
  });

  it('dws_exec tool has correct parameters schema', () => {
    const tools = createDwsTools({
      config: {
        enabled: true,
        binaryPath: '',
        clientId: '',
        clientSecret: '',
      },
    });

    const execTool = tools.find(t => t.name === DWS_EXEC_TOOL_NAME);
    expect(execTool).toBeDefined();
    expect(execTool?.requiredPolicy).toBe('workspace_write');
    expect(execTool?.parameters?.type).toBe('object');
    expect((execTool?.parameters as any)?.required).toContain('args');
  });

  it('dws_schema tool has correct readonly policy', () => {
    const tools = createDwsTools({
      config: {
        enabled: true,
        binaryPath: '',
        clientId: '',
        clientSecret: '',
      },
    });

    const schemaTool = tools.find(t => t.name === DWS_SCHEMA_TOOL_NAME);
    expect(schemaTool).toBeDefined();
    expect(schemaTool?.requiredPolicy).toBe('readonly');
  });

  it('dws_auth_status tool has correct readonly policy', () => {
    const tools = createDwsTools({
      config: {
        enabled: true,
        binaryPath: '',
        clientId: '',
        clientSecret: '',
      },
    });

    const authTool = tools.find(t => t.name === DWS_AUTH_STATUS_TOOL_NAME);
    expect(authTool).toBeDefined();
    expect(authTool?.requiredPolicy).toBe('readonly');
  });
});
