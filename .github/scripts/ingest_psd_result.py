#!/usr/bin/env python3
"""Validate one Grind-PSD Issue payload and update the public JSON databases."""

from __future__ import annotations

import json
import math
import os
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

STANDARD_ID = "grind-psd-sieve-v1"
SCHEMA_VERSION = "3.0.0"
DATA_LICENSE = "CC-BY-4.0"
DATABASE_PATH = Path("data/database.json")
USERS_DIR = Path("data/users")
ERROR_PATH = Path(os.environ.get("INGEST_ERROR_PATH", "/tmp/grind-psd-ingest-error.txt"))
OUTPUT_PATH = os.environ.get("GITHUB_OUTPUT")
MAX_PAYLOAD_CHARS = 16_000

WEIGHT_KEYS = [
    "mesh18_retained_g",
    "mesh24_retained_g",
    "mesh35_retained_g",
    "mesh60_retained_g",
    "pan80_lt300_g",
]


class ValidationError(ValueError):
    """A user-facing validation failure."""


def main() -> None:
    try:
        event = load_event()
        issue_number = str(
            os.environ.get("ISSUE_NUMBER")
            or event.get("issue", {}).get("number")
            or ""
        )
        body = str(event.get("issue", {}).get("body") or "")
        github_login = str(
            os.environ.get("ISSUE_AUTHOR")
            or event.get("issue", {}).get("user", {}).get("login")
            or ""
        ).strip()

        if not body and issue_number:
            body, fetched_login = fetch_issue(issue_number)
            github_login = github_login or fetched_login

        if not github_login:
            raise ValidationError("Unable to resolve the GitHub account that submitted this record.")

        payload = extract_payload(body)
        record = validate_and_normalize(payload, github_login, issue_number)
        duplicate = update_database(record)
        write_output("record_id", record["id"])
        write_output("user_id", record["user"]["id"])
        write_output("duplicate", "true" if duplicate else "false")
        print(
            f"{'Existing' if duplicate else 'Added'} record {record['id']} "
            f"for user {record['user']['id']}."
        )
    except (ValidationError, KeyError, TypeError, json.JSONDecodeError) as exc:
        message = clean_error_message(str(exc))
        ERROR_PATH.write_text(message + "\n", encoding="utf-8")
        print(f"Grind-PSD validation failed: {message}", file=sys.stderr)
        raise SystemExit(1) from exc


def load_event() -> dict[str, Any]:
    event_path = os.environ.get("EVENT_PATH")
    if not event_path:
        raise ValidationError("EVENT_PATH is not set.")
    try:
        event = json.loads(Path(event_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValidationError(f"Unable to read the GitHub event: {exc}") from exc
    if not isinstance(event, dict):
        raise ValidationError("GitHub event must be a JSON object.")
    return event


def fetch_issue(issue_number: str) -> tuple[str, str]:
    if not re.fullmatch(r"\d+", issue_number):
        raise ValidationError("A numeric issue number is required.")
    result = subprocess.run(
        ["gh", "issue", "view", issue_number, "--json", "body,author"],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    issue = json.loads(result.stdout)
    return str(issue.get("body") or ""), str(issue.get("author", {}).get("login") or "")


def extract_payload(body: str) -> dict[str, Any]:
    if not body:
        raise ValidationError("The Issue body is empty.")
    if len(body) > MAX_PAYLOAD_CHARS * 2:
        raise ValidationError("The Issue body is too large.")
    match = re.search(
        r"BEGIN_GRIND_PSD_JSON\s*(?:```json)?\s*(.*?)\s*(?:```)?\s*END_GRIND_PSD_JSON",
        body,
        re.DOTALL | re.IGNORECASE,
    )
    if not match:
        raise ValidationError(
            "No BEGIN_GRIND_PSD_JSON / END_GRIND_PSD_JSON payload block was found."
        )
    raw = match.group(1).strip()
    if len(raw) > MAX_PAYLOAD_CHARS:
        raise ValidationError("The JSON payload is too large.")

    def reject_constant(value: str) -> None:
        raise ValidationError(f"Non-finite JSON number {value} is not allowed.")

    payload = json.loads(raw, parse_constant=reject_constant)
    if not isinstance(payload, dict):
        raise ValidationError("The Grind-PSD payload must be a JSON object.")
    return payload


def validate_and_normalize(
    payload: dict[str, Any],
    github_login: str,
    issue_number: str,
) -> dict[str, Any]:
    if payload.get("schemaVersion") != SCHEMA_VERSION:
        raise ValidationError(f"schemaVersion must be {SCHEMA_VERSION}.")
    if payload.get("standardId") != STANDARD_ID:
        raise ValidationError(f"standardId must be {STANDARD_ID}.")
    if payload.get("license") != DATA_LICENSE:
        raise ValidationError(f"license must be {DATA_LICENSE}.")

    record_id = clean_text(payload.get("id"), 80)
    if not re.fullmatch(r"gpsd-[a-z0-9-]{8,72}", record_id):
        raise ValidationError("record.id has an invalid format.")

    user = require_object(payload, "user")
    user_id = clean_text(user.get("id"), 48).lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,47}", user_id):
        raise ValidationError(
            "user.id must use 2-48 lowercase letters, numbers, underscores, or hyphens."
        )
    user_name = clean_text(user.get("name") or user_id, 60)

    grinder = require_object(payload, "grinder")
    brand = required_text(grinder, "brand", 80, "grinder")
    model = required_text(grinder, "model", 80, "grinder")
    setting = required_text(grinder, "setting", 80, "grinder")
    setting_order = optional_number(grinder.get("settingOrder"), "grinder.settingOrder")
    if setting_order is not None and abs(setting_order) > 1_000_000_000:
        raise ValidationError("grinder.settingOrder is outside the accepted range.")
    color = clean_text(grinder.get("color") or "#d98e32", 7).lower()
    if not re.fullmatch(r"#[0-9a-f]{6}", color):
        raise ValidationError("grinder.color must be a six-digit hexadecimal color.")

    sample = require_object(payload, "sample")
    dose_g = number_in_range(sample.get("doseG"), "sample.doseG", 1, 200)
    bean = clean_text(sample.get("bean"), 120)
    roast_level = clean_text(sample.get("roastLevel"), 40)
    method = required_text(sample, "method", 120, "sample")
    duration_sec = number_in_range(sample.get("durationSec"), "sample.durationSec", 1, 3600)
    sieve_device = required_text(sample, "sieveDevice", 80, "sample")
    replicate_value = number_in_range(sample.get("replicate"), "sample.replicate", 1, 99)
    if int(replicate_value) != replicate_value:
        raise ValidationError("sample.replicate must be an integer.")
    replicate = int(replicate_value)

    weights_input = require_object(payload, "weightsGrams")
    weights: dict[str, float] = {}
    for key in WEIGHT_KEYS:
        weights[key] = round(number_in_range(weights_input.get(key), f"weightsGrams.{key}", 0, 200), 2)

    total_g = round(sum(weights.values()), 2)
    if total_g <= 0:
        raise ValidationError("The sum of the five sieve weights must be greater than zero.")
    declared_total = number_in_range(payload.get("totalG"), "totalG", 0.01, 200)
    if abs(declared_total - total_g) > 0.03:
        raise ValidationError(
            "totalG must equal the sum of the five sieve weights within 0.03 g."
        )

    recovery_pct = round(total_g / dose_g * 100, 2)
    mass_error_pct = round(abs(total_g - dose_g) / dose_g * 100, 2)
    if mass_error_pct > 10:
        raise ValidationError(
            f"Mass-balance error is {mass_error_pct:.2f}%, above the 10% public limit."
        )
    quality_grade, quality_label = quality_from_error(mass_error_pct)

    created_at = normalize_datetime(payload.get("createdAt"), "createdAt")
    if datetime.fromisoformat(created_at.replace("Z", "+00:00")) > utc_datetime() + timedelta(days=1):
        raise ValidationError("createdAt cannot be more than 24 hours in the future.")

    percentages = {
        key.replace("_g", "_pct"): round(weight / total_g * 100, 2)
        for key, weight in weights.items()
    }
    coarse_pct = percentages["mesh18_retained_pct"]
    body_pct = round(
        percentages["mesh24_retained_pct"] + percentages["mesh35_retained_pct"],
        2,
    )
    fines_pct = percentages["pan80_lt300_pct"]
    mode_key = max(weights, key=weights.get)
    mode_label = {
        "mesh18_retained_g": "18 目筛上",
        "mesh24_retained_g": "24 目筛上",
        "mesh35_retained_g": "35 目筛上",
        "mesh60_retained_g": "60 目筛上",
        "pan80_lt300_g": "80 目档底盘",
    }[mode_key]

    now = utc_now()
    return {
        "schemaVersion": SCHEMA_VERSION,
        "standardId": STANDARD_ID,
        "id": record_id,
        "user": {
            "id": user_id,
            "name": user_name,
        },
        "grinder": {
            "brand": brand,
            "model": model,
            "setting": setting,
            "settingOrder": setting_order,
            "color": color,
        },
        "sample": {
            "doseG": round(dose_g, 2),
            "bean": bean,
            "roastLevel": roast_level,
            "method": method,
            "durationSec": round(duration_sec, 1),
            "sieveDevice": sieve_device,
            "replicate": replicate,
        },
        "weightsGrams": weights,
        "totalG": total_g,
        "percentages": percentages,
        "metrics": {
            "coarsePct": coarse_pct,
            "bodyPct": body_pct,
            "finesPct": fines_pct,
            "modeBin": mode_label,
            "quality": {
                "recoveryPct": recovery_pct,
                "massBalanceErrorPct": mass_error_pct,
                "grade": quality_grade,
                "gradeLabel": quality_label,
                "protocolComplete": True,
            },
        },
        "notes": clean_text(payload.get("notes"), 500),
        "license": DATA_LICENSE,
        "createdAt": created_at,
        "updatedAt": now,
        "source": "github-issue",
        "submission": {
            "channel": "github-issue",
            "githubLogin": clean_text(github_login, 80),
            "issueNumber": int(issue_number) if issue_number.isdigit() else 0,
        },
    }


def update_database(record: dict[str, Any]) -> bool:
    database = read_json_object(DATABASE_PATH)
    if database.get("standardId") not in (None, STANDARD_ID):
        raise ValidationError("The repository database uses a different standardId.")
    records = database.get("records")
    if not isinstance(records, list):
        raise ValidationError("data/database.json records must be an array.")

    validate_user_claim(database, record)
    existing = next((item for item in records if item.get("id") == record["id"]), None)
    if existing:
        if comparable_payload(existing) != comparable_payload(record):
            raise ValidationError(
                f"record.id {record['id']} already exists with different measurement data."
            )
        ensure_user_database(record)
        return True

    records.append(record)
    records.sort(
        key=lambda item: (
            str(item.get("user", {}).get("id", "")),
            str(item.get("createdAt", "")),
            str(item.get("id", "")),
        )
    )
    database["schemaVersion"] = SCHEMA_VERSION
    database["standardId"] = STANDARD_ID
    database["updatedAt"] = utc_now()
    database["records"] = records
    rebuild_user_index(database)
    atomic_write_json(DATABASE_PATH, database)
    write_user_database(record)
    return False


def validate_user_claim(database: dict[str, Any], record: dict[str, Any]) -> None:
    user_id = record["user"]["id"]
    github_login = record["submission"]["githubLogin"].lower()
    users = database.get("users")
    if not isinstance(users, dict):
        users = {}
    existing_owner = str(users.get(user_id, {}).get("githubLogin") or "").lower()
    if not existing_owner:
        for item in database.get("records", []):
            if item.get("user", {}).get("id") == user_id:
                existing_owner = str(
                    item.get("submission", {}).get("githubLogin") or ""
                ).lower()
                if existing_owner:
                    break
    if existing_owner and existing_owner != github_login:
        raise ValidationError(
            f"user.id '{user_id}' is already bound to GitHub account '{existing_owner}'."
        )


def rebuild_user_index(database: dict[str, Any]) -> None:
    users: dict[str, dict[str, Any]] = {}
    for item in database.get("records", []):
        user = item.get("user", {})
        user_id = user.get("id")
        if not user_id:
            continue
        bucket = users.setdefault(
            user_id,
            {
                "displayName": user.get("name") or user_id,
                "githubLogin": item.get("submission", {}).get("githubLogin") or "",
                "file": f"data/users/{user_id}.json",
                "count": 0,
                "updatedAt": "",
            },
        )
        bucket["count"] += 1
        bucket["displayName"] = user.get("name") or bucket["displayName"]
        bucket["githubLogin"] = (
            bucket["githubLogin"]
            or item.get("submission", {}).get("githubLogin")
            or ""
        )
        bucket["updatedAt"] = max(
            bucket["updatedAt"],
            item.get("updatedAt") or item.get("createdAt") or "",
        )
    database["users"] = users
    database["userCount"] = len(users)
    database["recordCount"] = len(database.get("records", []))


def write_user_database(record: dict[str, Any]) -> None:
    USERS_DIR.mkdir(parents=True, exist_ok=True)
    user_id = record["user"]["id"]
    user_path = USERS_DIR / f"{user_id}.json"
    if user_path.exists():
        user_database = read_json_object(user_path)
    else:
        user_database = {
            "schemaVersion": SCHEMA_VERSION,
            "standardId": STANDARD_ID,
            "user": record["user"],
            "ownerGithubLogin": record["submission"]["githubLogin"],
            "recordCount": 0,
            "records": [],
        }

    owner = str(user_database.get("ownerGithubLogin") or "").lower()
    submitter = record["submission"]["githubLogin"].lower()
    if owner and owner != submitter:
        raise ValidationError(
            f"The user database is owned by GitHub account '{owner}', not '{submitter}'."
        )

    records = [
        item for item in user_database.get("records", [])
        if item.get("id") != record["id"]
    ]
    records.append(record)
    records.sort(key=lambda item: (str(item.get("createdAt", "")), str(item.get("id", ""))))
    user_database.update(
        {
            "schemaVersion": SCHEMA_VERSION,
            "standardId": STANDARD_ID,
            "user": record["user"],
            "ownerGithubLogin": record["submission"]["githubLogin"],
            "updatedAt": utc_now(),
            "recordCount": len(records),
            "records": records,
        }
    )
    atomic_write_json(user_path, user_database)


def ensure_user_database(record: dict[str, Any]) -> None:
    user_path = USERS_DIR / f"{record['user']['id']}.json"
    if not user_path.exists():
        write_user_database(record)
        return
    user_database = read_json_object(user_path)
    if not any(
        item.get("id") == record["id"]
        for item in user_database.get("records", [])
    ):
        write_user_database(record)


def comparable_payload(record: dict[str, Any]) -> dict[str, Any]:
    return {
        "schemaVersion": record.get("schemaVersion"),
        "standardId": record.get("standardId"),
        "id": record.get("id"),
        "user": record.get("user"),
        "grinder": record.get("grinder"),
        "sample": record.get("sample"),
        "weightsGrams": record.get("weightsGrams"),
        "totalG": record.get("totalG"),
        "notes": record.get("notes") or "",
        "license": record.get("license"),
        "createdAt": record.get("createdAt"),
    }


def require_object(payload: dict[str, Any], key: str) -> dict[str, Any]:
    value = payload.get(key)
    if not isinstance(value, dict):
        raise ValidationError(f"{key} must be a JSON object.")
    return value


def required_text(
    payload: dict[str, Any],
    key: str,
    max_length: int,
    prefix: str,
) -> str:
    value = clean_text(payload.get(key), max_length)
    if not value:
        raise ValidationError(f"{prefix}.{key} is required.")
    return value


def clean_text(value: Any, max_length: int) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text) > max_length:
        raise ValidationError(f"A text field exceeds the {max_length}-character limit.")
    return text


def clean_error_message(value: str) -> str:
    return re.sub(r"[\r\n]+", " ", value).strip()[:500] or "Unknown validation error."


def number_in_range(
    value: Any,
    field: str,
    minimum: float,
    maximum: float,
) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValidationError(f"{field} must be a JSON number.")
    number = float(value)
    if not math.isfinite(number):
        raise ValidationError(f"{field} must be finite.")
    if number < minimum or number > maximum:
        raise ValidationError(
            f"{field} must be between {minimum:g} and {maximum:g}."
        )
    return number


def optional_number(value: Any, field: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValidationError(f"{field} must be a JSON number or null.")
    number = float(value)
    if not math.isfinite(number):
        raise ValidationError(f"{field} must be finite.")
    return number


def quality_from_error(error_pct: float) -> tuple[str, str]:
    if error_pct <= 2:
        return "A", "高可比"
    if error_pct <= 5:
        return "B", "可比"
    return "C", "谨慎比较"


def normalize_datetime(value: Any, field: str) -> str:
    text = str(value or "").strip()
    if not text:
        raise ValidationError(f"{field} is required.")
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValidationError(f"{field} must be an ISO 8601 date-time.") from exc
    if parsed.tzinfo is None:
        raise ValidationError(f"{field} must include a timezone.")
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def read_json_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValidationError(f"Unable to read {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ValidationError(f"{path} must contain a JSON object.")
    return value


def atomic_write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def utc_datetime() -> datetime:
    return datetime.now(timezone.utc)


def utc_now() -> str:
    return utc_datetime().isoformat().replace("+00:00", "Z")


def write_output(key: str, value: str) -> None:
    if not OUTPUT_PATH:
        return
    with Path(OUTPUT_PATH).open("a", encoding="utf-8") as handle:
        handle.write(f"{key}={value}\n")


if __name__ == "__main__":
    main()
