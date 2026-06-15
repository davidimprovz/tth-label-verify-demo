"""Event-loop responsiveness guard (audit T0.2a/T1.1).

verify_async must not block the event loop while preprocessing or the reader
(OCR inference) runs; a blocking read freezes SSE streaming and health checks
for the duration of every OCR call.
"""

from __future__ import annotations

import asyncio
import time

import numpy as np

from backend.models.verification import ExpectedFields
from backend.services.readers.base import ReaderOutput
from backend.services.verify import verify_async

READ_SECONDS = 0.5


class SlowReader:
    """Fake reader that blocks (like real OCR inference) for READ_SECONDS."""

    name = "slow-fake"

    def read(self, image, expected, *, preprocessed=None) -> ReaderOutput:
        time.sleep(READ_SECONDS)
        return ReaderOutput(text="", confidence=0.0, tier="fake")


def _expected() -> ExpectedFields:
    return ExpectedFields(
        beverage_type="spirits",
        brand_name="Brand",
        class_type="Whiskey",
        alcohol_content="40%",
        net_contents="750 ml",
        producer_name="Producer",
    )


def test_event_loop_ticks_while_reader_runs():
    img = np.full((640, 640), 255, dtype=np.uint8)  # >= D4 intake floor
    ticks = 0

    async def main() -> None:
        nonlocal ticks

        async def ticker() -> None:
            nonlocal ticks
            while True:
                await asyncio.sleep(0.05)
                ticks += 1

        task = asyncio.create_task(ticker())
        try:
            await verify_async(img, _expected(), reader=SlowReader())
        finally:
            task.cancel()

    asyncio.run(main())
    # A blocked loop yields ~0-1 ticks during the 0.5s read; a responsive one
    # ~10. Requiring >=3 separates the cases with wide margin under CI load.
    assert ticks >= 3
