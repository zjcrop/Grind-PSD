#!/usr/bin/env python3
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

STANDARD_ID = "grind-psd-sieve-v1"
DATABASE_PATH = Path("data/database.json")
USERS_DIR = Path("data/users")
REQUIRED_WEIGHTS = [
    "mesh18_retained_g",
    "mesh24_retained_g",
    "mesh35_retained_g",
    "mesh60_retained_g",
    "pan80_lt300_g",
]


def main():
    event_path = Path(os.environ["EVENT_PATH"])
    event = json.loads(event_path.read_text(encoding="utf-8"))
    body = event.get("issue", {}).get("body", "")
    issue_number = os.environ.get("ISSUE_NUMBER") or str(event.get("issue", {}).get("number", ""))

    if not body and issue_number:
        body = fetch_issue_body(issue_number)

    record = extract_record(body)
    validate_record(record)
    update_database(record)


def fetch_issue_body(issue_number):
    if not issue_number:
        raise SystemExit("No issue body or issue number supplied.")
    result = subprocess.run(
        ["gh", "issue", "view", str(issue_number), "--json", "body", "--jq", ".body"],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
    )
    return result.stdout


def extract_record(body):
    match = re.search(
        r"BEGIN_GRIND_PSD_JSON\s*(?:```json)?\s*(.*?)\s*(?:```)?\s*END_GRIND_PSD_JSON",
        body,
        re.DOTALL,
    )
    if not match:
        fail("No BEGIN_GRIND_PSD_JSON / END_GRIND_PSD_JSON block found.")
    try:
        return json.loads(match.group(1))
    except json.JSONDecodeError as exc:
        fail(f"Invalid JSON payload: {exc}")


def validate_record(record):
    if record.get("standardId") != STANDARD_ID:
        fail(f"standardId must be {STANDARD_ID}.")

    user = record.get("user") or {}
    grinder = record.get("grinder") or {}
    weights = record.get("weightsGrams") or {}

    user_id = str(user.get("id", "")).strip()
    if not re.fullmatch(r"[a-z0-9_-]{1,48}", user_id):
        fail("user.id must use 1-48 lowercase letters, numbers, underscores, or hyphens.")

    for field in ("brand", "model", "setting"):
        if not str(grinder.get(field, "")).strip():
            fail(f"grinder.{field} is required.")

    total = 0.0
    for field in REQUIRED_WEIGHTS:
        value = weights.get(field)
        if not isinstance(value, (int, float)) or value < 0:
            fail(f"weightsGrams.{field} must be a non-negative number.")
        total += float(value)

    if total <= 0:
        fail("Total sieve weight must be greater than zero.")

    declared_total = float(record.get("totalG") or 0)
    if abs(declared_total - total) > 0.03:
        fail("totalG must equal the sum of weightsGrams within 0.03 g.")

    if len(json.dumps(record, ensure_ascii=False)) > 12000:
        fail("Record payload is too large.")


def update_database(record):
    db = json.loads(DATABASE_PATH.read_text(encoding="utf-8"))
    records = db.setdefault("records", [])
    record_id = record.get("id")
    if not record_id:
        fail("record.id is required.")

    existing = next((item for item in records if item.get("id") == record_id), None)
    if existing:
        print(f"Record {record_id} already exists. No update needed.")
        if not user_record_exists(existing):
            write_user_database(existing)
        return

    record["source"] = "github-issue"
    record["updatedAt"] = utc_now()
    records.append(record)
    records.sort(key=lambda item: (item.get("user", {}).get("id", ""), item.get("createdAt", "")))

    rebuild_user_index(db)
    db["schemaVersion"] = "2.0.0"
    db["standardId"] = STANDARD_ID
    db["updatedAt"] = utc_now()
    DATABASE_PATH.write_text(json.dumps(db, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    write_user_database(record)


def rebuild_user_index(db):
    users = {}
    for item in db.get("records", []):
        user_id = item.get("user", {}).get("id")
        if not user_id:
            continue
        bucket = users.setdefault(user_id, {"count": 0, "recordIds": [], "updatedAt": ""})
        bucket["count"] += 1
        bucket["recordIds"].append(item.get("id"))
        bucket["updatedAt"] = max(bucket["updatedAt"], item.get("updatedAt") or item.get("createdAt") or "")
    db["users"] = users


def write_user_database(record):
    USERS_DIR.mkdir(parents=True, exist_ok=True)
    user_id = record["user"]["id"]
    user_path = USERS_DIR / f"{user_id}.json"
    if user_path.exists():
        user_db = json.loads(user_path.read_text(encoding="utf-8"))
    else:
        user_db = {
            "schemaVersion": "2.0.0",
            "standardId": STANDARD_ID,
            "user": record["user"],
            "records": [],
        }

    records = [item for item in user_db.get("records", []) if item.get("id") != record.get("id")]
    records.append(record)
    records.sort(key=lambda item: item.get("createdAt", ""))
    user_db["schemaVersion"] = "2.0.0"
    user_db["standardId"] = STANDARD_ID
    user_db["user"] = record["user"]
    user_db["updatedAt"] = utc_now()
    user_db["records"] = records
    user_path.write_text(json.dumps(user_db, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def user_record_exists(record):
    user_path = USERS_DIR / f"{record['user']['id']}.json"
    if not user_path.exists():
        return False
    try:
        user_db = json.loads(user_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return False
    return any(item.get("id") == record.get("id") for item in user_db.get("records", []))


def utc_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def fail(message):
    if os.environ.get("GITHUB_EVENT_NAME") == "issues":
        issue_number = os.environ.get("ISSUE_NUMBER")
        if issue_number:
            subprocess.run(
                ["gh", "issue", "comment", issue_number, "--body", f"Grind-PSD record validation failed: {message}"],
                check=False,
            )
    raise SystemExit(message)


if __name__ == "__main__":
    main()
