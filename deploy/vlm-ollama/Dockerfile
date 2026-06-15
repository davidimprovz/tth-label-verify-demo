# GPU Ollama image for Cloud Run (separate scale-to-zero L4 service).
# Bakes the VL model into the image so a cold start only loads it into VRAM —
# it never pulls gigabytes at runtime.
FROM ollama/ollama:latest

# Keep the model resident for an instance's life; bind to the fixed port Cloud
# Run is told to route to (--port=11434 on deploy).
ENV OLLAMA_KEEP_ALIVE=30m \
    OLLAMA_HOST=0.0.0.0:11434 \
    # Cloud Run's L4 driver is older than ollama:latest's CUDA-12 kernels, so the
    # default cuda_v12 lib throws "device kernel image is invalid" at compute time.
    # Force the cuda_v11 lib, which is compatible with the deployed driver.
    OLLAMA_LLM_LIBRARY=cuda_v11

# Pull qwen3-vl:2b-instruct (the vision instruct tag — NOT the thinking tag, which
# Ollama can't stop reasoning; see eval/vlm_latency_decision.md) into a build
# layer: run a temporary server, pull, then stop it.
RUN ollama serve & \
    until ollama list >/dev/null 2>&1; do sleep 1; done && \
    ollama pull qwen3-vl:2b-instruct && \
    pkill ollama

EXPOSE 11434
# ollama/ollama's entrypoint runs `ollama serve`; OLLAMA_HOST binds it to 11434.
