"""Create synthetic reference PNGs without downloading images or using personal files."""

import argparse
import pathlib
import struct
import zlib

parser = argparse.ArgumentParser()
parser.add_argument("output", type=pathlib.Path)
parser.add_argument("--count", type=int, default=32)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
width, height = 1800, 1200


def chunk(kind, body):
    return (
        struct.pack(">I", len(body))
        + kind
        + body
        + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)
    )


for index in range(args.count):
    data = bytearray()
    for y in range(height):
        data.append(0)
        for x in range(width):
            data.extend(
                (
                    (x // 6 + index * 17) % 256,
                    (y // 5 + index * 23) % 256,
                    ((x + y) // 8 + index * 11) % 256,
                )
            )
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">2I5B", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(data))
        + chunk(b"IEND", b"")
    )
    (args.output / f"reference-{index + 1:02}.png").write_bytes(png)

print(f"Created {args.count} synthetic {width}x{height} PNGs in {args.output}")
