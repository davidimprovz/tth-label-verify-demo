"""Dependency-license inventory + guardrail.

Policy (updated 2026-06-10): copyleft (GPL/AGPL/LGPL) is ALLOWED — we may use
ultralytics / YOLO-World / Grounding DINO etc. Copyleft components are tracked
in NOTICE for visibility, and the proprietary-vs-AGPL distribution question is a
documented open item (isolate copyleft components / use at train-time). The
guardrail still FAILS only on genuinely unshippable licenses: non-commercial
(CC-BY-NC, research-only) and undeterminable ("UNKNOWN").

Two entry points are provided:

- ``evaluate(records, allowlist)`` — a pure, unit-testable function that takes
  a list of {"Name", "License"} records and returns ``(ok, violations)``.
- ``main()`` — a CLI that shells out to ``pip-licenses --format=json`` to audit
  the real installed environment, then applies ``evaluate``.
"""

from __future__ import annotations

import json
import subprocess
import sys

# Permitted permissive license families. Matching is substring-based and
# case-insensitive against the (often messy) classifier strings pip-licenses
# emits, so each family lists the tokens that uniquely identify it.
DEFAULT_ALLOWLIST: tuple[str, ...] = (
    "mit",
    "bsd",
    "apache",
    "isc",
    "mpl",
    "mozilla public license",
    "python software foundation",
    "python-2.0",
    "psf",
    "sam license",
    # Copyleft is now permitted (tracked in NOTICE); allow GPL/AGPL/LGPL families.
    "gpl",  # covers GPL, AGPL, LGPL
    "affero",
    "gnu",
)

# Tokens that still indicate a genuinely unshippable license, even if another
# token also appears: non-commercial (can't ship/host for the gov product) and
# undeterminable. Copyleft is intentionally NOT here anymore.
FORBIDDEN_TOKENS: tuple[str, ...] = (
    "non-commercial",
    "noncommercial",
    "cc-by-nc",
    "cc by nc",
    "research only",
    "research-only",
    "unknown",
)


def _is_allowed(license_str: str, allowlist: tuple[str, ...]) -> bool:
    """Return True if the license string is permissive and not forbidden."""
    text = (license_str or "").strip().lower()
    if not text:
        return False
    # A forbidden token vetoes the dependency regardless of other tokens.
    if any(tok in text for tok in FORBIDDEN_TOKENS):
        return False
    return any(allowed in text for allowed in allowlist)


def evaluate(
    records: list[dict[str, str]],
    allowlist: tuple[str, ...] = DEFAULT_ALLOWLIST,
) -> tuple[bool, list[dict[str, str]]]:
    """Evaluate dependency license records against the allowlist.

    Args:
        records: list of dicts each with at least "Name" and "License".
        allowlist: permitted license-family tokens (lowercase substrings).

    Returns:
        (ok, violations) where ok is True only if every record is allowed,
        and violations is the list of offending records.
    """
    violations = [r for r in records if not _is_allowed(r.get("License", ""), allowlist)]
    return (len(violations) == 0, violations)


# Our own first-party distribution is proprietary by design; it is not a
# bundled third-party dependency, so it is excluded from the audit.
OWN_PACKAGES: tuple[str, ...] = ("ttb-label-verifier", "ttb_label_verifier")


def _load_pip_licenses() -> list[dict[str, str]]:
    """Run pip-licenses and return its JSON records (third-party deps only)."""
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "piplicenses",
            "--format=json",
            "--ignore-packages",
            *OWN_PACKAGES,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(result.stdout)


def main() -> int:
    """CLI: audit the real environment via pip-licenses."""
    try:
        records = _load_pip_licenses()
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        print(f"ERROR: could not run pip-licenses: {exc}", file=sys.stderr)
        return 2

    ok, violations = evaluate(records, DEFAULT_ALLOWLIST)
    if ok:
        print(
            f"License guardrail PASSED — {len(records)} dependencies, "
            "no non-commercial/unknown licenses."
        )
        return 0

    print(
        "License guardrail FAILED — non-commercial/unknown dependencies detected:",
        file=sys.stderr,
    )
    for v in violations:
        print(f"  - {v.get('Name')}: {v.get('License')}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
