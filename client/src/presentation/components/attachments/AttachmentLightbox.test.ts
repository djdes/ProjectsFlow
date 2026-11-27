import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderAnnotationStrokes, type DrawStroke } from './AttachmentLightbox';

test('renderAnnotationStrokes draws pen, arrow, and rect strokes with selected colors onto canvas context', () => {
  const ops: string[] = [];
  const ctx = {
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    clearRect: () => { ops.push('clearRect'); },
    save: () => { ops.push('save'); },
    restore: () => { ops.push('restore'); },
    beginPath: () => { ops.push('beginPath'); },
    moveTo: () => { ops.push('moveTo'); },
    lineTo: () => { ops.push('lineTo'); },
    quadraticCurveTo: () => { ops.push('quadraticCurveTo'); },
    arc: () => { ops.push('arc'); },
    roundRect: () => { ops.push('roundRect'); },
    rect: () => { ops.push('rect'); },
    stroke: function () { ops.push(`stroke:${this.strokeStyle}`); },
    fill: function () { ops.push(`fill:${this.fillStyle}`); },
  } as unknown as CanvasRenderingContext2D;

  const strokes: DrawStroke[] = [
    {
      tool: 'pen',
      color: '#ef4444',
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.2 },
        { x: 0.3, y: 0.25 },
      ],
    },
    {
      tool: 'arrow',
      color: '#facc15',
      points: [
        { x: 0.2, y: 0.2 },
        { x: 0.6, y: 0.6 },
      ],
    },
    {
      tool: 'rect',
      color: '#22c55e',
      points: [
        { x: 0.15, y: 0.15 },
        { x: 0.5, y: 0.45 },
      ],
    },
  ];

  renderAnnotationStrokes(ctx, strokes, 1000, 800);

  assert.ok(ops.includes('clearRect'));
  assert.ok(ops.includes('quadraticCurveTo'));
  assert.ok(ops.includes('roundRect'));
  assert.ok(ops.includes('stroke:#ef4444'));
  assert.ok(ops.includes('stroke:#facc15'));
  assert.ok(ops.includes('stroke:#22c55e'));
});
