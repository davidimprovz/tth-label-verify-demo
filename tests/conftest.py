# The app suite is published; a few tests exercise local-only research tooling
# (scripts.*/eval.*) that is gitignored and absent from a clone. Those files may
# still sit on disk in a working copy, so skip them during collection — they need
# the bench dep set, not the lean app [dev] set. Absent in CI, this is a no-op.
collect_ignore = [
    "test_cola_fetcher.py",
    "test_cola_sampler.py",
    "test_check_licenses.py",
    "test_scoring.py",
]
