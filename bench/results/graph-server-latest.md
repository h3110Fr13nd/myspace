| Variant | Nodes | Server work | Peak RSS | First view (gz) | Detail view (gz) | Notes |
|---|---:|---:|---:|---:|---:|---|
| legacy JSON | 10,000 | 140 ms **per request** | 130 MB | 341.2 KB | (same) | 2.3 MB raw JSON, 29,596 links |
| tiled | 10,000 | 198 ms **once** (layout 18, pyramid 112, encode+gz 68) | 113 MB | 4.4 KB | 40.5 KB | 33 tiles / 5 levels, max tile 43.2 KB (988 nodes), total 482.3 KB |
| legacy JSON | 100,000 | 1328 ms **per request** | 319 MB | 3.5 MB | (same) | 23.9 MB raw JSON, 294,855 links |
| tiled | 100,000 | 1359 ms **once** (layout 101, pyramid 866, encode+gz 392) | 175 MB | 7.9 KB | 39.6 KB | 367 tiles / 7 levels, max tile 72.7 KB (1012 nodes), total 4.8 MB |
| legacy JSON | 1,000,000 | 18035 ms **per request** | 2248 MB | 36.3 MB | (same) | 247.9 MB raw JSON, 2,949,627 links |
| tiled | 1,000,000 | 11759 ms **once** (layout 456, pyramid 7901, encode+gz 3402) | 558 MB | 14.7 KB | 43.0 KB | 3533 tiles / 9 levels, max tile 96.4 KB (1024 nodes), total 48.5 MB |
