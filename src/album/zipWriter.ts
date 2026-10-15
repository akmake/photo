/* One archive for the lab's upload form, written as the export goes.
 *
 * Graphistudio will not process loose files at all, and every other lab's
 * form takes one file more easily than forty. The archive is STORED, not
 * compressed: a JPEG does not shrink, and deflating 600MB in the browser would
 * only cost time. It is streamed straight to disk — each sheet is appended the
 * moment it is finished, so memory holds one sheet, never the album.
 *
 * Names are written as UTF-8 (flag bit 11), so a Hebrew album name survives
 * on any unzip tool made in the last fifteen years. */

interface Sink {
  write(data: Blob | BufferSource): Promise<void>;
  close(): Promise<void>;
}

interface Entry {
  name: Uint8Array<ArrayBuffer>;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** The stored archive's hard limit; past it the format needs ZIP64. */
export const ZIP_LIMIT_BYTES = 0xffffffff - 1024 * 1024;

export class ZipStream {
  private entries: Entry[] = [];
  private offset = 0;

  constructor(private readonly sink: Sink) {}

  /** Bytes written so far — checked against ZIP_LIMIT_BYTES before adding. */
  get size(): number {
    return this.offset;
  }

  async add(name: string, data: Blob): Promise<void> {
    const bytes = new Uint8Array(await data.arrayBuffer());
    const encodedName = new TextEncoder().encode(name);
    const stamp = dosTime(new Date());
    const entry: Entry = {
      name: encodedName,
      crc: crc32(bytes),
      size: bytes.length,
      offset: this.offset,
      time: stamp.time,
      date: stamp.date,
    };
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint16(6, 0x0800, true);
    header.setUint16(8, 0, true);
    header.setUint16(10, entry.time, true);
    header.setUint16(12, entry.date, true);
    header.setUint32(14, entry.crc, true);
    header.setUint32(18, entry.size, true);
    header.setUint32(22, entry.size, true);
    header.setUint16(26, encodedName.length, true);
    header.setUint16(28, 0, true);
    await this.sink.write(header.buffer);
    await this.sink.write(encodedName);
    await this.sink.write(bytes);
    this.offset += 30 + encodedName.length + bytes.length;
    this.entries.push(entry);
  }

  async close(): Promise<void> {
    const start = this.offset;
    let directorySize = 0;
    for (const entry of this.entries) {
      const record = new DataView(new ArrayBuffer(46));
      record.setUint32(0, 0x02014b50, true);
      record.setUint16(4, 20, true);
      record.setUint16(6, 20, true);
      record.setUint16(8, 0x0800, true);
      record.setUint16(10, 0, true);
      record.setUint16(12, entry.time, true);
      record.setUint16(14, entry.date, true);
      record.setUint32(16, entry.crc, true);
      record.setUint32(20, entry.size, true);
      record.setUint32(24, entry.size, true);
      record.setUint16(28, entry.name.length, true);
      record.setUint16(30, 0, true);
      record.setUint16(32, 0, true);
      record.setUint16(34, 0, true);
      record.setUint16(36, 0, true);
      record.setUint32(38, 0, true);
      record.setUint32(42, entry.offset, true);
      await this.sink.write(record.buffer);
      await this.sink.write(entry.name);
      directorySize += 46 + entry.name.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.entries.length, true);
    end.setUint16(10, this.entries.length, true);
    end.setUint32(12, directorySize, true);
    end.setUint32(16, start, true);
    await this.sink.write(end.buffer);
    await this.sink.close();
  }
}
