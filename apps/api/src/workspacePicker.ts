import { execFile } from 'node:child_process';
import type { ServerResponse } from 'node:http';
import { promisify } from 'node:util';
import { sendError, sendJson } from './http.js';

const execFileAsync = promisify(execFile);

export type WorkspacePickResult = {
  cancelled: boolean;
  workspaceRoot: string;
};

export async function pickWorkspaceDirectory(): Promise<WorkspacePickResult> {
  if (process.platform !== 'win32') {
    throw new Error('Native workspace directory picker is only available on Windows in this build.');
  }

  const script = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select Nexus workspace'
$dialog.ShowNewFolderButton = $true
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dialog.SelectedPath
}
`;
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-STA',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ], {
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
  });
  const workspaceRoot = stdout.trim();
  return {
    cancelled: workspaceRoot.length === 0,
    workspaceRoot,
  };
}

export async function handlePickWorkspaceDirectory(res: ServerResponse): Promise<void> {
  try {
    sendJson(res, 200, await pickWorkspaceDirectory());
  } catch (error) {
    sendError(res, process.platform === 'win32' ? 500 : 501, error instanceof Error ? error.message : String(error));
  }
}
