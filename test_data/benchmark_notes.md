# High-Performance Asynchronous Inference Benchmarking

## Overview
This document outlines profiling strategies for local Large Language Model (LLM) inference servers.
We focus on token throughput ($tokens/sec$) and time-to-first-token (TTFT) metrics under batched concurrent load.

### Target Architecture
- Local `llama.cpp` instance running on an Nvidia RTX 40-series mobile GPU via CUDA.
- Unified memory monitoring across CPU pinned host memory and GPU VRAM.

### Empirical Execution Time
Execution profiles are captured using customized shell hooks executing multiple iterations:

```bash
avgtime 10 ./bench_runner --prompt-tokens 512 --gen-tokens 128
```

Observations:
- KV-cache paging reduces memory fragmentation by ~18%.
- Context offloading overhead dominates initial latency when batch size exceeds 8.
