const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aB3sAAAAASUVORK5CYII=', 'base64');

test('worker MCP materializes task/comment images inside the workspace and retains native image content', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-attachment-contract-'));
  const cache = path.join(workspace, 'node_modules', '.cache', 'projectsflow-attachments');
  fs.mkdirSync(path.join(workspace, '.git', 'info'), { recursive: true });
  const entry = process.env.PF_MCP_TEST_ENTRY || path.resolve(__dirname, '../dist/index.js');
  const requireMcp = createRequire(entry);
  const { Client } = requireMcp('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = requireMcp('@modelcontextprotocol/sdk/client/stdio.js');
  const attachments = ['task-image', 'comment-image'].map((id, i) => ({ id, filename: 'скриншот.png',
    mimeType: 'image/png', sizeBytes: png.length, dataBase64: png.toString('base64'), commentId: i ? 'comment' : null }));
  const server = http.createServer((req, res) => {
    if (req.url.endsWith('/attachments/task-image')) { res.end(png); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url.endsWith('/attachments') ? { attachments } : {
      task: { id: 'task', description: '<img src="/api/attachments/task-image">' },
      attachments, comments: [{ id: 'comment', body: '<img src="/api/attachments/comment-image">' }],
    }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], stderr: 'pipe',
    cwd: workspace,
    env: { ...process.env, PROJECTSFLOW_API_URL: `http://127.0.0.1:${server.address().port}/api`,
      PROJECTSFLOW_AGENT_TOKEN: 'pfat_fixture_only', PROJECTSFLOW_WORKSPACE_ROOT: '.', PROJECTSFLOW_ATTACHMENT_DIR: 'node_modules/.cache/projectsflow-attachments' } });
  const client = new Client({ name: 'attachment-contract', version: '1' });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: 'pf_get_task', arguments: { projectId: 'project', taskId: 'task' } });
    assert.equal(result.isError, undefined);
    const meta = JSON.parse(result.content.find(c => c.type === 'text').text);
    assert.equal(meta.attachments.length, 2);
    assert.equal(meta.attachments[1].commentId, 'comment');
    for (const attachment of meta.attachments) {
      assert.ok(attachment.localPath.startsWith(cache + path.sep));
      assert.deepEqual(fs.readFileSync(attachment.localPath), png);
    }
    assert.equal(result.content.filter(c => c.type === 'image').length, 2);
    assert.equal(fs.readFileSync(path.join(workspace, '.git', 'info', 'exclude'), 'utf8').trim(), '/node_modules/.cache/projectsflow-attachments/');
    assert.ok(result.content.some(c => c.type === 'text' && c.text.includes('view_image')));
    const outside = path.join(os.tmpdir(), 'pf-never-write-outside.png');
    for (const saveTo of [outside, '../escape.png', '.git/config']) {
      const denied = await client.callTool({ name: 'pf_read_task_attachment', arguments: {
        projectId: 'project', taskId: 'task', attachmentId: 'task-image', saveTo } });
      assert.equal(denied.isError, true);
    }
    const saved = await client.callTool({ name: 'pf_read_task_attachment', arguments: {
      projectId: 'project', taskId: 'task', attachmentId: 'task-image', saveTo: 'local.png' } });
    assert.equal(saved.isError, undefined);
    assert.deepEqual(fs.readFileSync(path.join(workspace, 'local.png')), png);
  } finally {
    await client.close();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(workspace), path.resolve(os.tmpdir()));
    assert.ok(path.basename(workspace).startsWith('pf-attachment-contract-'));
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('attachment downloads reject a junction or symlink escaping the worker project', async () => {
  const { saveAttachmentTo } = await import('../dist/attachments.js');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-attachment-path-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-attachment-outside-'));
  const before = process.env.PROJECTSFLOW_WORKSPACE_ROOT;
  try {
    process.env.PROJECTSFLOW_WORKSPACE_ROOT = workspace;
    fs.symlinkSync(outside, path.join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => saveAttachmentTo('escape/image.png', png), /outside_workspace/);
    assert.equal(fs.existsSync(path.join(outside, 'image.png')), false);
  } finally {
    if (before === undefined) delete process.env.PROJECTSFLOW_WORKSPACE_ROOT; else process.env.PROJECTSFLOW_WORKSPACE_ROOT = before;
    fs.unlinkSync(path.join(workspace, 'escape'));
    for (const folder of [workspace, outside]) {
      assert.equal(path.dirname(folder), path.resolve(os.tmpdir()));
      assert.ok(path.basename(folder).startsWith('pf-attachment-'));
      fs.rmSync(folder, { recursive: true, force: true });
    }
  }
});

test('private-cache exclusion cannot write through redirected git metadata', async () => {
  const { saveAttachment } = await import('../dist/attachments.js');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-attachment-meta-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-attachment-meta-out-'));
  const beforeRoot = process.env.PROJECTSFLOW_WORKSPACE_ROOT, beforeCache = process.env.PROJECTSFLOW_ATTACHMENT_DIR;
  const info = path.join(workspace, '.git', 'info');
  try {
    process.env.PROJECTSFLOW_WORKSPACE_ROOT = workspace;
    process.env.PROJECTSFLOW_ATTACHMENT_DIR = path.join(workspace, 'node_modules/.cache/projectsflow-attachments');
    fs.mkdirSync(path.join(workspace, '.git'));
    fs.symlinkSync(outside, info, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => saveAttachment('task', 'image', 'screen.png', png), /git_exclude_indirection/);
    assert.equal(fs.existsSync(path.join(outside, 'exclude')), false);
  } finally {
    if (beforeRoot === undefined) delete process.env.PROJECTSFLOW_WORKSPACE_ROOT; else process.env.PROJECTSFLOW_WORKSPACE_ROOT = beforeRoot;
    if (beforeCache === undefined) delete process.env.PROJECTSFLOW_ATTACHMENT_DIR; else process.env.PROJECTSFLOW_ATTACHMENT_DIR = beforeCache;
    fs.unlinkSync(info);
    for (const folder of [workspace, outside]) {
      assert.equal(path.dirname(folder), path.resolve(os.tmpdir()));
      assert.ok(path.basename(folder).startsWith('pf-attachment-'));
      fs.rmSync(folder, { recursive: true, force: true });
    }
  }
});
