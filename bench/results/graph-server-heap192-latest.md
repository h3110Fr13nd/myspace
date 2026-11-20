| Variant | Nodes | Server work | Peak RSS | First view (gz) | Detail view (gz) | Notes |
|---|---:|---:|---:|---:|---:|---|
| legacy JSON | 10,000 | 185 ms **per request** | 128 MB | 341.2 KB | (same) | 2.3 MB raw JSON, 29,596 links |
| tiled | 10,000 | 192 ms **once** (layout 19, pyramid 122, encode+gz 51) | 109 MB | 4.4 KB | 40.5 KB | 33 tiles / 5 levels, max tile 43.2 KB (988 nodes), total 482.3 KB |
| legacy JSON | 100,000 | 1465 ms **per request** | 291 MB | 3.5 MB | (same) | 23.9 MB raw JSON, 294,855 links |
| tiled | 100,000 | 1305 ms **once** (layout 89, pyramid 841, encode+gz 375) | 178 MB | 7.9 KB | 39.6 KB | 367 tiles / 7 levels, max tile 72.7 KB (1012 nodes), total 4.8 MB |
| legacy | 1,000,000 | — | — | — | — | **OOM (heap cap 192 MB)** |
| tiled | 1,000,000 | 12480 ms **once** (layout 520, pyramid 8408, encode+gz 3552) | 542 MB | 14.7 KB | 43.0 KB | 3533 tiles / 9 levels, max tile 96.4 KB (1024 nodes), total 48.5 MB |
