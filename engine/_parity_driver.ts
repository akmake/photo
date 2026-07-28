// Node-side runner for test_parity.py.
//
// The browser is the only place the JS engine normally runs, which is exactly
// why its maths drifts from the Python mirror unnoticed. This applies one
// global tool to a raw RGBA dump from the command line, so the two engines can
// be diffed pixel for pixel without a browser in the loop.
//
// Bundled on demand by test_parity.py — not part of the app build.
import { readFileSync, writeFileSync } from 'node:fs';
import { applyGlobalTool } from '../src/imageEngine';

class NodeImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  constructor(data: Uint8ClampedArray, width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }
}
(globalThis as unknown as { ImageData: unknown }).ImageData = NodeImageData;

const [src, dst, toolId, paramsJson] = process.argv.slice(2);
const buf = readFileSync(src);
const width = buf.readUInt32LE(0);
const height = buf.readUInt32LE(4);
const img = new NodeImageData(
  new Uint8ClampedArray(buf.subarray(8)),
  width,
  height,
) as unknown as ImageData;

const out = applyGlobalTool(toolId, img, JSON.parse(paramsJson));

const head = Buffer.alloc(8);
head.writeUInt32LE(width, 0);
head.writeUInt32LE(height, 4);
writeFileSync(
  dst,
  Buffer.concat([
    head,
    Buffer.from(out.data.buffer, out.data.byteOffset, out.data.byteLength),
  ]),
);
