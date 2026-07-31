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
MAX_PAYLOAD_CHARS = 120_000
MAX_BATCH_RECORDS = 20

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
        result = process_operation(payload, github_login, issue_number)
        write_output("record_id", result["record_id"])
        write_output("user_id", result["user_id"])
        write_output("action", result["action"])
        write_output("record_count", str(result["record_count"]))
        write_output("duplicate", "true" if result["duplicate"] else "false")
        print(result["message"])
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


def process_operation(
    payload: dict[str, Any],
    github_login: str,
    issue_number: str,
) -> dict[str, Any]:
    """Apply one authenticated Issue operation as an all-or-nothing database change."""
    operation = clean_text(payload.get("operation") or "legacy_upsert", 40)
    if operation == "register_user":
        return register_user(payload, github_login)
    if operation == "delete_record":
        return delete_record(payload, github_login)
    if operation == "update_record":
        return update_record(payload, github_login, issue_number)
    if operation == "upsert_records":
        return upsert_records(payload, github_login, issue_number)
    if operation == "legacy_upsert":
        return upsert_records(
            {
                "operation": "upsert_records",
                "schemaVersion": payload.get("schemaVersion"),
                "standardId": payload.get("standardId"),
                "license": payload.get("license"),
                "records": [payload],
            },
            github_login,
            issue_number,
        )
    raise ValidationError(f"Unsupported operation '{operation}'.")


def validate_envelope(payload: dict[str, Any]) -> None:
    if payload.get("schemaVersion") != SCHEMA_VERSION:
        raise ValidationError(f"schemaVersion must be {SCHEMA_VERSION}.")
    if payload.get("standardId") != STANDARD_ID:
        raise ValidationError(f"standardId must be {STANDARD_ID}.")


def validate_user(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        raise ValidationError("user must be a JSON object.")
    user_id = clean_text(value.get("id"), 48).lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,47}", user_id):
        raise ValidationError(
            "user.id must use 2-48 lowercase letters, numbers, underscores, or hyphens."
        )
    return {
        "id": user_id,
        "name": clean_text(value.get("name") or user_id, 60),
    }


def register_user(
    payload: dict[str, Any],
    github_login: str,
) -> dict[str, Any]:
    validate_envelope(payload)
    user = validate_user(payload.get("user"))
    database = load_database()
    users = ensure_users_object(database)
    existing = users.get(user["id"])
    owner = owner_for_user(database, user["id"])
    actor = github_login.lower()
    if owner and owner != actor:
        raise ValidationError(
            f"user.id '{user['id']}' is already bound to GitHub account '{owner}'."
        )

    duplicate = bool(
        existing
        and owner == actor
        and clean_text(existing.get("displayName") or user["id"], 60) == user["name"]
    )
    now = utc_now()
    registered_at = (
        clean_text(existing.get("registeredAt"), 40)
        if isinstance(existing, dict)
        else ""
    ) or now
    users[user["id"]] = {
        "displayName": user["name"],
        "githubLogin": clean_text(github_login, 80),
        "file": f"data/users/{user['id']}.json",
        "count": int(existing.get("count") or 0) if isinstance(existing, dict) else 0,
        "registeredAt": registered_at,
        "updatedAt": now,
    }
    database["updatedAt"] = now
    rebuild_user_index(database)
    atomic_write_json(DATABASE_PATH, database)
    sync_user_database(database, user["id"])
    return operation_result(
        action="register_user",
        user_id=user["id"],
        record_ids=[],
        duplicate=duplicate,
        message=(
            f"{'Confirmed' if duplicate else 'Registered'} user {user['id']} "
            f"for GitHub account {github_login}."
        ),
    )


def upsert_records(
    payload: dict[str, Any],
    github_login: str,
    issue_number: str,
) -> dict[str, Any]:
    validate_envelope(payload)
    if payload.get("license") not in (None, DATA_LICENSE):
        raise ValidationError(f"license must be {DATA_LICENSE}.")
    raw_records = payload.get("records")
    if not isinstance(raw_records, list) or not raw_records:
        raise ValidationError("records must be a non-empty JSON array.")
    if len(raw_records) > MAX_BATCH_RECORDS:
        raise ValidationError(
            f"A batch may contain at most {MAX_BATCH_RECORDS} records."
        )

    normalized = [
        validate_and_normalize(
            item,
            github_login,
            issue_number,
            action="create",
        )
        for item in raw_records
    ]
    ids = [record["id"] for record in normalized]
    if len(set(ids)) != len(ids):
        raise ValidationError("A batch cannot contain duplicate record IDs.")
    user_ids = {record["user"]["id"] for record in normalized}
    if len(user_ids) != 1:
        raise ValidationError("All records in one batch must use the same user.id.")

    user_id = normalized[0]["user"]["id"]
    database = load_database()
    assert_user_owner(database, user_id, github_login, allow_unclaimed=True)
    records = database["records"]
    existing_by_id = {str(item.get("id")): item for item in records}

    additions: list[dict[str, Any]] = []
    duplicate_count = 0
    for record in normalized:
        existing = existing_by_id.get(record["id"])
        if existing:
            if comparable_payload(existing) != comparable_payload(record):
                raise ValidationError(
                    f"record.id {record['id']} already exists with different measurement data."
                )
            duplicate_count += 1
        else:
            additions.append(record)

    if additions:
        records.extend(additions)
        sort_records(records)
        database["updatedAt"] = utc_now()
        database["records"] = records
        ensure_registered_user(database, normalized[0]["user"], github_login)
        rebuild_user_index(database)
        atomic_write_json(DATABASE_PATH, database)
        sync_user_database(database, user_id)

    return operation_result(
        action="upsert_records",
        user_id=user_id,
        record_ids=ids,
        duplicate=not additions,
        message=(
            f"Accepted {len(additions)} new record(s) and {duplicate_count} existing "
            f"record(s) for user {user_id}."
        ),
    )


def update_record(
    payload: dict[str, Any],
    github_login: str,
    issue_number: str,
) -> dict[str, Any]:
    validate_envelope(payload)
    target_id = clean_text(payload.get("targetId"), 80)
    raw_record = payload.get("record")
    if not isinstance(raw_record, dict):
        raise ValidationError("record must be a JSON object.")
    normalized = validate_and_normalize(
        raw_record,
        github_login,
        issue_number,
        action="update",
    )
    if normalized["id"] != target_id:
        raise ValidationError("targetId must match record.id.")

    database = load_database()
    index = next(
        (position for position, item in enumerate(database["records"]) if item.get("id") == target_id),
        None,
    )
    if index is None:
        raise ValidationError(f"record.id {target_id} does not exist.")
    existing = database["records"][index]
    user_id = str(existing.get("user", {}).get("id") or "")
    if normalized["user"]["id"] != user_id:
        raise ValidationError("An edit cannot move a record to another user.id.")
    assert_user_owner(database, user_id, github_login)
    if normalized["createdAt"] != existing.get("createdAt"):
        raise ValidationError("An edit cannot change createdAt.")

    duplicate = comparable_payload(existing) == comparable_payload(normalized)
    if not duplicate:
        normalized["submission"]["originalIssueNumber"] = int(
            existing.get("submission", {}).get("issueNumber") or 0
        )
        database["records"][index] = normalized
        sort_records(database["records"])
        database["updatedAt"] = utc_now()
        rebuild_user_index(database)
        atomic_write_json(DATABASE_PATH, database)
        sync_user_database(database, user_id)

    return operation_result(
        action="update_record",
        user_id=user_id,
        record_ids=[target_id],
        duplicate=duplicate,
        message=f"{'No changes for' if duplicate else 'Updated'} record {target_id}.",
    )


def delete_record(
    payload: dict[str, Any],
    github_login: str,
) -> dict[str, Any]:
    validate_envelope(payload)
    target_id = clean_text(payload.get("targetId"), 80)
    user_id = clean_text(payload.get("userId"), 48).lower()
    if not target_id or not re.fullmatch(r"gpsd-[a-z0-9-]{8,72}", target_id):
        raise ValidationError("targetId has an invalid format.")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,47}", user_id):
        raise ValidationError("userId has an invalid format.")

    database = load_database()
    existing = next(
        (item for item in database["records"] if item.get("id") == target_id),
        None,
    )
    if not existing:
        assert_user_owner(database, user_id, github_login)
        return operation_result(
            action="delete_record",
            user_id=user_id,
            record_ids=[target_id],
            duplicate=True,
            message=f"Record {target_id} was already absent.",
        )
    if existing.get("user", {}).get("id") != user_id:
        raise ValidationError("targetId does not belong to the supplied userId.")
    assert_user_owner(database, user_id, github_login)

    database["records"] = [
        item for item in database["records"] if item.get("id") != target_id
    ]
    database["updatedAt"] = utc_now()
    rebuild_user_index(database)
    atomic_write_json(DATABASE_PATH, database)
    sync_user_database(database, user_id)
    return operation_result(
        action="delete_record",
        user_id=user_id,
        record_ids=[target_id],
        duplicate=False,
        message=f"Deleted record {target_id} for user {user_id}.",
    )


def operation_result(
    *,
    action: str,
    user_id: str,
    record_ids: list[str],
    duplicate: bool,
    message: str,
) -> dict[str, Any]:
    return {
        "action": action,
        "user_id": user_id,
        "record_id": record_ids[0] if record_ids else f"user:{user_id}",
        "record_count": len(record_ids),
        "duplicate": duplicate,
        "message": message,
    }


def validate_and_normalize(
    payload: dict[str, Any],
    github_login: str,
    issue_number: str,
    action: str = "create",
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
    setting_turns = optional_number(grinder.get("settingTurns"), "grinder.settingTurns")
    if setting_turns is not None and not 0 <= setting_turns <= 1000:
        raise ValidationError("grinder.settingTurns must be between 0 and 1000.")
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
            "settingTurns": round(setting_turns, 3) if setting_turns is not None else None,
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
            "action": clean_text(action, 20),
        },
    }


def load_database() -> dict[str, Any]:
    database = read_json_object(DATABASE_PATH)
    if database.get("standardId") not in (None, STANDARD_ID):
        raise ValidationError("The repository database uses a different standardId.")
    records = database.get("records")
    if not isinstance(records, list):
        raise ValidationError("data/database.json records must be an array.")
    database["schemaVersion"] = SCHEMA_VERSION
    database["standardId"] = STANDARD_ID
    ensure_users_object(database)
    return database


def ensure_users_object(database: dict[str, Any]) -> dict[str, Any]:
    users = database.get("users")
    if not isinstance(users, dict):
        users = {}
        database["users"] = users
    return users


def owner_for_user(database: dict[str, Any], user_id: str) -> str:
    users = ensure_users_object(database)
    owner = str(users.get(user_id, {}).get("githubLogin") or "").lower()
    if owner:
        return owner
    for item in database.get("records", []):
        if item.get("user", {}).get("id") == user_id:
            owner = str(item.get("submission", {}).get("githubLogin") or "").lower()
            if owner:
                return owner
    return ""


def assert_user_owner(
    database: dict[str, Any],
    user_id: str,
    github_login: str,
    *,
    allow_unclaimed: bool = False,
) -> None:
    owner = owner_for_user(database, user_id)
    actor = github_login.lower()
    if owner and owner != actor:
        raise ValidationError(
            f"user.id '{user_id}' is already bound to GitHub account '{owner}'."
        )
    if not owner and not allow_unclaimed:
        raise ValidationError(
            f"user.id '{user_id}' is not registered and cannot be modified."
        )


def ensure_registered_user(
    database: dict[str, Any],
    user: dict[str, str],
    github_login: str,
) -> None:
    users = ensure_users_object(database)
    existing = users.get(user["id"], {})
    now = utc_now()
    users[user["id"]] = {
        "displayName": user["name"],
        "githubLogin": clean_text(
            existing.get("githubLogin") or github_login,
            80,
        ),
        "file": f"data/users/{user['id']}.json",
        "count": int(existing.get("count") or 0),
        "registeredAt": clean_text(existing.get("registeredAt"), 40) or now,
        "updatedAt": now,
    }


def sort_records(records: list[dict[str, Any]]) -> None:
    records.sort(
        key=lambda item: (
            str(item.get("user", {}).get("id", "")),
            str(item.get("createdAt", "")),
            str(item.get("id", "")),
        )
    )


def sync_user_database(database: dict[str, Any], user_id: str) -> None:
    users = ensure_users_object(database)
    meta = users.get(user_id)
    if not isinstance(meta, dict):
        raise ValidationError(f"user.id '{user_id}' is missing from the user index.")
    user_records = [
        item for item in database.get("records", [])
        if item.get("user", {}).get("id") == user_id
    ]
    sort_records(user_records)
    display_name = (
        user_records[-1].get("user", {}).get("name")
        if user_records
        else meta.get("displayName")
    ) or user_id
    user_database = {
        "schemaVersion": SCHEMA_VERSION,
        "standardId": STANDARD_ID,
        "user": {
            "id": user_id,
            "name": display_name,
        },
        "ownerGithubLogin": meta.get("githubLogin") or "",
        "registeredAt": meta.get("registeredAt") or "",
        "updatedAt": utc_now(),
        "recordCount": len(user_records),
        "records": user_records,
    }
    USERS_DIR.mkdir(parents=True, exist_ok=True)
    atomic_write_json(USERS_DIR / f"{user_id}.json", user_database)


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
    existing_users = ensure_users_object(database)
    users: dict[str, dict[str, Any]] = {}
    for user_id, meta in existing_users.items():
        if not isinstance(meta, dict):
            continue
        clean_id = clean_text(user_id, 48).lower()
        if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{1,47}", clean_id):
            continue
        users[clean_id] = {
            "displayName": clean_text(meta.get("displayName") or clean_id, 60),
            "githubLogin": clean_text(meta.get("githubLogin"), 80),
            "file": f"data/users/{clean_id}.json",
            "count": 0,
            "registeredAt": clean_text(meta.get("registeredAt"), 40),
            "updatedAt": clean_text(meta.get("updatedAt"), 40),
        }
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
                "registeredAt": item.get("createdAt") or "",
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
        bucket["registeredAt"] = (
            bucket.get("registeredAt")
            or item.get("createdAt")
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
