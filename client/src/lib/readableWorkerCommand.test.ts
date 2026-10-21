import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readableWorkerCommand } from './readableWorkerCommand';

const encoded = (text: string) => `powershell.exe -NoProfile -EncodedCommand ${Buffer.from(text, 'utf16le').toString('base64')}`;

test('worker commands display Unicode text and unwrap the pinned PowerShell working directory', () => {
  const command = 'Write-Output "Проверяю кнопки"\nnpm run typecheck';
  const wrapped = "$ErrorActionPreference = 'Stop'; Set-Location -LiteralPath 'C:\\repo'; [IO.Directory]::SetCurrentDirectory('C:\\repo'); & {\n" + command + '\n}; if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }';
  assert.equal(readableWorkerCommand(encoded(wrapped)), command);
  assert.equal(readableWorkerCommand(encoded(encoded(command))), command);
  assert.equal(readableWorkerCommand('  git status --short '), 'git status --short');
});

test('display decoding does not execute code and handles invalid or oversized payloads', () => {
  const code = 'globalThis.neverExecuteWorkerCommand = true';
  assert.equal(readableWorkerCommand(encoded(code)), code);
  assert.equal('neverExecuteWorkerCommand' in globalThis, false);
  assert.equal(readableWorkerCommand('powershell -EncodedCommand YQ=='), 'Команда PowerShell: текст недоступен');
  assert.equal(readableWorkerCommand('powershell -EncodedCommand ' + 'A'.repeat(100004)), 'Команда PowerShell: большой служебный блок');
});

test('current UTF-8 workspace wrapper is hidden and old reversible OEM corruption is repaired for display', () => {
  const original = 'git commit -m "Исправить кнопку"';
  const mojibake = new TextDecoder('ibm866').decode(Buffer.from(original, 'utf8'));
  const wrapper = "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'; $workerUtf8 = New-Object Text.UTF8Encoding($false); [Console]::InputEncoding = $workerUtf8; [Console]::OutputEncoding = $workerUtf8; $OutputEncoding = $workerUtf8; Set-Location -LiteralPath 'C:\\repo'; [IO.Directory]::SetCurrentDirectory('C:\\repo'); & {\n" + mojibake + '\n}; if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }';
  assert.equal(readableWorkerCommand(encoded(wrapper)), original);
  assert.equal(readableWorkerCommand('git commit -m "Исправить кнопку"'), original);
  assert.equal(readableWorkerCommand('Write-Output "├───┤"'), 'Write-Output "├───┤"');
});
