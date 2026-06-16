# GPU vLLM image for Cloud Run (scale-to-zero L4). Serves Qwen3-VL-2B-Instruct
# (FP8) over the OpenAI-compatible API (/v1/chat/completions).
#
# Why vLLM (not Ollama) on Cloud Run: the L4 driver is CUDA 12.2 and ollama:latest
# has no compatible GPU runner (→ CPU fallback). vLLM runs natively via CUDA
# forward-compat (L4 is a datacenter GPU).
#
# Latency tuning for single-request, concurrency=1, scale-to-zero:
#   - FP8 weights (L4/Ada supports FP8 W8A8) → ~half the weight traffic vs BF16,
#     the dominant cost for one-at-a-time decode. The vision tower stays BF16
#     (FP8-quantizing the ViT degrades OCR), so Government-Warning legibility holds.
#   - torch.compile + CUDA graphs ON (NOT enforce-eager): eager decode measured
#     only ~22 tok/s on the L4 (→ ~60s/refine); compiled graphs run ~3-4x faster.
#     The ~39s compile cold-start is hidden by the wake-on-load preload.
#   - capped vision tokens + small max-model-len + single seq + no prefix cache.
FROM vllm/vllm-openai:latest

ENV VLLM_ENABLE_CUDA_COMPATIBILITY=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    HF_HOME=/root/.cache/huggingface

# Bake the FP8 model so a cold start loads from disk, not a multi-GB HF pull.
# (Download runs ONLINE here; offline mode is set AFTER, for runtime only.)
RUN python3 -c "from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen3-VL-2B-Instruct-FP8')"

# Runtime-only: with the model baked above, run fully offline so a cold start
# never hits the HF API (which rate-limits the Cloud Run egress IP → 429 → crash).
ENV HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1

EXPOSE 8080
# vllm/vllm-openai's ENTRYPOINT is the OpenAI api_server; CMD supplies its args.
CMD ["--model", "Qwen/Qwen3-VL-2B-Instruct-FP8", \
     "--host", "0.0.0.0", "--port", "8080", \
     "--max-model-len", "4096", \
     "--max-num-seqs", "1", \
     "--gpu-memory-utilization", "0.90", \
     "--no-enable-prefix-caching", \
     "--mm-processor-kwargs", "{\"min_pixels\": 65536, \"max_pixels\": 1048576}", \
     "--limit-mm-per-prompt", "{\"image\": 1}"]
