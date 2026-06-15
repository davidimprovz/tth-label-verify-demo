"""TDD tests for the dependency-license guardrail (pure function, no network)."""

from scripts.check_licenses import DEFAULT_ALLOWLIST, evaluate


def test_clean_permissive_set_passes():
    records = [
        {"Name": "fastapi", "License": "MIT License"},
        {"Name": "starlette", "License": "BSD License"},
        {"Name": "uvicorn", "License": "Apache Software License; BSD License"},
        {"Name": "pydantic", "License": "MIT"},
    ]
    ok, violations = evaluate(records, DEFAULT_ALLOWLIST)
    assert ok is True
    assert violations == []


def test_copyleft_is_now_allowed():
    # Policy 2026-06-10: copyleft (GPL/AGPL/LGPL) is permitted — e.g. ultralytics
    # (AGPL), YOLO-World, Grounding DINO. Tracked in NOTICE, not blocked here.
    records = [
        {"Name": "ultralytics", "License": "GNU Affero General Public License v3"},
        {"Name": "gpl-lib", "License": "GPL-3.0"},
        {"Name": "lgpl-lib", "License": "GNU Lesser General Public License v2 (LGPLv2)"},
    ]
    ok, violations = evaluate(records, DEFAULT_ALLOWLIST)
    assert ok is True
    assert violations == []


def test_unknown_license_fails():
    records = [{"Name": "mystery-lib", "License": "UNKNOWN"}]
    ok, violations = evaluate(records, DEFAULT_ALLOWLIST)
    assert ok is False
    assert violations[0]["Name"] == "mystery-lib"


def test_non_commercial_still_fails():
    # Non-commercial / research-only genuinely can't ship in the gov product.
    records = [
        {"Name": "nc-data", "License": "CC-BY-NC 4.0"},
        {"Name": "research-weights", "License": "Research Only License"},
    ]
    ok, violations = evaluate(records, DEFAULT_ALLOWLIST)
    assert ok is False
    assert {v["Name"] for v in violations} == {"nc-data", "research-weights"}


def test_sam_license_is_allowed():
    records = [{"Name": "segment-anything", "License": "SAM License"}]
    ok, violations = evaluate(records, DEFAULT_ALLOWLIST)
    assert ok is True
    assert violations == []


def test_mpl_and_isc_and_python_allowed():
    records = [
        {"Name": "certifi", "License": "Mozilla Public License 2.0 (MPL 2.0)"},
        {"Name": "pixelmatch", "License": "ISC License (ISCL)"},
        {"Name": "typing-extensions", "License": "Python Software Foundation License"},
    ]
    ok, violations = evaluate(records, DEFAULT_ALLOWLIST)
    assert ok is True
    assert violations == []
